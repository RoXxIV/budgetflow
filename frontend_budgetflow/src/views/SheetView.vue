<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

// ─── API ─────────────────────────────────────────────────────
import {
  getSheets, createSheet, updateSheet,
  getSheetLines, getSheetSnapshots, getSheetReadings, updateReading, getSheetTransactions,
  getSheetContributions, addSheetContribution, removeSheetContribution,
  getSheetInvestmentTransactions, addSheetInvestmentTransaction, removeSheetInvestmentTransaction,
  createSheetLine, updateSheetLine, deleteSheetLine,
} from '@/api/sheets.js'
import { createTransaction, updateTransaction, deleteTransaction } from '@/api/transactions.js'
import { getAccounts } from '@/api/accounts.js'
import { getSections } from '@/api/sections.js'
import { getSettings } from '@/api/settings.js'
import { getSavingGoals } from '@/api/savingGoals.js'
import { getInvestments } from '@/api/investments.js'
import { getThemes } from '@/api/themes.js'

// ─── Utils ───────────────────────────────────────────────────
import { fmt, fmtDate } from '@/utils/formatters.js'
import { computeEDF, computeEDFDetail } from '@/utils/edf.js'
import { buildSnapshotMap, computeAccountDeltaMap, resolveBalance } from '@/utils/liveBalances.js'

// ─── Composants ──────────────────────────────────────────
import AppModal from '@/components/AppModal.vue'
import ChipSelect from '@/components/ChipSelect.vue'
import ThemeSelect from '@/components/ThemeSelect.vue'
import SectionCard from '@/components/SectionCard.vue'

// ─── State global ────────────────────────────────────────
const sheets = ref([])
const currentSheet = ref(null)
const lines = ref([])
const snapshots = ref([])
const readings = ref([])
const accounts = ref([])
const sections = ref([])
const settings = ref(null)
const goals = ref([])
const investments = ref([])
const contributions = ref([])
const investmentTxs = ref([])
const themes = ref([])

// ─── UI ───────────────────────────────────────────────────
const showCreateForm = ref(false)
const newSheetForm = ref({ name: '' })
const newSheetSnapshots = ref({}) // { [accountId]: balance }

function openCreateForm() {
  newSheetForm.value = { name: '' }
  newSheetSnapshots.value = {}
  accounts.value.forEach((a) => {
    newSheetSnapshots.value[a._id] = ''
  })
  showCreateForm.value = true
}
const openLineId = ref(null)

// Sections repliables (repliées par défaut)
const openSections = ref({})
function toggleSection(id) {
  openSections.value[id] = !openSections.value[id]
}
function isSectionOpen(id) {
  return !!openSections.value[id]
}

// Formulaires contributions/investissements
const newContribForms = ref({}) // { [goalId]: { amount, date, notes } }
const newInvestTxForms = ref({}) // { [investmentId]: { amount, date, notes } }

const route = useRoute()

// ─── Chargement ──────────────────────────────────────────
onMounted(async () => {
  await Promise.all([
    loadSheets(),
    loadAccounts(),
    loadSections(),
    loadSettings(),
    loadGoals(),
    loadInvestments(),
    loadThemes(),
  ])
  const requested = route.query.id && sheets.value.find((s) => s._id === route.query.id)
  const active = requested || sheets.value.find((s) => s.status === 'active') || sheets.value[0]
  if (active) await openSheet(active._id)
})

async function loadSheets() {
  sheets.value = (await getSheets()).data
}
async function loadAccounts() {
  accounts.value = (await getAccounts()).data
}
async function loadSections() {
  sections.value = (await getSections()).data
}
async function loadSettings() {
  settings.value = (await getSettings()).data
}
async function loadGoals() {
  goals.value = (await getSavingGoals()).data
}
async function loadInvestments() {
  investments.value = (await getInvestments()).data
}
async function loadThemes() {
  themes.value = (await getThemes()).data
}

async function openSheet(id) {
  currentSheet.value = sheets.value.find((s) => s._id === id)
  const [lRes, sRes, rRes, cRes, iRes, tRes] = await Promise.all([
    getSheetLines(id),
    getSheetSnapshots(id),
    getSheetReadings(id),
    getSheetContributions(id),
    getSheetInvestmentTransactions(id),
    getSheetTransactions(id),
  ])
  lines.value = lRes.data
  snapshots.value = sRes.data
  readings.value = rRes.data
  contributions.value = cRes.data
  investmentTxs.value = iRes.data
  buildLineTxMap(tRes.data)
}

// Regroupe les transactions du sheet par ligne budgétaire
function buildLineTxMap(allTxs) {
  const map = {}
  allTxs.forEach((t) => {
    const lid = t.budgetLine?._id || t.budgetLine
    if (!lid) return
    if (!map[lid]) map[lid] = []
    map[lid].push(t)
  })
  lineTxs.value = map
}

// ─── Création sheet ───────────────────────────────────────
async function submitCreate() {
  if (!newSheetForm.value.name.trim()) return
  const periodMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const snapshots = Object.entries(newSheetSnapshots.value)
    .filter(([, v]) => v !== '' && v !== null)
    .map(([accountId, balance]) => ({ accountId, balance: parseFloat(balance) }))
  // Archiver les sheets actifs avant création
  const activeSheets = sheets.value.filter((s) => s.status === 'active')
  await Promise.all(activeSheets.map((s) => updateSheet(s._id, { status: 'archived' })))

  await createSheet({ periodMonth, name: newSheetForm.value.name.trim(), snapshots })
  newSheetForm.value = { name: '' }
  newSheetSnapshots.value = {}
  showCreateForm.value = false
  await loadSheets()
  const created = sheets.value[0]
  if (created) await openSheet(created._id)
}

// ─── Lignes groupées par section (dépenses uniquement) ───
const incomeLines = computed(() => lines.value.filter((l) => l.flow === 'income'))

const linesBySection = computed(() => {
  const map = {}
  sections.value.forEach((s) => {
    map[s._id] = { section: s, lines: [] }
  })
  map['none'] = {
    section: { _id: 'none', name: 'Sans section', color: '#d1d5db', order: Infinity },
    lines: [],
  }

  lines.value.forEach((line) => {
    if (line.flow === 'income') return // revenus gérés à part
    const key = line.section?._id || 'none'
    if (map[key]) map[key].lines.push(line)
    else map['none'].lines.push(line)
  })

  return Object.values(map)
    .filter((g) => (g.section._id === 'none' ? g.lines.length > 0 : true))
    .map((g) => ({ ...g, hasPlanned: g.lines.some((l) => (l.plannedAmount || 0) > 0) }))
    .sort((a, b) => (a.section.order ?? Infinity) - (b.section.order ?? Infinity))
})

// Répartition des sections en 2 colonnes (masonry flex, sans trou ni saut)
const sectionsLeft = computed(() => linesBySection.value.filter((_, i) => i % 2 === 0))
const sectionsRight = computed(() => linesBySection.value.filter((_, i) => i % 2 === 1))

// ─── Snapshots ────────────────────────────────────────────
// Map { accountId → balance_initiale } construite depuis les AccountSnapshot du sheet
const snapshotMap = computed(() => buildSnapshotMap(snapshots.value))

// ─── Ouvrir/fermer panneau ligne ──────────────────────────
function toggleLine(lineId) {
  openLineId.value = openLineId.value === lineId ? null : lineId
}

async function reloadLines() {
  lines.value = (await getSheetLines(currentSheet.value._id)).data
}

// ─── Relevés EDF ─────────────────────────────────────────
async function saveReading(reading) {
  await updateReading(currentSheet.value._id, reading._id, {
    hpPrevious: reading.hpPrevious,
    hpCurrent: reading.hpCurrent,
    hcPrevious: reading.hcPrevious,
    hcCurrent: reading.hcCurrent,
  })
}

// ─── Contributions objectifs ──────────────────────────────
function contribsForGoal(goalId) {
  return contributions.value.filter((c) => (c.goal?._id || c.goal) === goalId)
}

function totalContribForGoal(goalId) {
  return contribsForGoal(goalId).reduce((s, c) => s + c.amount, 0)
}

function initContribForm(goalId) {
  if (!newContribForms.value[goalId]) {
    newContribForms.value[goalId] = {
      amount: '',
      date: new Date().toISOString().substring(0, 10),
      notes: '',
    }
  }
}

async function submitContrib(goalId) {
  const form = newContribForms.value[goalId]
  if (!form?.amount) return
  await addSheetContribution(currentSheet.value._id, {
    goal: goalId,
    amount: parseFloat(form.amount),
    date: form.date,
    notes: form.notes,
  })
  newContribForms.value[goalId] = {
    amount: '',
    date: new Date().toISOString().substring(0, 10),
    notes: '',
  }
  contributions.value = (await getSheetContributions(currentSheet.value._id)).data
  await loadGoals()
}

async function deleteContrib(contribId) {
  await removeSheetContribution(currentSheet.value._id, contribId)
  contributions.value = (await getSheetContributions(currentSheet.value._id)).data
  await loadGoals()
}

// ─── Transactions investissement ─────────────────────────
function investTxsForInvestment(investmentId) {
  return investmentTxs.value.filter((t) => (t.investment?._id || t.investment) === investmentId)
}

function totalInvestedThisSheet(investmentId) {
  return investTxsForInvestment(investmentId).reduce((s, t) => s + t.amount, 0)
}

function initInvestTxForm(investmentId) {
  if (!newInvestTxForms.value[investmentId]) {
    newInvestTxForms.value[investmentId] = {
      amount: '',
      date: new Date().toISOString().substring(0, 10),
      notes: '',
    }
  }
}

async function submitInvestTx(investmentId) {
  const form = newInvestTxForms.value[investmentId]
  if (!form?.amount) return
  await addSheetInvestmentTransaction(currentSheet.value._id, {
    investment: investmentId,
    amount: parseFloat(form.amount),
    date: form.date,
    notes: form.notes,
  })
  newInvestTxForms.value[investmentId] = {
    amount: '',
    date: new Date().toISOString().substring(0, 10),
    notes: '',
  }
  investmentTxs.value = (await getSheetInvestmentTransactions(currentSheet.value._id)).data
}

async function deleteInvestTx(txId) {
  await removeSheetInvestmentTransaction(currentSheet.value._id, txId)
  investmentTxs.value = (await getSheetInvestmentTransactions(currentSheet.value._id)).data
}

// ─── Bilan ────────────────────────────────────────────────
const bilan = computed(() => {
  const mainAccount = settings.value?.mainAccount
  const mainAccountId = mainAccount?._id || mainAccount
  const mainAccountName = mainAccount?.name || null
  const solde = mainAccountId ? (snapshotMap.value[mainAccountId] ?? 0) : 0

  const totalActualExpense = lines.value
    .filter((l) => {
      if (!mainAccountId) return l.flow === 'expense'
      const fromId = l.fromAccount?._id || l.fromAccount
      return l.flow === 'expense' && fromId === mainAccountId
    })
    // Dépenses = uniquement le réel dépensé (pas le prévu), + épargne + investissements
    .reduce((s, l) => s + (l.actualAmount || 0), 0)
    + contributions.value.reduce((s, c) => s + (c.amount || 0), 0)
    + investmentTxs.value.reduce((s, t) => s + (t.amount || 0), 0)

  const totalActualIncome = lines.value
    .filter((l) => l.flow === 'income')
    .reduce((s, l) => s + (l.actualAmount || 0), 0)

  // Reste réel : snapshot + mouvements réels sur le compte principal
  let resteReel = solde
  if (mainAccountId) {
    lines.value.forEach((l) => {
      const toId = l.toAccount?._id || l.toAccount
      const fromId = l.fromAccount?._id || l.fromAccount
      const amount = l.actualAmount || l.plannedAmount || 0
      if (toId === mainAccountId) resteReel += amount
      if (fromId === mainAccountId) resteReel -= amount
    })
    contributions.value.forEach((c) => { resteReel -= c.amount || 0 })
    investmentTxs.value.forEach((t) => { resteReel -= t.amount || 0 })
  }

  const savingRate = settings.value?.savingRate || 0
  const montantEconomie = (totalActualIncome + solde) * (savingRate / 100)
  const totalPlannedExpense = lines.value
    .filter((l) => l.flow === 'expense')
    .reduce((s, l) => s + (l.plannedAmount || 0), 0)

  // Déjà mis de côté
  const savingsFromLines = lines.value
    .filter((l) => l.flow === 'expense' && l.toAccount?.type === 'savings')
    .reduce((s, l) => s + (l.actualAmount || l.plannedAmount || 0), 0)
  const savingsFromGoals = contributions.value.reduce((s, c) => s + (c.amount || 0), 0)
  const savingsFromInvestments = settings.value?.includeInvestmentsInSavings
    ? investmentTxs.value.reduce((s, t) => s + (t.amount || 0), 0)
    : 0

  const dejaMisDeCote = savingsFromLines + savingsFromGoals + savingsFromInvestments
  const restantEconomie = montantEconomie - dejaMisDeCote

  return { resteReel, totalActualExpense, totalPlannedExpense, montantEconomie, dejaMisDeCote, restantEconomie, savingRate, mainAccountName }
})

// ─── Soldes temps réel par compte ─────────────────────────
// Snapshot initial + tous les mouvements réels du mois (lignes, épargne, investissements)
const showAccountBalances = ref(false)
const liveAccountBalances = computed(() => {
  const mainAccountId = settings.value?.mainAccount?._id || settings.value?.mainAccount || null
  const deltaMap = computeAccountDeltaMap({
    lines: lines.value,
    contributions: contributions.value,
    investmentTxs: investmentTxs.value,
    goals: goals.value,
    mainAccountId,
  })
  return accounts.value.map((account) => ({
    account,
    snapshot: snapshotMap.value[account._id] ?? null,
    current: resolveBalance(snapshotMap.value, deltaMap, account._id),
  }))
})

// ─── Calcul 50/50 ─────────────────────────────────────────
const sharing = computed(() => {
  if (!settings.value) return null
  const partnerRentAmount = settings.value.partnerRentAmount || 0
  // ½ est porté par chaque entrée → on somme les entrées marquées partagées
  const allEntries = Object.values(lineTxs.value).flat()
  const sharedSum = allEntries.filter((e) => e.isShared).reduce((s, e) => s + (e.amount || 0), 0)

  // Dépassement EDF : si la ligne (template) est ½ et sans réel saisi, ajouter l'excédent estimé
  let edfOverage = 0
  for (const reading of readings.value) {
    const templateLineId = reading.meter?.budgetLine?._id || reading.meter?.budgetLine
    if (!templateLineId) continue
    const sheetLine = lines.value.find(
      (l) => String(l.templateLine?._id || l.templateLine) === String(templateLineId),
    )
    if (!sheetLine?.isShared || sheetLine.actualAmount) continue
    const estimated = computeEDF(reading)
    if (estimated === null) continue
    const overage = estimated - (sheetLine.plannedAmount || 0)
    if (overage > 0) edfOverage += overage
  }

  const adjustedSharedSum = sharedSum + edfOverage
  const total = adjustedSharedSum + partnerRentAmount
  const userFairShare = total / 2
  const amountToSend = userFairShare - partnerRentAmount

  return { sharedSum: adjustedSharedSum, edfOverage, partnerRentAmount, total, userFairShare, amountToSend }
})

// ─── Helpers ─────────────────────────────────────────────
// fmt() et fmtDate() viennent de @/utils/formatters.js

function remaining(line) {
  if (line.flow === 'income') return (line.actualAmount || 0) - (line.plannedAmount || 0)
  return (line.plannedAmount || 0) - (line.actualAmount || 0)
}
function actualClass(line) {
  if (!line.actualAmount) return ''
  if (line.flow === 'income') return 'text-income'
  return 'text-expense'
}
function remainingClass(line) {
  const r = remaining(line)
  if (r > 0) return 'text-ok'
  if (r < 0) return 'text-over'
  return ''
}

const statusLabel = { active: 'Actif', draft: 'Brouillon', archived: 'Archivé' }
const statusColor = { active: '#16a34a', draft: '#f59e0b', archived: '#9ca3af' }

const pendingStatus = ref('')
watch(() => currentSheet.value?._id, () => {
  pendingStatus.value = currentSheet.value?.status || ''
}, { immediate: true })

async function applyRentPlanned() {
  if (!sharing.value || !settings.value?.rentBudgetLine) return
  const templateLineId = settings.value.rentBudgetLine._id || settings.value.rentBudgetLine
  const rentLine = lines.value.find(
    (l) => (l.templateLine?._id || l.templateLine) === templateLineId,
  )
  if (!rentLine) return
  const amount = Math.abs(sharing.value.amountToSend)
  const res = await updateSheetLine(currentSheet.value._id, rentLine._id, { plannedAmount: amount })
  Object.assign(rentLine, res.data)
}

async function applyStatus() {
  const newStatus = pendingStatus.value
  if (newStatus === currentSheet.value.status) return

  if (newStatus === 'active') {
    const otherActive = sheets.value.filter(
      (s) => s._id !== currentSheet.value._id && s.status === 'active'
    )
    if (otherActive.length) {
      const names = otherActive.map((s) => s.name).join(', ')
      const ok = confirm(`"${names}" est actuellement actif et sera archivé. Continuer ?`)
      if (!ok) {
        pendingStatus.value = currentSheet.value.status
        return
      }
      await Promise.all(otherActive.map((s) => updateSheet(s._id, { status: 'archived' })))
    }
  }

  await updateSheet(currentSheet.value._id, { status: newStatus })
  await loadSheets()
  currentSheet.value = sheets.value.find((s) => s._id === currentSheet.value._id)
}

// ─── Ajout ligne dépense dans le sheet ───────────────────
const addingLineSectionId = ref(null)

function defaultExpenseForm() {
  return {
    label: '',
    amount: 0,
    details: '',
    fromAccount: '',
    toAccount: '',
    paymentMethod: 'CB',
    isShared: false,
    theme: null,
  }
}
const newExpenseLineForm = ref(defaultExpenseForm())

function startAddExpenseLine(sectionId) {
  addingLineSectionId.value = sectionId
  newExpenseLineForm.value = defaultExpenseForm()
}

function cancelAddExpenseLine() {
  addingLineSectionId.value = null
}

async function submitAddExpenseLine(sectionId) {
  if (!newExpenseLineForm.value.label.trim()) return
  const f = newExpenseLineForm.value
  const data = {
    label: f.label,
    plannedAmount: 0,
    actualAmount: 0,
    flow: 'expense',
    section: sectionId === 'none' ? undefined : sectionId,
    fromAccount: f.fromAccount || undefined,
    toAccount: f.toAccount || undefined,
    paymentMethod: f.paymentMethod || undefined,
    isShared: f.isShared,
    theme: f.theme || undefined,
  }
  const { data: line } = await createSheetLine(currentSheet.value._id, data)
  // Le 1er montant saisi à la création devient la première transaction de la ligne
  const amount = parseFloat(f.amount)
  if (amount) {
    await createTransaction({
      sheet: currentSheet.value._id,
      budgetLine: line._id,
      label: f.label,
      details: (f.details || '').trim() || undefined,
      amount,
      flow: 'expense',
      account: f.fromAccount || undefined,
      date: new Date().toISOString().substring(0, 10),
    })
  }
  cancelAddExpenseLine()
  await reloadLines()
  buildLineTxMap((await getSheetTransactions(currentSheet.value._id)).data)
}

// ─── Édition d'une ligne (Depuis/Vers/Paiement/½) ────────
const editingLineId = ref(null)
const editLineBuffer = ref({})
const paymentMethods = ['CB', 'virement', 'especes', 'autre']

function startEditLine(line) {
  editingLineId.value = line._id
  editLineBuffer.value = {
    fromAccount: line.fromAccount?._id || '',
    toAccount: line.toAccount?._id || '',
    paymentMethod: line.paymentMethod || 'CB',
    isShared: line.isShared,
    theme: line.theme?._id || line.theme || null,
  }
}

function cancelEditLine() {
  editingLineId.value = null
}

function closeLinePanel() {
  openLineId.value = null
  cancelEditLine()
}

function toggleLineEdit(line) {
  if (openLineId.value === line._id) {
    closeLinePanel()
  } else {
    openLineId.value = line._id
    startEditLine(line)
  }
}

async function saveEditLine(line) {
  const data = { ...editLineBuffer.value }
  if (!data.fromAccount) delete data.fromAccount
  if (!data.toAccount) delete data.toAccount
  const res = await updateSheetLine(currentSheet.value._id, line._id, data)
  Object.assign(line, res.data)
  closeLinePanel()
}

// ─── Montant réel direct ──────────────────────────────────
const incomeActualEdits = ref({})

function initIncomeActualEdit(line) {
  incomeActualEdits.value[line._id] = line.actualAmount ?? 0
}

async function saveIncomeActual(line) {
  const val = parseFloat(incomeActualEdits.value[line._id])
  if (isNaN(val)) return
  const res = await updateSheetLine(currentSheet.value._id, line._id, { actualAmount: val })
  Object.assign(line, res.data)
}

async function saveIncomeAccount(line, accountId) {
  const res = await updateSheetLine(currentSheet.value._id, line._id, {
    toAccount: accountId || null,
  })
  Object.assign(line, res.data)
}

async function deleteLine(lineId) {
  await deleteSheetLine(currentSheet.value._id, lineId)
  await reloadLines()
}

// ─── Modal ligne de dépense (ajout / édition) ─────────────
const lineModalOpen = ref(false)
const lineModalMode = ref('add') // 'add' | 'edit'
const lineModalSectionId = ref(null)
const lineModalLine = ref(null)
const lineForm = ref({})

const accountOptions = computed(() =>
  accounts.value.map((a) => ({ value: a._id, label: a.name })),
)
const paymentOptions = computed(() => paymentMethods.map((m) => ({ value: m, label: m })))

function openAddLineModal(sectionId) {
  lineModalMode.value = 'add'
  lineModalSectionId.value = sectionId
  lineModalLine.value = null
  lineForm.value = {
    label: '',
    amount: '',
    details: '',
    fromAccount: settings.value?.mainAccount?._id || settings.value?.mainAccount || '',
    toAccount: '',
    paymentMethod: 'CB',
    isShared: false,
    theme: null,
  }
  lineModalOpen.value = true
}

function openEditLineModal(line) {
  lineModalMode.value = 'edit'
  lineModalLine.value = line
  lineForm.value = {
    label: line.label || '',
    fromAccount: line.fromAccount?._id || line.fromAccount || '',
    toAccount: line.toAccount?._id || line.toAccount || '',
    paymentMethod: line.paymentMethod || 'CB',
    isShared: !!line.isShared,
    theme: line.theme?._id || line.theme || null,
  }
  lineModalOpen.value = true
}

function closeLineModal() {
  lineModalOpen.value = false
}

async function saveLineModal() {
  const f = lineForm.value
  if (!f.label.trim()) return

  if (lineModalMode.value === 'add') {
    const data = {
      label: f.label,
      plannedAmount: 0,
      actualAmount: 0,
      flow: 'expense',
      section: lineModalSectionId.value === 'none' ? undefined : lineModalSectionId.value,
      fromAccount: f.fromAccount || undefined,
      toAccount: f.toAccount || undefined,
      paymentMethod: f.paymentMethod || undefined,
      isShared: f.isShared,
      theme: f.theme || undefined,
    }
    const { data: line } = await createSheetLine(currentSheet.value._id, data)
    const amount = parseFloat(f.amount)
    if (amount) {
      await createTransaction({
        sheet: currentSheet.value._id,
        budgetLine: line._id,
        label: f.label,
        details: (f.details || '').trim() || undefined,
        theme: f.theme || undefined,
        amount,
        flow: 'expense',
        account: f.fromAccount || undefined,
        paymentMethod: f.paymentMethod || undefined,
        isShared: f.isShared,
        date: defaultTxDate(line),
      })
    }
    await reloadLines()
    buildLineTxMap((await getSheetTransactions(currentSheet.value._id)).data)
  } else {
    const line = lineModalLine.value
    const res = await updateSheetLine(currentSheet.value._id, line._id, {
      label: f.label,
      fromAccount: f.fromAccount || null,
      toAccount: f.toAccount || null,
      paymentMethod: f.paymentMethod || undefined,
      isShared: f.isShared,
      theme: f.theme || null,
    })
    Object.assign(line, res.data)
  }
  lineModalOpen.value = false
}

async function deleteFromModal() {
  if (lineModalLine.value) await deleteLine(lineModalLine.value._id)
  lineModalOpen.value = false
}

// ─── Transactions par ligne de dépense ───────────────────
// Chaque ligne (ex: "Intermarché") agrège plusieurs entrées (les courses).
// Le total réel de la ligne = somme des transactions (maintenu côté backend).
const openTxLineId = ref(null)
const lineTxs = ref({}) // { [lineId]: [transaction] }
const newLineTxForms = ref({}) // { [lineId]: { amount, details } }

function defaultLineTxForm() {
  return { amount: '', details: '', theme: null }
}

// Date par défaut d'une entrée :
//  - si la ligne a un "jour récurrent" (facture, défini dans le template) → ce jour appliqué au mois du sheet
//  - sinon → aujourd'hui
function pad2(n) {
  return String(n).padStart(2, '0')
}
function defaultTxDate(line) {
  const day = line?.recurringDay
  const pm = currentSheet.value?.periodMonth
  if (day && pm) {
    const d = new Date(pm)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(day)}`
  }
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

function lineEntries(line) {
  return lineTxs.value[line._id] || []
}

// Date affichée sur la ligne : celle de l'entrée unique, sinon "—" (plusieurs entrées → voir le déroulé)
function lineDate(line) {
  const entries = lineEntries(line)
  return entries.length === 1 ? entries[0].date : null
}

// Résout un thème (id ou objet déjà peuplé) en objet { name, color }
function resolveTheme(t) {
  if (!t) return null
  if (typeof t === 'object') return t
  return themes.value.find((x) => x._id === t) || null
}

// Thème effectif d'une entrée : le sien, sinon repli sur le thème de la ligne (anciennes entrées)
function entryThemeId(line, t) {
  return (t.theme?._id || t.theme) || (line.theme?._id || line.theme) || null
}
function entryTheme(line, t) {
  return resolveTheme(entryThemeId(line, t))
}

// Badge thème du parent : affiché seulement si toutes les entrées partagent UN SEUL thème.
// Plusieurs thèmes différents → pas de badge (on déroule pour voir chacune).
function lineThemeBadge(line) {
  const entries = lineEntries(line)
  if (!entries.length) return resolveTheme(line.theme)
  const ids = new Set(entries.map((t) => entryThemeId(line, t)))
  return ids.size === 1 ? resolveTheme([...ids][0]) : null
}

// Au moins une entrée partagée ½
function lineHasShared(line) {
  return lineEntries(line).some((t) => t.isShared)
}

function toggleLineTx(line) {
  if (openTxLineId.value === line._id) {
    openTxLineId.value = null
    return
  }
  openTxLineId.value = line._id
  if (!newLineTxForms.value[line._id]) {
    newLineTxForms.value[line._id] = {
      amount: '',
      details: '',
      theme: line.theme?._id || line.theme || null, // pré-remplissage du thème
    }
  }
}

async function submitLineTx(line) {
  const form = newLineTxForms.value[line._id]
  const amount = parseFloat(form?.amount)
  if (!amount) return
  const { data: tx } = await createTransaction({
    sheet: currentSheet.value._id,
    budgetLine: line._id,
    label: line.label,
    details: (form.details || '').trim() || undefined,
    theme: form.theme || undefined,
    amount,
    flow: 'expense',
    account: line.fromAccount?._id || line.fromAccount || undefined,
    date: defaultTxDate(line),
  })
  lineTxs.value[line._id] = [...(lineTxs.value[line._id] || []), tx]
  line.actualAmount = (line.actualAmount || 0) + amount // miroir du $inc backend
  // on garde le thème choisi pour l'entrée suivante (pré-remplissage)
  newLineTxForms.value[line._id] = { amount: '', details: '', theme: form.theme || null }
}

async function deleteLineTx(line, txId) {
  const tx = (lineTxs.value[line._id] || []).find((t) => t._id === txId)
  await deleteTransaction(txId)
  lineTxs.value[line._id] = (lineTxs.value[line._id] || []).filter((t) => t._id !== txId)
  if (tx) line.actualAmount = (line.actualAmount || 0) - tx.amount
}

// ─── Édition d'une entrée (montant / détails / date) ──────
const editingTxId = ref(null)
const editTxBuffer = ref({ amount: '', details: '', date: '', theme: null })

function startEditTx(t) {
  editingTxId.value = t._id
  editTxBuffer.value = {
    amount: t.amount,
    details: t.details || '',
    date: new Date(t.date).toISOString().substring(0, 10),
    theme: t.theme?._id || t.theme || null,
  }
}

function cancelEditTx() {
  editingTxId.value = null
}

async function saveEditTx(line, t) {
  const amount = parseFloat(editTxBuffer.value.amount)
  if (isNaN(amount)) return
  const { data: updated } = await updateTransaction(t._id, {
    amount,
    details: (editTxBuffer.value.details || '').trim() || undefined,
    theme: editTxBuffer.value.theme || null,
    date: editTxBuffer.value.date,
  })
  const arr = lineTxs.value[line._id] || []
  const idx = arr.findIndex((x) => x._id === t._id)
  const oldAmount = idx !== -1 ? arr[idx].amount : 0
  if (idx !== -1) arr[idx] = updated
  line.actualAmount = (line.actualAmount || 0) + (amount - oldAmount)
  editingTxId.value = null
}

// ─── Modal entrée (ajout / édition d'une sous-ligne) ──────
const txModalOpen = ref(false)
const txModalMode = ref('add') // 'add' | 'edit'
const txModalLine = ref(null)
const txModalTx = ref(null)
const txForm = ref({})

function openAddTxModal(line) {
  txModalMode.value = 'add'
  txModalLine.value = line
  txModalTx.value = null
  const prev = newLineTxForms.value[line._id] || {}
  txForm.value = {
    amount: '',
    details: '',
    theme: prev.theme || line.theme?._id || line.theme || null,
    account:
      line.fromAccount?._id ||
      line.fromAccount ||
      settings.value?.mainAccount?._id ||
      settings.value?.mainAccount ||
      '',
    paymentMethod: line.paymentMethod || 'CB',
    isShared: !!line.isShared,
    date: defaultTxDate(line),
  }
  txModalOpen.value = true
}

function openEditTxModal(line, t) {
  txModalMode.value = 'edit'
  txModalLine.value = line
  txModalTx.value = t
  txForm.value = {
    amount: t.amount,
    details: t.details || '',
    theme: t.theme?._id || t.theme || line.theme?._id || line.theme || null,
    account: t.account?._id || t.account || '',
    paymentMethod: t.paymentMethod || 'CB',
    isShared: !!t.isShared,
    date: new Date(t.date).toISOString().substring(0, 10),
  }
  txModalOpen.value = true
}

function closeTxModal() {
  txModalOpen.value = false
}

async function saveTxModal() {
  const f = txForm.value
  const amount = parseFloat(f.amount)
  if (isNaN(amount) || !amount) return
  const line = txModalLine.value

  if (txModalMode.value === 'add') {
    const { data: tx } = await createTransaction({
      sheet: currentSheet.value._id,
      budgetLine: line._id,
      label: line.label,
      details: (f.details || '').trim() || undefined,
      theme: f.theme || undefined,
      amount,
      flow: 'expense',
      account: f.account || undefined,
      paymentMethod: f.paymentMethod || undefined,
      isShared: f.isShared,
      date: f.date,
    })
    lineTxs.value[line._id] = [...(lineTxs.value[line._id] || []), tx]
    line.actualAmount = (line.actualAmount || 0) + amount
    // mémorise le thème pour pré-remplir la prochaine entrée
    newLineTxForms.value[line._id] = { amount: '', details: '', theme: f.theme || null }
  } else {
    const t = txModalTx.value
    const { data: updated } = await updateTransaction(t._id, {
      details: (f.details || '').trim() || undefined,
      theme: f.theme || null,
      amount,
      account: f.account || null,
      paymentMethod: f.paymentMethod || undefined,
      isShared: f.isShared,
      date: f.date,
    })
    const arr = lineTxs.value[line._id] || []
    const idx = arr.findIndex((x) => x._id === t._id)
    const oldAmount = idx !== -1 ? arr[idx].amount : 0
    if (idx !== -1) arr[idx] = updated
    line.actualAmount = (line.actualAmount || 0) + (amount - oldAmount)
  }
  txModalOpen.value = false
}

// ─── Contexte passé à <SectionCard> (évite ~20 props) ─────
const sectionCtx = {
  toggleSection,
  isSectionOpen,
  openAddLineModal,
  openEditLineModal,
  isTxOpen: (line) => openTxLineId.value === line._id,
  toggleLineTx,
  lineEntries,
  lineThemeBadge,
  lineDate,
  lineHasShared,
  entryTheme,
  actualClass,
  remainingClass,
  remaining,
  openEditTxModal,
  openAddTxModal,
  deleteLineTx,
  fmt,
  fmtDate,
}

// ─── Ajout revenu (nouvelle ligne) ───────────────────────
const showAddIncomeLine = ref(false)
const newIncomeLineForm = ref({ label: '', plannedAmount: 0, toAccount: '' })

async function submitAddIncomeLine() {
  if (!newIncomeLineForm.value.label.trim()) return
  const data = {
    label: newIncomeLineForm.value.label,
    plannedAmount: newIncomeLineForm.value.plannedAmount,
    flow: 'income',
    toAccount: newIncomeLineForm.value.toAccount || undefined,
  }
  await createSheetLine(currentSheet.value._id, data)
  newIncomeLineForm.value = { label: '', plannedAmount: 0, toAccount: '' }
  showAddIncomeLine.value = false
  await reloadLines()
}

// ─── Mensualité objectif ──────────────────────────────────
// Solde réel par compte (même logique que l'onglet Objectifs) → cohérence des mensualités
const liveBalanceByAccount = computed(() => {
  const mainAccountId = settings.value?.mainAccount?._id || settings.value?.mainAccount || null
  const deltaMap = computeAccountDeltaMap({
    lines: lines.value,
    contributions: contributions.value,
    investmentTxs: investmentTxs.value,
    goals: goals.value,
    mainAccountId,
  })
  const result = {}
  accounts.value.forEach((a) => {
    result[a._id] = resolveBalance(snapshotMap.value, deltaMap, a._id)
  })
  return result
})

function goalCurrentAmount(goal) {
  const accountId = goal.account?._id || goal.account
  const live = liveBalanceByAccount.value[accountId]
  return live !== null && live !== undefined ? live : (goal.currentAmount || 0)
}

function goalMonthly(goal) {
  if (!goal.deadline) return null
  const now = new Date()
  const end = new Date(goal.deadline)
  const months = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth())
  if (months <= 0) return null
  const remaining = (goal.targetAmount || 0) - goalCurrentAmount(goal)
  if (remaining <= 0) return 0
  return Math.ceil((remaining / months) * 100) / 100
}

// ─── Ouvrir/fermer panneau objectif / investissement ─────
const openGoalId = ref(null)
const openInvestmentId = ref(null)

function toggleGoal(id) {
  openGoalId.value = openGoalId.value === id ? null : id
  if (openGoalId.value) initContribForm(id)
}
function toggleInvestment(id) {
  openInvestmentId.value = openInvestmentId.value === id ? null : id
  if (openInvestmentId.value) initInvestTxForm(id)
}
</script>

<template>
  <div>
    <!-- ─── Header ─────────────────────────────────────── -->
    <div class="flex items-start justify-between mb-5">
      <div>
        <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Sheet du mois</h1>
        <p class="text-[13px] text-gray-400 mt-0.75">Suivi budgétaire mensuel</p>
      </div>
      <div class="flex gap-2.5 items-center">
        <select
          v-if="sheets.length"
          v-model="currentSheet"
          class="py-1.75 px-2.5 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-[13px] text-gray-950 dark:text-gray-100 bg-white dark:bg-gray-800 outline-none cursor-pointer min-w-40"
          @change="openSheet(currentSheet._id)"
        >
          <option v-for="s in sheets" :key="s._id" :value="s">{{ s.name }}</option>
        </select>
        <button
          class="flex items-center gap-1.5 py-2 px-3.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-[7px] text-[13px] font-medium cursor-pointer"
          @click="openCreateForm"
        >
          <font-awesome-icon icon="plus" /> Nouveau sheet
        </button>
      </div>
    </div>

    <!-- ─── Formulaire création ───────────────────────── -->
    <div v-if="showCreateForm" class="glass-card px-5 py-4.5 mb-5">
      <h3 class="text-[14px] font-semibold text-gray-950 dark:text-gray-100 mb-3.5">Nouveau sheet</h3>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Nom</label>
        <input v-model="newSheetForm.name" class="py-1.75 px-2.5 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-[13px] text-gray-950 dark:text-gray-100 outline-none bg-gray-50 dark:bg-gray-700 focus:border-violet-500" placeholder="Ex: Mars 2026" autofocus />
      </div>
      <div class="my-3.5 flex flex-col gap-2">
        <p class="text-xs font-semibold text-gray-500 uppercase tracking-[0.04em] mb-1">Solde début de mois (par compte)</p>
        <div v-for="account in accounts" :key="account._id" class="flex items-center gap-2.5">
          <label class="text-[13px] text-gray-700 dark:text-gray-300 w-35 shrink-0">{{ account.name }}</label>
          <input
            v-model.number="newSheetSnapshots[account._id]"
            type="number"
            step="0.01"
            class="w-30 py-1.75 px-2.5 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-[13px] text-gray-950 dark:text-gray-100 outline-none bg-gray-50 dark:bg-gray-700"
            placeholder="0.00"
            @keyup.enter="submitCreate"
          />
        </div>
      </div>
      <div class="flex gap-2">
        <button class="flex items-center gap-1.5 py-2 px-3.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-[7px] text-[13px] font-medium cursor-pointer" @click="submitCreate">Créer depuis le template</button>
        <button class="py-1.75 px-3 bg-transparent text-gray-500 dark:text-gray-400 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-[13px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700" @click="showCreateForm = false">Annuler</button>
      </div>
    </div>

    <!-- ─── Aucun sheet ───────────────────────────────── -->
    <div v-if="!currentSheet && sheets.length === 0" class="text-center py-15 flex flex-col items-center gap-4 text-gray-400">
      <p>Aucun sheet pour l'instant.</p>
      <button class="flex items-center gap-1.5 py-2 px-3.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-[7px] text-[13px] font-medium cursor-pointer" @click="showCreateForm = true">
        <font-awesome-icon icon="plus" /> Créer le premier sheet
      </button>
    </div>

    <!-- ─── Contenu du sheet ──────────────────────────── -->
    <div v-if="currentSheet" class="flex flex-col gap-4">
      <!-- Titre sheet + statut -->
      <div class="flex items-center gap-2.5">
        <h2 class="text-[18px] font-bold text-gray-950 dark:text-gray-50">{{ currentSheet.name }}</h2>
        <span
          class="text-[11.5px] font-semibold py-0.5 px-2.25 rounded-full"
          :style="{
            background: statusColor[currentSheet.status] + '22',
            color: statusColor[currentSheet.status],
          }"
        >
          {{ statusLabel[currentSheet.status] }}
        </span>
        <select class="py-1 px-2 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 outline-none cursor-pointer" v-model="pendingStatus">
          <option value="active">Actif</option>
          <option value="draft">Brouillon</option>
          <option value="archived">Archivé</option>
        </select>
        <button
          v-if="pendingStatus !== currentSheet.status"
          class="py-1 px-3 border-none rounded-md text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white cursor-pointer"
          @click="applyStatus"
        >Valider</button>
      </div>

      <!-- ─── Bilan mensuel ─────────────────────────── -->
      <div class="glass-card overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 class="flex items-center gap-2 text-[13px] font-semibold text-gray-950 dark:text-gray-100">
            <font-awesome-icon icon="chart-bar" /> Bilan du mois
          </h3>
          <button
            class="text-[11.5px] py-0.75 px-2.5 border border-[#e8e8e5] dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
            @click="showAccountBalances = !showAccountBalances"
          >
            {{ showAccountBalances ? '▲ Masquer comptes' : '▼ Soldes des comptes' }}
          </button>
        </div>
        <div class="grid grid-cols-4">
          <div class="kpi-tile flex items-start gap-3">
            <span class="kpi-icon kpi-icon--green"><font-awesome-icon icon="wallet" /></span>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[22px] font-bold tracking-tight leading-tight" :class="bilan.resteReel >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'">
                {{ fmt(bilan.resteReel) }} €
              </span>
              <span class="text-[11.5px] text-gray-400 font-medium truncate">Reste réel{{ settings?.mainAccount ? ' — ' + (settings.mainAccount.name || '') : '' }}</span>
              <span v-if="!settings?.mainAccount" class="text-[11px] text-amber-500">Configurer un compte principal</span>
            </div>
          </div>
          <div class="kpi-tile flex items-start gap-3">
            <span class="kpi-icon kpi-icon--red"><font-awesome-icon icon="credit-card" /></span>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[22px] font-bold tracking-tight leading-tight text-red-500">{{ fmt(bilan.totalActualExpense) }} €</span>
              <span class="text-[11.5px] text-gray-400 font-medium truncate">Dépenses{{ bilan.mainAccountName ? ' — ' + bilan.mainAccountName : '' }}</span>
            </div>
          </div>
          <div class="kpi-tile flex items-start gap-3">
            <span class="kpi-icon kpi-icon--gray"><font-awesome-icon icon="file-invoice" /></span>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[22px] font-bold tracking-tight leading-tight text-gray-950 dark:text-gray-50">{{ fmt(bilan.totalPlannedExpense) }} €</span>
              <span class="text-[11.5px] text-gray-400 font-medium truncate">Dépenses fixes prévues</span>
            </div>
          </div>
          <div class="kpi-tile flex items-start gap-3">
            <span class="kpi-icon kpi-icon--violet"><font-awesome-icon icon="piggy-bank" /></span>
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-[22px] font-bold tracking-tight leading-tight" :class="bilan.restantEconomie <= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'">
                {{ fmt(bilan.restantEconomie) }} €
              </span>
              <span class="text-[11.5px] text-gray-400 font-medium truncate">À économiser ({{ bilan.savingRate }}%)</span>
              <span class="text-[11px] text-gray-500 dark:text-gray-400">{{ fmt(bilan.dejaMisDeCote) }} / {{ fmt(bilan.montantEconomie) }} € mis de côté</span>
            </div>
          </div>
        </div>

        <!-- Soldes temps réel par compte -->
        <div v-show="showAccountBalances" class="border-t border-gray-100 dark:border-gray-700 px-4 py-2.5 flex flex-col gap-1.5">
          <div
            v-for="item in liveAccountBalances"
            :key="item.account._id"
            class="grid grid-cols-[1fr_90px_24px_90px] items-center text-[13px] py-1 border-b border-gray-50 dark:border-gray-700 last:border-b-0"
          >
            <span class="font-medium flex items-center gap-1.5 text-gray-700 dark:text-gray-200">
              {{ item.account.name }}
              <span class="text-[10px] font-normal text-gray-400 bg-gray-100 dark:bg-gray-700 rounded px-1 py-px">{{ item.account.type }}</span>
            </span>
            <span class="text-right text-gray-400 text-xs">
              {{ item.snapshot !== null ? fmt(item.snapshot) + ' €' : '—' }}
            </span>
            <span class="text-center text-gray-300">→</span>
            <span
              class="text-right font-semibold"
              :class="item.current !== null && item.current >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'"
            >
              {{ item.current !== null ? fmt(item.current) + ' €' : '—' }}
            </span>
          </div>
        </div>
      </div>

      <!-- ─── Grille 2 colonnes ──────────────────── -->
      <div class="flex gap-5 items-start">
        <!-- ─── Colonne gauche ─────────────────────────── -->
        <div class="flex-1 min-w-0 flex flex-col gap-5">
        <!-- ─── Revenus ──────────────────────────────── -->
        <div class="glass-card overflow-hidden">
          <div class="flex items-center justify-between text-[13px] font-semibold text-gray-950 dark:text-gray-100 px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-green-50 dark:bg-green-950/20">
            <span class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background: #16a34a"></span>
              Revenus
            </span>
            <button class="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 hover:bg-green-200 dark:hover:bg-green-900/70 border-none rounded-md py-1 px-2.5 cursor-pointer font-medium" @click="showAddIncomeLine = !showAddIncomeLine">
              <font-awesome-icon icon="plus" /> Ajouter
            </button>
          </div>
          <div v-if="showAddIncomeLine" class="flex gap-2 items-center flex-wrap px-4 py-2.5 bg-green-50 dark:bg-green-950/20 border-b border-green-100 dark:border-green-900/50">
            <input
              v-model="newIncomeLineForm.label"
              class="tx-input"
              placeholder="Ex: Salaire, Prime…"
              autofocus
              @keyup.enter="submitAddIncomeLine"
            />
            <input
              v-model.number="newIncomeLineForm.plannedAmount"
              type="number"
              step="0.01"
              class="tx-input tx-input--amount"
              placeholder="Prévu €"
            />
            <select v-model="newIncomeLineForm.toAccount" class="tx-select">
              <option value="">— Compte —</option>
              <option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option>
            </select>
            <button class="btn-tx-add btn-tx-add--income" @click="submitAddIncomeLine">Ajouter</button>
            <button class="bg-transparent border-none text-gray-400 hover:text-red-500 cursor-pointer text-[14px] px-1" @click="showAddIncomeLine = false">✕</button>
          </div>
          <div class="lines-table">
            <div class="lines-head lines-head--norest">
              <span>Description</span>
              <span class="col-r">Prévu</span>
              <span class="col-r">Réel</span>
              <span class="col-flags"></span>
              <span></span>
            </div>
            <div v-for="line in incomeLines" :key="line._id" class="line-wrap">
              <div
                class="line-row line-row--income line-row--norest"
                :class="{ 'line-row--open': openLineId === line._id }"
              >
                <span class="line-label">{{ line.label }}</span>
                <span class="col-r line-planned">{{ fmt(line.plannedAmount) }} €</span>
                <span class="col-r">
                  <input
                    type="number"
                    step="0.01"
                    class="inline-actual-input text-income"
                    :value="incomeActualEdits[line._id] ?? line.actualAmount"
                    @focus="initIncomeActualEdit(line)"
                    @input="incomeActualEdits[line._id] = $event.target.value"
                    @blur="saveIncomeActual(line)"
                    @keyup.enter="saveIncomeActual(line)"
                    placeholder="0.00"
                  />
                </span>
                <span class="col-flags"></span>
                <button
                  class="btn-icon-action"
                  :class="{ active: openLineId === line._id }"
                  @click.stop="toggleLine(line._id)"
                  title="Options"
                >
                  <font-awesome-icon icon="pen" />
                </button>
              </div>
              <div v-if="openLineId === line._id" class="tx-panel" @click.stop>
                <div class="income-actual-form">
                  <label class="income-actual-label">Compte</label>
                  <select
                    class="tx-select"
                    :value="line.toAccount?._id || line.toAccount || ''"
                    @change="saveIncomeAccount(line, $event.target.value)"
                  >
                    <option value="">— Compte —</option>
                    <option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option>
                  </select>
                  <button
                    class="btn-tx-del"
                    style="margin-left: auto"
                    @click.stop="deleteLine(line._id)"
                    title="Supprimer"
                  >✕</button>
                </div>
              </div>
            </div>
            <div class="section-totals section-totals--norest dark:border-gray-700">
              <span class="totals-label">Total</span>
              <span class="col-r totals-val"
                >{{ fmt(incomeLines.reduce((s, l) => s + (l.plannedAmount || 0), 0)) }} €</span
              >
              <span class="col-r totals-val text-income"
                >{{ fmt(incomeLines.reduce((s, l) => s + (l.actualAmount || 0), 0)) }} €</span
              >
              <span class="col-flags"></span>
            </div>
          </div>
        </div>

        <!-- ─── Sections (colonne gauche) ─────────────── -->
        <SectionCard
          v-for="group in sectionsLeft"
          :key="group.section._id"
          :group="group"
          :ctx="sectionCtx"
        />
        <!-- ─── Objectifs d'épargne ───────────────────── -->
        <div v-if="goals.length" class="glass-card overflow-hidden">
          <h3 class="flex items-center gap-2 text-[13px] font-semibold text-gray-950 dark:text-gray-100 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <font-awesome-icon icon="piggy-bank" /> Objectifs d'épargne
          </h3>
          <div class="lines-table">
            <div class="lines-head">
              <span>Objectif</span>
              <span class="col-r">Mensualité</span>
              <span class="col-r">Versé ce mois</span>
              <span class="col-r">Reste</span>
              <span class="col-flags"></span>
            </div>
            <div v-for="goal in goals" :key="goal._id" class="line-wrap">
              <div
                class="line-row"
                :class="{ 'line-row--open': openGoalId === goal._id }"
                @click="toggleGoal(goal._id)"
              >
                <span class="line-label">
                  <span class="line-chevron">{{ openGoalId === goal._id ? '▼' : '▶' }}</span>
                  {{ goal.name }}
                </span>
                <span class="col-r line-planned">{{ goalMonthly(goal) !== null ? fmt(goalMonthly(goal)) + ' €' : '—' }}</span>
                <span
                  class="col-r line-actual"
                  :class="totalContribForGoal(goal._id) > 0 ? 'text-income' : ''"
                >
                  {{ fmt(totalContribForGoal(goal._id)) }} €
                </span>
                <span
                  class="col-r line-remaining"
                  :class="goalMonthly(goal) !== null ? ((goalMonthly(goal) - totalContribForGoal(goal._id)) <= 0 ? 'text-ok' : 'text-over') : ''"
                >
                  {{ goalMonthly(goal) !== null ? fmt(goalMonthly(goal) - totalContribForGoal(goal._id)) + ' €' : '—' }}
                </span>
                <span class="col-flags"></span>
              </div>

              <!-- Panneau versements -->
              <div v-if="openGoalId === goal._id" class="tx-panel">
                <div v-if="contribsForGoal(goal._id).length" class="tx-list">
                  <div v-for="c in contribsForGoal(goal._id)" :key="c._id" class="tx-row">
                    <span class="tx-date">{{ fmtDate(c.date) }}</span>
                    <span class="tx-label">{{ c.notes || '—' }}</span>
                    <span class="tx-account"></span>
                    <span class="tx-amount tx-income">+{{ fmt(c.amount) }} €</span>
                    <button class="btn-tx-del" @click.stop="deleteContrib(c._id)" title="Supprimer">
                      ✕
                    </button>
                  </div>
                </div>
                <p v-else class="tx-empty">Aucun versement ce mois</p>

                <div class="tx-add-form" @click.stop>
                  <input
                    v-model.number="newContribForms[goal._id].amount"
                    type="number"
                    step="0.01"
                    class="tx-input tx-input--amount"
                    placeholder="Montant €"
                    @keyup.enter="submitContrib(goal._id)"
                  />
                  <input
                    v-model="newContribForms[goal._id].date"
                    type="date"
                    class="tx-input tx-input--date"
                  />
                  <input
                    v-model="newContribForms[goal._id].notes"
                    class="tx-input"
                    placeholder="Notes (optionnel)"
                  />
                  <button class="btn-tx-add" @click.stop="submitContrib(goal._id)">
                    <font-awesome-icon icon="plus" /> Verser
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ─── Investissements ───────────────────────── -->
        <div v-if="investments.length" class="glass-card overflow-hidden">
          <h3 class="flex items-center gap-2 text-[13px] font-semibold text-gray-950 dark:text-gray-100 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <font-awesome-icon icon="chart-line" /> Investissements
          </h3>
          <div class="lines-table">
            <div class="lines-head">
              <span>Actif</span>
              <span class="col-r">DCA mensuel</span>
              <span class="col-r">Investi ce mois</span>
              <span class="col-r">Reste</span>
              <span class="col-flags"></span>
            </div>
            <div v-for="inv in investments" :key="inv._id" class="line-wrap">
              <div
                class="line-row"
                :class="{ 'line-row--open': openInvestmentId === inv._id }"
                @click="toggleInvestment(inv._id)"
              >
                <span class="line-label">
                  <span class="line-chevron">{{ openInvestmentId === inv._id ? '▼' : '▶' }}</span>
                  {{ inv.name }}
                  <span
                    v-if="inv.type"
                    class="theme-badge"
                    style="background: #f5f3ff; color: #7c3aed"
                    >{{ inv.type }}</span
                  >
                </span>
                <span class="col-r line-planned">{{ fmt(inv.monthlyInvestment) }} €</span>
                <span
                  class="col-r line-actual"
                  :class="totalInvestedThisSheet(inv._id) > 0 ? 'text-income' : ''"
                >
                  {{ fmt(totalInvestedThisSheet(inv._id)) }} €
                </span>
                <span
                  class="col-r line-remaining"
                  :class="
                    inv.monthlyInvestment - totalInvestedThisSheet(inv._id) > 0
                      ? 'text-ok'
                      : inv.monthlyInvestment - totalInvestedThisSheet(inv._id) < 0
                        ? 'text-over'
                        : ''
                  "
                >
                  {{ fmt(inv.monthlyInvestment - totalInvestedThisSheet(inv._id)) }} €
                </span>
                <span class="col-flags"></span>
              </div>

              <!-- Panneau transactions investissement -->
              <div v-if="openInvestmentId === inv._id" class="tx-panel">
                <div v-if="investTxsForInvestment(inv._id).length" class="tx-list">
                  <div v-for="t in investTxsForInvestment(inv._id)" :key="t._id" class="tx-row">
                    <span class="tx-date">{{ fmtDate(t.date) }}</span>
                    <span class="tx-label">{{ t.notes || '—' }}</span>
                    <span class="tx-account">{{ t.investment?.account?.name }}</span>
                    <span class="tx-amount tx-income">+{{ fmt(t.amount) }} €</span>
                    <button
                      class="btn-tx-del"
                      @click.stop="deleteInvestTx(t._id)"
                      title="Supprimer"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <p v-else class="tx-empty">Aucun investissement ce mois</p>

                <div class="tx-add-form" @click.stop>
                  <input
                    v-model.number="newInvestTxForms[inv._id].amount"
                    type="number"
                    step="0.01"
                    class="tx-input tx-input--amount"
                    placeholder="Montant €"
                    @keyup.enter="submitInvestTx(inv._id)"
                  />
                  <input
                    v-model="newInvestTxForms[inv._id].date"
                    type="date"
                    class="tx-input tx-input--date"
                  />
                  <input
                    v-model="newInvestTxForms[inv._id].notes"
                    class="tx-input"
                    placeholder="Notes (optionnel)"
                  />
                  <button class="btn-tx-add" @click.stop="submitInvestTx(inv._id)">
                    <font-awesome-icon icon="plus" /> Investir
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        </div>

        <!-- ─── Colonne droite ─────────────────────────── -->
        <div class="flex-1 min-w-0 flex flex-col gap-5">
        <SectionCard
          v-for="group in sectionsRight"
          :key="group.section._id"
          :group="group"
          :ctx="sectionCtx"
        />

        <!-- ─── Modules (objectifs, invest, énergie, 50/50, soldes) ─── -->

        <!-- ─── Relevés EDF ────────────────────────────── -->
        <div v-if="readings.length" class="glass-card overflow-hidden">
          <h3 class="flex items-center gap-2 text-[13px] font-semibold text-gray-950 dark:text-gray-100 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <font-awesome-icon icon="bolt" /> Relevés de compteurs
          </h3>
          <div v-for="reading in readings" :key="reading._id" class="edf-block">
            <div class="edf-header">
              <span class="edf-name">{{ reading.meter?.name }}</span>
              <div v-if="computeEDF(reading) !== null" class="edf-cost-block">
                <span class="edf-cost">Coût estimé : <strong>{{ fmt(computeEDF(reading)) }} €</strong></span>
                <span v-if="computeEDFDetail(reading)" class="edf-detail">
                  HP {{ computeEDFDetail(reading).hp }} kWh ×
                  {{ fmt(computeEDFDetail(reading).htHP) }} € · HC
                  {{ computeEDFDetail(reading).hc }} kWh ×
                  {{ fmt(computeEDFDetail(reading).htHC) }} € (×{{ computeEDFDetail(reading).tvaRate }}% TVA) + Abo {{ fmt(computeEDFDetail(reading).subscriptionPrice) }} €
                </span>
                <span
                  v-if="reading.meter?.budgetLine?.plannedAmount"
                  class="edf-delta"
                  :class="computeEDF(reading) <= reading.meter.budgetLine.plannedAmount ? 'edf-delta--ok' : 'edf-delta--over'"
                >
                  Mensualité {{ fmt(reading.meter.budgetLine.plannedAmount) }} € &mdash;
                  {{ computeEDF(reading) <= reading.meter.budgetLine.plannedAmount ? 'Économie' : 'Dépassement' }} :
                  <strong>{{ fmt(Math.abs(reading.meter.budgetLine.plannedAmount - computeEDF(reading))) }} €</strong>
                </span>
              </div>
            </div>
            <div class="edf-grid">
              <div class="edf-col">
                <label class="text-xs font-medium text-gray-500 dark:text-gray-400">HP précédent</label>
                <input v-model.number="reading.hpPrevious" type="number" class="py-1.75 px-2.5 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-[13px] text-gray-950 dark:text-gray-100 outline-none bg-gray-50 dark:bg-gray-700" @blur="saveReading(reading)" />
              </div>
              <div class="edf-col">
                <label class="text-xs font-medium text-gray-500 dark:text-gray-400">HP actuel</label>
                <input v-model.number="reading.hpCurrent" type="number" class="py-1.75 px-2.5 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-[13px] text-gray-950 dark:text-gray-100 outline-none bg-gray-50 dark:bg-gray-700" @blur="saveReading(reading)" />
              </div>
              <div class="edf-col">
                <label class="text-xs font-medium text-gray-500 dark:text-gray-400">HC précédent</label>
                <input v-model.number="reading.hcPrevious" type="number" class="py-1.75 px-2.5 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-[13px] text-gray-950 dark:text-gray-100 outline-none bg-gray-50 dark:bg-gray-700" @blur="saveReading(reading)" />
              </div>
              <div class="edf-col">
                <label class="text-xs font-medium text-gray-500 dark:text-gray-400">HC actuel</label>
                <input v-model.number="reading.hcCurrent" type="number" class="py-1.75 px-2.5 border border-[#e8e8e5] dark:border-gray-600 rounded-md text-[13px] text-gray-950 dark:text-gray-100 outline-none bg-gray-50 dark:bg-gray-700" @blur="saveReading(reading)" />
              </div>
            </div>
          </div>
        </div>

        <!-- ─── Calcul 50/50 ──────────────────────────── -->
        <div
          v-if="sharing && (sharing.sharedSum > 0 || sharing.partnerRentAmount > 0)"
          class="glass-card overflow-hidden"
        >
          <h3 class="flex items-center gap-2 text-[13px] font-semibold text-gray-950 dark:text-gray-100 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <font-awesome-icon icon="money-bill" /> Depenses partagées
          </h3>
          <div class="px-4 py-3.5 flex flex-col gap-1.5">
            <div class="flex justify-between text-[13px] text-gray-500 dark:text-gray-400 py-0.75">
              <span>Totale dépenses partagées</span>
              <span>{{ fmt(sharing.sharedSum) }} €</span>
            </div>
            <div class="flex justify-between text-[13px] text-gray-500 dark:text-gray-400 py-0.75">
              <span>Montant du loyer</span>
              <span>{{ fmt(sharing.partnerRentAmount) }} €</span>
            </div>
            <div class="flex justify-between text-[13px] py-0.75 border-t border-[#e8e8e5] dark:border-gray-600 pt-2 font-semibold text-gray-700 dark:text-gray-200">
              <span>Total commun</span>
              <span>{{ fmt(sharing.total) }} €</span>
            </div>
            <div class="flex justify-between text-[13px] text-gray-500 dark:text-gray-400 py-0.75">
              <span>Part juste de chacun</span>
              <span>{{ fmt(sharing.userFairShare) }} €</span>
            </div>
            <div class="flex justify-between items-center bg-violet-50 dark:bg-violet-950/30 rounded-lg px-3.5 py-2.5 mt-1.5 text-[14px] font-semibold text-violet-600 dark:text-violet-400">
              <span>Part du loyer</span>
              <span class="flex items-center gap-2.5">
                <span class="text-[18px]">{{ fmt(Math.abs(sharing.amountToSend)) }} €</span>
                <button
                  v-if="settings?.rentBudgetLine"
                  class="text-[11.5px] py-0.75 px-2.5 border border-violet-300 rounded-md bg-violet-50 dark:bg-violet-950/50 hover:bg-violet-100 dark:hover:bg-violet-950/70 text-violet-600 dark:text-violet-400 cursor-pointer font-medium"
                  @click="applyRentPlanned"
                  title="Pré-remplir le prévu de la ligne loyer"
                >↓ Appliquer au loyer</button>
              </span>
            </div>
          </div>
        </div>
        </div>
      </div>
      <!-- fin colonnes -->

      <!-- ─── Snapshots comptes (lecture seule) ────────── -->
      <div v-if="snapshots.length" class="glass-card overflow-hidden opacity-85">
        <h3 class="flex items-center gap-2 text-[13px] font-semibold text-gray-950 dark:text-gray-100 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <font-awesome-icon icon="building-columns" /> Solde début de mois
        </h3>
        <div class="flex flex-wrap gap-3 px-4 py-3.5">
          <div v-for="account in accounts" :key="account._id" class="flex items-center gap-2">
            <span class="text-[13px] font-medium text-gray-700 dark:text-gray-300 min-w-25">{{ account.name }}</span>
            <span class="font-semibold text-gray-700 dark:text-gray-200">
              {{ snapshotMap[account._id] != null ? fmt(snapshotMap[account._id]) + ' €' : '—' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Modal ligne de dépense (ajout / édition) ─────────── -->
    <AppModal
      v-if="lineModalOpen"
      :title="lineModalMode === 'add' ? 'Nouvelle dépense' : 'Modifier la dépense'"
      @close="closeLineModal"
    >
      <div class="form-grid">
        <div class="form-field">
          <label class="form-label">Description</label>
          <input
            v-model="lineForm.label"
            class="form-input"
            placeholder="Ex: Intermarché"
            @keyup.enter="saveLineModal"
          />
        </div>

        <div v-if="lineModalMode === 'add'" class="form-row">
          <div class="form-field form-field--grow">
            <label class="form-label">Montant (€)</label>
            <input
              v-model.number="lineForm.amount"
              type="number"
              step="0.01"
              class="form-input"
              placeholder="0.00"
            />
          </div>
          <div class="form-field form-field--grow">
            <label class="form-label">Détails (optionnel)</label>
            <input v-model="lineForm.details" class="form-input" placeholder="Ex: écouteurs" />
          </div>
        </div>

        <div class="form-field">
          <label class="form-label">Depuis</label>
          <ChipSelect v-model="lineForm.fromAccount" :options="accountOptions" allow-none />
        </div>
        <div class="form-field">
          <label class="form-label">Vers</label>
          <ChipSelect v-model="lineForm.toAccount" :options="accountOptions" allow-none />
        </div>

        <!-- Paiement / Thème / ½ : seulement à la création (1ʳᵉ entrée). En édition c'est par entrée. -->
        <template v-if="lineModalMode === 'add'">
          <div class="form-field">
            <label class="form-label">Mode de paiement</label>
            <ChipSelect v-model="lineForm.paymentMethod" :options="paymentOptions" />
          </div>
          <div class="form-row">
            <div class="form-field form-field--grow">
              <label class="form-label">Thème</label>
              <ThemeSelect v-model="lineForm.theme" :themes="themes" />
            </div>
            <div class="form-field">
              <label class="form-label">Partagé ½</label>
              <button
                type="button"
                class="toggle-half"
                :class="{ 'toggle-half--on': lineForm.isShared }"
                @click="lineForm.isShared = !lineForm.isShared"
              >
                {{ lineForm.isShared ? '½ Activé' : '½ Désactivé' }}
              </button>
            </div>
          </div>
        </template>
        <p v-else class="text-[12px] text-gray-400 dark:text-gray-500">
          Paiement, thème et ½ se règlent sur chaque entrée (déroule la ligne).
        </p>
      </div>

      <template #footer>
        <button
          v-if="lineModalMode === 'edit'"
          class="modal-btn modal-btn--danger"
          @click="deleteFromModal"
        >
          Supprimer
        </button>
        <button class="modal-btn modal-btn--secondary" @click="closeLineModal">Annuler</button>
        <button class="modal-btn modal-btn--primary" @click="saveLineModal">
          {{ lineModalMode === 'add' ? 'Ajouter' : 'Sauver' }}
        </button>
      </template>
    </AppModal>

    <!-- ─── Modal entrée (sous-ligne) ────────────────────────── -->
    <AppModal
      v-if="txModalOpen"
      :title="(txModalMode === 'add' ? 'Nouvelle entrée' : 'Modifier l\'entrée') + (txModalLine ? ' — ' + txModalLine.label : '')"
      @close="closeTxModal"
    >
      <div class="form-grid">
        <div class="form-row">
          <div class="form-field form-field--grow">
            <label class="form-label">Montant (€)</label>
            <input
              v-model.number="txForm.amount"
              type="number"
              step="0.01"
              class="form-input"
              placeholder="0.00"
              @keyup.enter="saveTxModal"
            />
          </div>
          <div class="form-field form-field--grow">
            <label class="form-label">Date</label>
            <input v-model="txForm.date" type="date" class="form-input" />
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">Détails (optionnel)</label>
          <input v-model="txForm.details" class="form-input" placeholder="Ex: écouteurs" />
        </div>
        <div class="form-field">
          <label class="form-label">Thème</label>
          <ThemeSelect v-model="txForm.theme" :themes="themes" />
        </div>
        <div class="form-field">
          <label class="form-label">Compte</label>
          <ChipSelect v-model="txForm.account" :options="accountOptions" allow-none />
        </div>
        <div class="form-row">
          <div class="form-field form-field--grow">
            <label class="form-label">Mode de paiement</label>
            <ChipSelect v-model="txForm.paymentMethod" :options="paymentOptions" />
          </div>
          <div class="form-field">
            <label class="form-label">Partagé ½</label>
            <button
              type="button"
              class="toggle-half"
              :class="{ 'toggle-half--on': txForm.isShared }"
              @click="txForm.isShared = !txForm.isShared"
            >
              {{ txForm.isShared ? '½ Activé' : '½ Désactivé' }}
            </button>
          </div>
        </div>
      </div>

      <template #footer>
        <button class="modal-btn modal-btn--secondary" @click="closeTxModal">Annuler</button>
        <button class="modal-btn modal-btn--primary" @click="saveTxModal">
          {{ txModalMode === 'add' ? 'Ajouter' : 'Sauver' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style>
/* ─── Form helper (flex override on label input) ───────── */
.expense-add-form__label {
  flex: 1;
  min-width: 120px;
}

/* ─── Income actual form ──────────────────────────────── */
.income-actual-form {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0 4px;
}
.income-actual-label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
  flex-shrink: 0;
}

/* ─── Lines table (complex grid, kept in CSS) ─────────── */
.lines-table {
  width: 100%;
}
.lines-head {
  display: grid;
  grid-template-columns: 1fr 90px 100px 90px 55px 36px;
  padding: 6px 16px;
  background: rgba(255, 255, 255, 0.42);
  font-size: 11px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid #f3f4f6;
}
.col-r {
  text-align: right;
}
.col-flags {
  text-align: center;
}

.line-wrap {
  border-bottom: 1px solid #f9fafb;
}
.line-wrap:last-child {
  border-bottom: none;
}

.line-row {
  display: grid;
  grid-template-columns: 1fr 90px 100px 90px 55px 36px;
  align-items: center;
  padding: 9px 16px;
  transition: background 0.1s;
}
/* Section sans aucun montant prévu : on masque les colonnes Prévu et Reste */
.lines-head.lines-row--no-planned,
.line-row.lines-row--no-planned {
  grid-template-columns: 1fr 100px 55px 36px;
}
.section-totals--no-planned {
  grid-template-columns: 1fr 90px 55px;
}
/* Bloc Revenus sans colonne Reste */
.lines-head--norest,
.line-row--norest {
  grid-template-columns: 1fr 90px 100px 55px 36px;
}
.section-totals--norest {
  grid-template-columns: 1fr 90px 90px 55px;
}

/* Avec colonne Date (dépenses) */
.lines-head.has-date,
.line-row.has-date {
  grid-template-columns: 1fr 85px 90px 100px 55px 36px;
}
.lines-head.has-date.lines-row--no-planned,
.line-row.has-date.lines-row--no-planned {
  grid-template-columns: 1fr 85px 100px 55px 36px;
}
.section-totals.has-date {
  grid-template-columns: 1fr 85px 90px 90px 55px;
}
.section-totals.has-date.section-totals--no-planned {
  grid-template-columns: 1fr 85px 90px 55px;
}
.col-date {
  font-size: 12px;
  color: #9ca3af;
  text-align: left;
}
.line-date {
  font-size: 12px;
  color: #6b7280;
}
.line-row:hover {
  background: rgba(255, 255, 255, 0.42);
}
.line-row--open {
  background: #f5f3ff;
}
.line-row--income .line-label {
  color: #16a34a;
}

.line-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 500;
  color: #374151;
}
.line-chevron {
  font-size: 9px;
  color: #9ca3af;
  min-width: 10px;
}
.theme-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 20px;
  font-weight: 500;
}

.line-planned,
.line-actual,
.line-remaining {
  font-size: 13px;
  text-align: right;
}
.line-planned {
  color: #6b7280;
}
.line-actual {
  font-weight: 600;
  color: #1a1a1a;
}
.line-remaining {
  font-weight: 500;
}

.text-income {
  color: #16a34a;
}
.text-expense {
  color: #374151;
}
.text-ok {
  color: #16a34a;
}
.text-over {
  color: #ef4444;
}

.section-empty {
  padding: 10px 16px;
  font-size: 12px;
  color: #d1d5db;
}
.section-totals {
  display: grid;
  grid-template-columns: 1fr 90px 90px 90px 55px;
  align-items: center;
  padding: 8px 16px;
  border-top: 2px solid #e8e8e5;
  background: rgba(255, 255, 255, 0.42);
}
.totals-label {
  font-size: 12px;
  font-weight: 700;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.totals-val {
  font-size: 13px;
  font-weight: 700;
  color: #1a1a1a;
}

.flag-on {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  background: #f5f3ff;
  color: #7c3aed;
  border-radius: 4px;
  padding: 1px 4px;
  margin-right: 2px;
}

/* ─── Panneau transactions ────────────────────────────── */
.tx-panel {
  background: rgba(255, 255, 255, 0.42);
  border-top: 1px solid #e8e8e5;
  padding: 10px 16px 12px;
}
.line-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 0 10px;
  border-bottom: 1px dashed #e5e7eb;
  margin-bottom: 10px;
  font-size: 12px;
}
.line-meta-item {
  color: #6b7280;
  display: flex;
  align-items: center;
  gap: 4px;
}
.line-meta-key {
  font-weight: 600;
  color: #374151;
}
.line-meta-check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #374151;
  cursor: pointer;
}
.btn-line-edit {
  margin-left: auto;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #d1d5db;
  background: white;
  color: #374151;
  cursor: pointer;
}
.btn-line-edit:hover {
  background: #f3f4f6;
}

.inline-actual-input {
  width: 72px;
  text-align: right;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
  background: transparent;
  padding: 2px 6px;
  transition: border-color 0.15s, background 0.15s;
}
.inline-actual-input:hover,
.inline-actual-input:focus {
  border-color: #d1d5db;
  background: white;
  outline: none;
}
.inline-actual-input::placeholder {
  color: #d1d5db;
  font-weight: 400;
}
.inline-actual-input::-webkit-outer-spin-button,
.inline-actual-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.inline-actual-input[type=number] {
  -moz-appearance: textfield;
}

.btn-icon-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  font-size: 12px;
  justify-self: center;
}
.btn-icon-action:hover {
  background: #f3f4f6;
  color: #374151;
}
.btn-icon-action.active {
  background: #f5f3ff;
  color: #8b5cf6;
}
.tx-list {
  margin-bottom: 10px;
}
.tx-row {
  display: grid;
  grid-template-columns: 55px 1fr 100px 90px 24px;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: #fff;
  border-radius: 6px;
  margin-bottom: 4px;
  font-size: 12.5px;
}
.tx-date {
  color: #9ca3af;
}
.tx-label {
  font-weight: 500;
  color: #374151;
}
.tx-account {
  color: #9ca3af;
  font-size: 11.5px;
}
.tx-amount {
  text-align: right;
  font-weight: 600;
  color: #374151;
}
.tx-income {
  color: #16a34a;
}
.tx-expense {
  color: #dc2626;
}
.tx-row--line {
  grid-template-columns: 70px 1fr 90px 22px 22px;
}
.btn-tx-edit {
  background: none;
  border: none;
  color: #d1d5db;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  line-height: 1;
}
.btn-tx-edit:hover {
  color: #7c3aed;
}
.tx-theme-wrap {
  flex: 0 0 150px;
  min-width: 120px;
}
/* Animation d'ouverture/fermeture du panneau d'entrées */
.expand-enter-active,
.expand-leave-active {
  transition: max-height 0.24s ease, opacity 0.24s ease, transform 0.24s ease;
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-4px);
}
.expand-enter-to,
.expand-leave-from {
  max-height: 2200px;
  opacity: 1;
  transform: translateY(0);
}

.entry-count {
  margin-left: 6px;
  font-size: 10.5px;
  font-weight: 600;
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.1);
  padding: 1px 7px;
  border-radius: 20px;
}
.dark .entry-count {
  color: #c4b5fd;
  background: rgba(139, 92, 246, 0.18);
}
.btn-add-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 7px 14px;
  border: 1.5px dashed #c4b5fd;
  border-radius: 9px;
  background: rgba(124, 58, 237, 0.06);
  color: #7c3aed;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.btn-add-entry:hover {
  background: rgba(124, 58, 237, 0.12);
  border-color: #7c3aed;
}
.dark .btn-add-entry {
  border-color: rgba(139, 92, 246, 0.5);
  background: rgba(139, 92, 246, 0.12);
  color: #c4b5fd;
}
.actual-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
  background: transparent;
  padding: 2px 6px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.actual-toggle:hover {
  border-color: #d1d5db;
  background: white;
}
.actual-toggle .line-chevron {
  font-size: 9px;
  color: #9ca3af;
}
.tx-empty {
  font-size: 12px;
  color: #d1d5db;
  margin-bottom: 10px;
}
.btn-tx-del {
  background: none;
  border: none;
  color: #d1d5db;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  line-height: 1;
}
.btn-tx-del:hover {
  color: #ef4444;
}

.tx-add-form {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.tx-input {
  padding: 6px 9px;
  border: 1px solid #e8e8e5;
  border-radius: 6px;
  font-size: 12.5px;
  outline: none;
  background: #fff;
  flex: 1;
  min-width: 100px;
}
.tx-input:focus {
  border-color: #7c3aed;
}
.tx-input--amount {
  max-width: 110px;
  flex: 0 0 110px;
}
.tx-input--date {
  max-width: 130px;
  flex: 0 0 130px;
}
.tx-select {
  padding: 6px 8px;
  border: 1px solid #e8e8e5;
  border-radius: 6px;
  font-size: 12.5px;
  outline: none;
  background: #fff;
  cursor: pointer;
  flex: 0 0 130px;
}
.btn-tx-add {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
}
.btn-tx-add:hover {
  background: #6d28d9;
}
.btn-tx-add--income {
  background: #16a34a;
}
.btn-tx-add--income:hover {
  background: #15803d;
}

/* ─── EDF ─────────────────────────────────────────────── */
.edf-block {
  padding: 14px 16px;
  border-bottom: 1px solid #f3f4f6;
}
.edf-block:last-child {
  border-bottom: none;
}
.edf-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 10px;
}
.edf-name {
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
}
.edf-cost-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}
.edf-cost {
  font-size: 13px;
  color: #6b7280;
}
.edf-detail {
  font-size: 11px;
  color: #9ca3af;
  text-align: right;
}
.edf-delta {
  font-size: 12px;
  text-align: right;
  font-weight: 500;
}
.edf-delta--ok {
  color: #16a34a;
}
.edf-delta--over {
  color: #dc2626;
}
.edf-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 10px;
}
.edf-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ─── Dark mode ───────────────────────────────────────── */
.dark .lines-head {
  background: rgba(31, 41, 55, 0.42);
  border-bottom-color: #374151;
  color: #6b7280;
}
.dark .line-wrap {
  border-bottom-color: #1f2937;
}
.dark .line-row:hover {
  background: rgba(255, 255, 255, 0.04);
}
.dark .line-row--open {
  background: rgba(124, 58, 237, 0.15);
}
.dark .line-row--income .line-label {
  color: #4ade80;
}
.dark .line-label {
  color: #d1d5db;
}
.dark .line-planned {
  color: #9ca3af;
}
.dark .line-actual {
  color: #f3f4f6;
}
.dark .section-totals {
  border-top-color: #374151;
  background: rgba(31, 41, 55, 0.42);
}
.dark .totals-label,
.dark .totals-val {
  color: #e5e7eb;
}
.dark .inline-actual-input {
  color: #f3f4f6;
}
.dark .inline-actual-input:hover,
.dark .inline-actual-input:focus {
  border-color: #4b5563;
  background: #374151;
}
.dark .actual-toggle {
  color: #f3f4f6;
}
.dark .actual-toggle:hover {
  border-color: #4b5563;
  background: #374151;
}
.dark .btn-icon-action {
  color: #6b7280;
}
.dark .btn-icon-action:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #d1d5db;
}
.dark .btn-icon-action.active {
  background: rgba(124, 58, 237, 0.2);
  color: #60a5fa;
}
.dark .tx-panel {
  background: rgba(31, 41, 55, 0.42);
  border-top-color: #374151;
}
.dark .line-meta {
  border-bottom-color: #374151;
}
.dark .line-meta-check {
  color: #d1d5db;
}
.dark .income-actual-label {
  color: #9ca3af;
}
.dark .tx-row {
  background: #111827;
}
.dark .tx-label {
  color: #d1d5db;
}
.dark .tx-amount {
  color: #d1d5db;
}
.dark .tx-input,
.dark .tx-select {
  background: #374151;
  border-color: #4b5563;
  color: #f3f4f6;
}
.dark .edf-block {
  border-bottom-color: #374151;
}
.dark .edf-name {
  color: #f9fafb;
}
.dark .edf-cost {
  color: #9ca3af;
}

/* ─── Formulaire dans le modal ─────────────────────────── */
.form-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-row {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-field--grow {
  flex: 1;
  min-width: 160px;
}
.form-label {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #9ca3af;
}
.form-input {
  padding: 8px 10px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  background: #fff;
  color: #1a1a1a;
}
.form-input:focus {
  border-color: #7c3aed;
}
.dark .form-input {
  background: #374151;
  border-color: #4b5563;
  color: #f3f4f6;
}
.toggle-half {
  padding: 7px 14px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #6b7280;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
}
.toggle-half--on {
  border-color: #7c3aed;
  background: #f5f3ff;
  color: #7c3aed;
  font-weight: 600;
}
.dark .toggle-half {
  background: #374151;
  border-color: #4b5563;
  color: #9ca3af;
}
.dark .toggle-half--on {
  background: rgba(124, 58, 237, 0.22);
  border-color: #8b5cf6;
  color: #c4b5fd;
}
.modal-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.modal-btn--primary {
  background: #7c3aed;
  color: #fff;
}
.modal-btn--primary:hover {
  background: #6d28d9;
}
.modal-btn--secondary {
  background: #f1f5f9;
  color: #475569;
}
.dark .modal-btn--secondary {
  background: #374151;
  color: #d1d5db;
}
.modal-btn--danger {
  background: none;
  color: #ef4444;
  margin-right: auto;
}
.modal-btn--danger:hover {
  text-decoration: underline;
}
</style>
