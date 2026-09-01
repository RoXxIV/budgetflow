<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  getMonths, getMonthPrefill, createMonth, setMonthClosed,
  getMonthLines, payLine, unpayLine,
  getMonthSnapshots, upsertMonthSnapshots,
  getMonthEntries, createEntry, updateEntry, deleteEntry,
  getMonthSummary, getMonthEnvelopeContributions,
  createMonthLine, updateMonthLine, deleteMonthLine, applyLineToTemplate,
} from '@/api/months.js'
import { getEnvelopes, addContribution, removeContribution } from '@/api/envelopes.js'
import { getMonthCalculators, saveMonthReadings, regularizeCalculator } from '@/api/calculators.js'
import AppModal from '@/components/AppModal.vue'
import { getAssets, addAssetMovement, removeAssetMovement, getMonthAssetMovements, dcaAsset, undcaAsset } from '@/api/assets.js'
import { getCategories } from '@/api/categories.js'
import { getThemes } from '@/api/themes.js'
import { getAccounts } from '@/api/accounts.js'
import { getSettings } from '@/api/settings.js'

// ─── Data ────────────────────────────────────────────────
const monthsList = ref([])
const current = ref(null)      // mois sélectionné
const lines = ref([])
const entriesAll = ref([])
const snapshots = ref([])
const categories = ref([])
const themes = ref([])
const accounts = ref([])
const settings = ref(null)

onMounted(async () => {
  const [mRes, cRes, tRes, aRes, sRes] = await Promise.all([
    getMonths(), getCategories(), getThemes(), getAccounts(), getSettings(),
  ])
  monthsList.value = mRes.data
  categories.value = cRes.data
  themes.value = tRes.data
  accounts.value = aRes.data
  settings.value = sRes.data
  // Mois courant du calendrier si présent, sinon le plus récent
  const nowPeriod = new Date().toISOString().substring(0, 7)
  const target = monthsList.value.find((m) => m.period === nowPeriod) || monthsList.value[0]
  if (target) await openMonth(target)
})

const summaryData = ref(null)
const showAccounts = ref(false)
const envelopes = ref([])          // enveloppes ouvertes
const monthContribs = ref([])      // contributions datées dans le mois

const calculators = ref([])        // état des calculateurs sur ce mois (relevés, estimé, écart)
const assets = ref([])             // actifs ouverts
const monthAssetMovements = ref([]) // versements / retraits datés dans le mois

async function loadMonthData(monthId) {
  const [lRes, eRes, sumRes, envRes, mcRes, calcRes, aRes, amRes] = await Promise.all([
    getMonthLines(monthId), getMonthEntries(monthId), getMonthSummary(monthId),
    getEnvelopes(), getMonthEnvelopeContributions(monthId), getMonthCalculators(monthId),
    getAssets(), getMonthAssetMovements(monthId),
  ])
  lines.value = lRes.data
  entriesAll.value = eRes.data
  summaryData.value = sumRes.data
  envelopes.value = envRes.data.filter((e) => !e.isClosed)
  monthContribs.value = mcRes.data
  calculators.value = calcRes.data
  assets.value = aRes.data.filter((a) => !a.isClosed)
  monthAssetMovements.value = amRes.data
}

async function openMonth(month) {
  current.value = month
  const [sRes] = await Promise.all([getMonthSnapshots(month.id), loadMonthData(month.id)])
  snapshots.value = sRes.data
}

async function reload() {
  await loadMonthData(current.value.id)
}

// ─── Investissements : ☐ versé (DCA), mouvements du mois ─
const openAssetId = ref(null)
const assetMovementForm = ref({})
const movementsForAsset = (asset) => monthAssetMovements.value.filter((m) => m.assetId === asset.id)
const dcaDone = (asset) => movementsForAsset(asset).some((m) => m.source === 'dca')
const monthInvestedTotal = computed(() => monthAssetMovements.value.filter((m) => m.kind === 'versement').reduce((s, m) => s + m.amount, 0))

async function toggleDca(asset) {
  try {
    if (dcaDone(asset)) await undcaAsset(current.value.id, asset.id)
    else await dcaAsset(current.value.id, asset.id)
    await reload()
  } catch (e) { apiError(e) }
}

function toggleAsset(asset) {
  if (openAssetId.value === asset.id) { openAssetId.value = null; return }
  openAssetId.value = asset.id
  const today = new Date().toISOString().substring(0, 10)
  assetMovementForm.value = {
    kind: 'versement',
    amount: '',
    date: today.startsWith(current.value.period) ? today : `${current.value.period}-01`,
    counterpartAccountId: accounts.value.find((a) => a.isMain)?.id || '',
  }
}

async function submitAssetMovement(asset) {
  const f = assetMovementForm.value
  if (!f.amount) return
  try {
    await addAssetMovement(asset.id, { kind: f.kind, amount: parseFloat(f.amount), date: f.date, counterpartAccountId: f.counterpartAccountId || null })
    assetMovementForm.value = { ...f, amount: '' }
    await reload()
  } catch (e) { apiError(e) }
}

async function deleteAssetMovement(m) {
  try { await removeAssetMovement(m.assetId, m.id); await reload() } catch (e) { apiError(e) }
}

// ─── Calculateurs : saisie des relevés, régularisation ───
async function saveReadings(calc) {
  try {
    const readings = calc.readings.map((r) => ({ defId: r.defId, previous: r.previous, current: r.current }))
    const { data } = await saveMonthReadings(current.value.id, calc.id, readings)
    Object.assign(calc, data)
  } catch (e) { apiError(e) }
}

async function regularize(calc) {
  const verb = calc.line?.regularisation ? 'Mettre à jour' : 'Créer'
  if (!confirm(`${verb} la régularisation de ${fmt(calc.gap)} sur « ${calc.line.label} » ?`)) return
  try {
    await regularizeCalculator(current.value.id, calc.id)
    await reload()
  } catch (e) { apiError(e) }
}

const fmtNum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 }))

// ─── Cagnottes (partage) : les ½ n'existent que s'il y a au moins une cagnotte dans le mois ─
const pots = computed(() => lines.value.filter((l) => l.isPot))
const sharingOn = computed(() => pots.value.length > 0)
const potById = (id) => pots.value.find((p) => p.id === id) || null

function potStatus(line) {
  const p = line.pot
  if (!p) return ''
  if (p.toSend > 0) return `à envoyer à ${p.partnerName}`
  if (p.toSend < 0) return `${p.partnerName} vous doit`
  return 'équilibré'
}

// ─── Enveloppes (contribution rapide depuis le mois) ─────
const openEnvelopeId = ref(null)
const contribForm = ref({})
const contribsForEnvelope = (env) => monthContribs.value.filter((c) => c.envelopeId === env.id)
const monthContribTotal = computed(() => monthContribs.value.filter((c) => c.kind === 'normale').reduce((s, c) => s + c.amount, 0))
const envelopePct = (env) => (env.effectiveTarget ? Math.min(100, Math.round((env.total / env.effectiveTarget) * 100)) : null)

function toggleEnvelope(env) {
  if (openEnvelopeId.value === env.id) { openEnvelopeId.value = null; return }
  openEnvelopeId.value = env.id
  contribForm.value = {
    amount: env.monthlySuggestion || '',
    date: current.value.period === new Date().toISOString().substring(0, 7)
      ? new Date().toISOString().substring(0, 10)
      : `${current.value.period}-01`,
    fromAccountId: accounts.value.find((a) => a.isMain)?.id || '',
    notes: '',
  }
}

async function submitContribution(env) {
  const f = contribForm.value
  if (!f.amount) return
  try {
    await addContribution(env.id, {
      amount: parseFloat(f.amount),
      date: f.date,
      fromAccountId: f.fromAccountId || null,
      notes: f.notes || null,
    })
    contribForm.value = { ...f, amount: '', notes: '' }
    await reload()
  } catch (e) { apiError(e) }
}

async function deleteContribution(c) {
  try { await removeContribution(c.envelopeId, c.id); await reload() } catch (e) { apiError(e) }
}

function apiError(e) {
  alert(e.response?.data?.message || e.message)
}

// ─── Helpers ─────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const themeById = (id) => themes.value.find((t) => t.id === id) || null
const accountById = (id) => accounts.value.find((a) => a.id === id) || null
const entriesForLine = (line) => entriesAll.value.filter((e) => e.lineId === line.id)
const lineCategoryType = (line) => categories.value.find((c) => c.id === line.categoryId)?.type || 'depense'
// La ligne est un mouvement entre comptes (transfert, épargne, ou Vers configuré dans le template)
const lineHasDestination = (line) => ['epargne', 'transfert'].includes(lineCategoryType(line)) || !!line.toAccountId
const isPaid = (line) => entriesForLine(line).length > 0
const hasPayEntry = (line) => entriesForLine(line).some((e) => e.source === 'paye')

// ─── Groupes par catégorie ───────────────────────────────
const NO_CATEGORY = { id: null, name: 'Sans catégorie', type: 'depense', color: '#9ca3af' }

const groups = computed(() => {
  const result = categories.value.map((c) => ({
    category: c,
    lines: lines.value.filter((l) => l.categoryId === c.id),
  }))
  const orphans = lines.value.filter((l) => !l.categoryId || !categories.value.some((c) => c.id === l.categoryId))
  if (orphans.length) result.push({ category: NO_CATEGORY, lines: orphans })
  return result
    .map((g) => ({
      ...g,
      planned: g.lines.reduce((s, l) => s + (l.plannedAmount || 0), 0),
      actual: g.lines.reduce((s, l) => s + (l.actualAmount || 0), 0),
    }))
})
const groupsLeft = computed(() => groups.value.filter((_, i) => i % 2 === 0))
const groupsRight = computed(() => groups.value.filter((_, i) => i % 2 === 1))

// ─── Création de mois ────────────────────────────────────
const createFormOpen = ref(false)
const newMonth = ref({ period: '', snapshots: {} })
const suggested = ref({})          // solde live de fin du mois précédent, par compte (suggestion)
const previousPeriod = ref(null)
const newEnvelopes = ref([])       // [{ id, name, accountId, accountName, total (cumul), value (saisie) }]
const envelopeDelta = (e) => {
  if (e.value === '' || e.value == null) return null
  const d = Math.round((parseFloat(e.value) - e.total) * 100) / 100
  return d === 0 ? null : d
}
// « = compte » : recopie le solde saisi pour le compte hôte (enveloppe seule sur son compte)
const envelopesOnAccount = (accountId) => newEnvelopes.value.filter((e) => e.accountId === accountId).length
function copyAccountBalance(e) {
  const v = newMonth.value.snapshots[e.accountId]
  if (v !== '' && v != null) e.value = v
}
const suggestionDelta = (accountId) => {
  const s = suggested.value[accountId]
  const v = newMonth.value.snapshots[accountId]
  if (s == null || v === '' || v == null) return null
  const d = Math.round((parseFloat(v) - s) * 100) / 100
  return d === 0 ? null : d
}

const newMonthTaken = computed(() => monthsList.value.some((m) => m.period === newMonth.value.period))
const newMonthName = computed(() => {
  if (!newMonth.value.period) return ''
  const [y, m] = newMonth.value.period.split('-').map(Number)
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return label.charAt(0).toUpperCase() + label.slice(1)
})

async function openCreateForm() {
  const { data } = await getMonthPrefill()
  const map = {}
  const sug = {}
  accounts.value.forEach((a) => {
    const s = data.snapshots.find((x) => x.accountId === a.id)
    map[a.id] = s?.balance ?? ''
    if (s) sug[a.id] = s.balance
  })
  newMonth.value = { period: data.period, snapshots: map }
  suggested.value = sug
  previousPeriod.value = data.previousPeriod
  newEnvelopes.value = (data.envelopes || []).map((e) => ({ ...e, value: e.total }))
  createFormOpen.value = true
}

async function submitCreate() {
  if (!newMonth.value.period || newMonthTaken.value) return
  const snapshotList = Object.entries(newMonth.value.snapshots)
    .filter(([, v]) => v !== '' && v !== null)
    .map(([accountId, balance]) => ({ accountId: Number(accountId), balance: parseFloat(balance) }))
  const envelopeList = newEnvelopes.value
    .filter((e) => envelopeDelta(e) !== null)
    .map((e) => ({ envelopeId: e.id, total: parseFloat(e.value) }))
  try {
    const { data: created } = await createMonth({ period: newMonth.value.period, snapshots: snapshotList, envelopes: envelopeList })
    createFormOpen.value = false
    monthsList.value = (await getMonths()).data
    await openMonth(monthsList.value.find((m) => m.id === created.id))
  } catch (e) { apiError(e) }
}

// ─── Clôture ─────────────────────────────────────────────
async function toggleClosed() {
  const action = current.value.isClosed ? 'Rouvrir' : 'Clôturer'
  if (!confirm(`${action} ${current.value.name} ?${current.value.isClosed ? '' : ' Les saisies seront verrouillées.'}`)) return
  try {
    const { data } = await setMonthClosed(current.value.id, !current.value.isClosed)
    current.value = data
    monthsList.value = (await getMonths()).data
  } catch (e) { apiError(e) }
}

// ─── ☐ payé ──────────────────────────────────────────────
async function togglePaid(line) {
  try {
    if (!isPaid(line)) await payLine(current.value.id, line.id)
    else if (hasPayEntry(line) && entriesForLine(line).length === 1) await unpayLine(current.value.id, line.id)
    else { openEntriesLineId.value = line.id; return } // entrées manuelles → gérer dans le déroulé
    await reload()
  } catch (e) { apiError(e) }
}

// ─── Entrées (déroulé par ligne) ─────────────────────────
const openEntriesLineId = ref(null)
const entryForm = ref({})

function defaultEntryDate(line) {
  if (line.recurringDay && current.value) {
    return `${current.value.period}-${String(line.recurringDay).padStart(2, '0')}`
  }
  return new Date().toISOString().substring(0, 10)
}

function toggleEntries(line) {
  if (openEntriesLineId.value === line.id) { openEntriesLineId.value = null; return }
  openEntriesLineId.value = line.id
  entryForm.value = {
    amount: '',
    date: defaultEntryDate(line),
    label: '',
    themeId: line.themeId || '',
    // Mouvement entre comptes : Depuis + Vers pré-remplis depuis la ligne (template)
    accountId: lineHasDestination(line)
      ? (line.fromAccountId || accounts.value.find((a) => a.isMain)?.id || '')
      : (line.fromAccountId || line.toAccountId || accounts.value.find((a) => a.isMain)?.id || ''),
    toAccountId: lineHasDestination(line) ? (line.toAccountId || '') : '',
    isShared: line.isShared,
    potLineId: line.potLineId || pots.value[0]?.id || '',
    envelopeId: '',          // « depuis l'enveloppe » : dépense liée, l'enveloppe baisse d'autant
    envelopeInTarget: true,  // fait partie du projet → la cible affichée est corrigée
  }
}

// Cible corrigée d'une enveloppe : « 2 700 / 3 500 (4 500 − 1 000 dépensés) »
const envelopeTargetLabel = (env) => env.spentInTarget
  ? `${fmt(env.effectiveTarget)} (${fmt(env.targetAmount)} − ${fmt(env.spentInTarget)} dépensés)`
  : fmt(env.targetAmount)
const envelopeById = (id) => envelopes.value.find((e) => e.id === id) || null

async function submitEntry(line) {
  const f = entryForm.value
  if (!f.amount) return
  try {
    await createEntry(current.value.id, {
      lineId: line.id,
      amount: parseFloat(f.amount),
      date: f.date,
      label: f.label || null,
      themeId: f.themeId || null,
      accountId: f.accountId || null,
      toAccountId: f.toAccountId || null,
      isShared: f.isShared,
      potLineId: f.isShared ? (f.potLineId || null) : null,
      envelopeId: f.envelopeId || null,
      envelopeInTarget: f.envelopeInTarget !== false,
    })
    entryForm.value = { ...f, amount: '', label: '', envelopeId: '' }
    await reload()
  } catch (e) { apiError(e) }
}

async function removeEntry(entry) {
  try { await deleteEntry(current.value.id, entry.id); await reload() } catch (e) { apiError(e) }
}

// ─── Modification d'une entrée (montant, date, détail, comptes, thème, ½) ─
const editingEntryId = ref(null)
const entryEdit = ref({})

function openEditEntry(e) {
  editingEntryId.value = e.id
  entryEdit.value = {
    amount: e.amount,
    date: e.date,
    label: e.label || '',
    accountId: e.accountId || '',
    toAccountId: e.toAccountId || '',
    themeId: e.themeId || '',
    isShared: e.isShared,
    potLineId: e.potLineId || pots.value[0]?.id || '',
    envelopeId: e.envelopeId || '',
    envelopeInTarget: e.envelopeInTarget !== false,
  }
}

async function saveEntryEdit(e) {
  const f = entryEdit.value
  const amount = parseFloat(f.amount)
  if (isNaN(amount) || !amount) return
  try {
    await updateEntry(current.value.id, e.id, {
      amount,
      date: f.date,
      label: f.label || null,
      accountId: f.accountId || null,
      toAccountId: f.toAccountId || null,
      themeId: f.themeId || null,
      isShared: f.isShared,
      potLineId: f.isShared ? (f.potLineId || null) : null,
      envelopeId: f.envelopeId || null,
      envelopeInTarget: f.envelopeInTarget !== false,
    })
    editingEntryId.value = null
    await reload()
  } catch (err) { apiError(err) }
}

// ─── Lignes du mois (ajout / édition / suppression) ──────
const lineFormId = ref(null) // id de ligne, ou 'new-<categoryId>'
const lineForm = ref({})

const lineFormCategoryType = computed(() => {
  const c = categories.value.find((x) => x.id === lineForm.value.categoryId)
  return c?.type || 'depense'
})

function openAddLine(category) {
  lineFormId.value = `new-${category.id}`
  lineForm.value = {
    label: '',
    plannedAmount: '',   // prévu seul → ligne à cocher plus tard
    actualAmount: '',    // montant rempli → entrée créée tout de suite (le réel remplace le prévu)
    entryDate: new Date().toISOString().substring(0, 10),
    categoryId: category.id,
    themeId: '',
    fromAccountId: category.type === 'revenu' ? '' : (accounts.value.find((a) => a.isMain)?.id || ''),
    toAccountId: '',
    isShared: false,
    recurringDay: '',
    potLineId: pots.value[0]?.id || '',
    isPot: false,
    potPartnerName: '',
    potPartnerPaid: '',
    potMyShare: 50,
  }
}

function openEditLine(line) {
  lineFormId.value = line.id
  lineForm.value = {
    label: line.label,
    plannedAmount: line.isPot ? '' : (line.plannedAmount ?? ''),
    categoryId: line.categoryId,
    themeId: line.themeId || '',
    fromAccountId: line.fromAccountId || '',
    toAccountId: line.toAccountId || '',
    isShared: line.isShared,
    recurringDay: line.recurringDay || '',
    potLineId: line.potLineId || pots.value[0]?.id || '',
    isPot: line.isPot,
    potPartnerName: line.potPartnerName || '',
    potPartnerPaid: line.potPartnerPaid ?? '',
    potMyShare: line.potMyShare ?? 50,
  }
}

function closeLineForm() {
  lineFormId.value = null
}

function lineFormData() {
  const f = lineForm.value
  return {
    label: f.label,
    plannedAmount: f.plannedAmount === '' ? 0 : parseFloat(f.plannedAmount),
    categoryId: f.categoryId || null,
    themeId: f.themeId || null,
    fromAccountId: f.fromAccountId || null,
    toAccountId: f.toAccountId || null,
    isShared: f.isShared,
    recurringDay: f.recurringDay === '' ? null : Number(f.recurringDay),
    potLineId: f.isShared ? (f.potLineId || null) : null,
    isPot: !!f.isPot,
    potPartnerName: f.isPot ? (f.potPartnerName || null) : null,
    potPartnerPaid: f.isPot && f.potPartnerPaid !== '' ? parseFloat(f.potPartnerPaid) : 0,
    potMyShare: f.isPot ? (Number(f.potMyShare) || 50) : 50,
  }
}

async function submitLineForm() {
  if (!lineForm.value.label.trim()) return
  const f = lineForm.value
  try {
    if (typeof lineFormId.value === 'string') {
      const { data: line } = await createMonthLine(current.value.id, lineFormData())
      // Montant rempli : l'entrée est créée tout de suite (une seule saisie)
      const amount = parseFloat(f.actualAmount)
      if (amount > 0) {
        await createEntry(current.value.id, {
          lineId: line.id,
          amount,
          date: f.entryDate,
          themeId: f.themeId || null,
          // Revenu : le compte de l'entrée est celui qui est crédité (« Vers »)
          accountId: (lineFormCategoryType.value === 'revenu' ? f.toAccountId : f.fromAccountId) || null,
          toAccountId: lineHasDestination(line) ? (f.toAccountId || null) : null,
          isShared: f.isShared,
        })
      }
    } else {
      await updateMonthLine(current.value.id, lineFormId.value, lineFormData())
    }
    closeLineForm()
    await reload()
  } catch (e) { apiError(e) }
}

async function removeLineConfirm(line) {
  const n = entriesForLine(line).length
  const msg = n
    ? `Supprimer « ${line.label} » et ses ${n} entrée(s) ?`
    : `Supprimer la ligne « ${line.label} » de ce mois ?`
  if (!confirm(msg)) return
  try {
    await deleteMonthLine(current.value.id, line.id, n > 0)
    closeLineForm()
    await reload()
  } catch (e) { apiError(e) }
}

async function pushToTemplate(line) {
  if (!confirm(`Reporter « ${line.label} » dans le template ? Les prochains mois utiliseront ces valeurs.`)) return
  try {
    await applyLineToTemplate(current.value.id, line.id)
    closeLineForm()
  } catch (e) { apiError(e) }
}

// ─── Affichage réel / prévu ──────────────────────────────
// Le réel remplace le prévu dès qu'il existe ; la case ☐ n'apparaît que sur une ligne
// avec un prévu et aucune entrée (ou la seule entrée « payé », pour pouvoir décocher).
function overBudget(line) {
  return line.plannedAmount > 0 && line.actualAmount > line.plannedAmount
}
function showCheckbox(line) {
  const entries = entriesForLine(line)
  if (line.isPot) {
    // Cagnotte : à cocher dès qu'il y a quelque chose à régler (dans un sens ou l'autre)
    return entries.length === 0 ? line.pot?.toSend !== 0 : (entries.length === 1 && entries[0].source === 'paye')
  }
  if (!(line.plannedAmount > 0)) return false
  return entries.length === 0 || (entries.length === 1 && entries[0].source === 'paye')
}

// ─── Snapshots (édition) ─────────────────────────────────
const snapshotsOpen = ref(false)
const snapshotEdits = ref({})

function openSnapshots() {
  const map = {}
  accounts.value.forEach((a) => {
    map[a.id] = snapshots.value.find((s) => s.accountId === a.id)?.balance ?? ''
  })
  snapshotEdits.value = map
  snapshotsOpen.value = !snapshotsOpen.value
}

async function saveSnapshots() {
  const list = Object.entries(snapshotEdits.value)
    .filter(([, v]) => v !== '' && v !== null)
    .map(([accountId, balance]) => ({ accountId: Number(accountId), balance: parseFloat(balance) }))
  try {
    snapshots.value = (await upsertMonthSnapshots(current.value.id, list)).data
    summaryData.value = (await getMonthSummary(current.value.id)).data
    snapshotsOpen.value = false
  } catch (e) { apiError(e) }
}

const amountClass = (n) => (n === null ? 'text-gray-300' : n >= 0 ? 'text-emerald-600' : 'text-red-500')
const fmtOrDash = (n) => (n === null || n === undefined ? '—' : fmt(n))
const mainEnvelopesTotal = computed(() => {
  const main = summaryData.value?.accounts.find((a) => a.isMain)
  return main?.envelopesTotal || 0
})
</script>

<template>
  <div>
    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="flex items-start justify-between mb-5">
      <div>
        <h1 class="text-[22px] font-semibold">Mois</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Suivi budgétaire mensuel</p>
      </div>
      <div class="flex gap-2 items-center">
        <select
          v-if="monthsList.length"
          class="input min-w-36"
          :value="current?.id"
          @change="openMonth(monthsList.find((m) => m.id === Number($event.target.value)))"
        >
          <option v-for="m in monthsList" :key="m.id" :value="m.id">{{ m.name }}{{ m.isClosed ? ' 🔒' : '' }}</option>
        </select>
        <button class="btn-primary" @click="openCreateForm">+ Nouveau mois</button>
      </div>
    </div>

    <!-- ─── Formulaire création ──────────────────────── -->
    <AppModal :open="createFormOpen" title="Nouveau mois" @close="createFormOpen = false">
      <div class="flex items-center gap-3 mb-3">
        <input v-model="newMonth.period" type="month" class="input" />
        <span v-if="newMonthName && !newMonthTaken" class="text-[13px] font-medium text-violet-600">→ {{ newMonthName }}</span>
        <span v-if="newMonthTaken" class="text-[12.5px] font-medium text-red-500">Un mois existe déjà pour {{ newMonthName }}</span>
      </div>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Solde de début de mois (recalage par compte)</p>
      <p v-if="previousPeriod" class="text-[11.5px] text-gray-400 mb-2">
        Pré-rempli avec le solde de fin de {{ previousPeriod }} calculé par l'app — corrigez avec le vrai solde de la banque, l'écart s'affiche à titre d'info.
      </p>
      <div class="flex flex-col gap-1.5 mb-4">
        <div v-for="a in accounts" :key="a.id" class="flex items-center gap-2.5">
          <span class="text-[13px] text-gray-600 w-36 shrink-0">{{ a.name }}</span>
          <input v-model="newMonth.snapshots[a.id]" type="number" step="0.01" class="input w-28" placeholder="—" @keyup.enter="submitCreate" />
          <span v-if="suggestionDelta(a.id) !== null" class="text-[11px]" :class="suggestionDelta(a.id) > 0 ? 'text-emerald-600' : 'text-amber-600'" :title="'Suggéré : ' + fmt(suggested[a.id])">
            {{ suggestionDelta(a.id) > 0 ? '+' : '' }}{{ fmt(suggestionDelta(a.id)) }} non expliqué
          </span>
        </div>
      </div>

      <!-- Recalage des enveloppes -->
      <template v-if="newEnvelopes.length">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Enveloppes (montant réel)</p>
        <p class="text-[11.5px] text-gray-400 mb-2">
          Pré-rempli avec le cumul des contributions. Si l'argent réellement mis de côté diffère, corrigez : l'écart devient une contribution d'ajustement datée du mois.
        </p>
        <div class="flex flex-col gap-1.5 mb-4">
          <div v-for="e in newEnvelopes" :key="e.id" class="flex items-center gap-2.5">
            <span class="text-[13px] text-gray-600 w-36 shrink-0 truncate" :title="e.accountName ? 'sur ' + e.accountName : 'virtuelle'">{{ e.name }}</span>
            <input v-model="e.value" type="number" step="0.01" class="input w-28" @keyup.enter="submitCreate" />
            <button
              v-if="e.accountId && newMonth.snapshots[e.accountId] !== '' && envelopesOnAccount(e.accountId) === 1"
              class="link text-[11px]"
              :title="'Recopier le solde saisi pour ' + e.accountName"
              @click="copyAccountBalance(e)"
            >= {{ e.accountName }}</button>
            <span v-if="envelopeDelta(e) !== null" class="text-[11px]" :class="envelopeDelta(e) > 0 ? 'text-emerald-600' : 'text-amber-600'">
              {{ envelopeDelta(e) > 0 ? '+' : '' }}{{ fmt(envelopeDelta(e)) }} d'ajustement
            </span>
          </div>
        </div>
      </template>
      <template #footer>
        <button class="btn-primary" :disabled="!newMonth.period || newMonthTaken" @click="submitCreate">Créer depuis le template</button>
        <button class="btn-secondary" @click="createFormOpen = false">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Aucun mois ───────────────────────────────── -->
    <div v-if="!current && !monthsList.length && !createFormOpen" class="text-center py-16 text-gray-400">
      <p class="mb-4">Aucun mois pour l'instant.</p>
      <button class="btn-primary" @click="openCreateForm">Créer le premier mois</button>
    </div>

    <!-- ─── Contenu du mois ──────────────────────────── -->
    <div v-if="current">
      <div class="flex items-center gap-2.5 mb-4">
        <h2 class="text-[17px] font-bold">{{ current.name }}</h2>
        <span class="badge" :class="current.isClosed ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-700'">
          {{ current.isClosed ? 'Clôturé' : 'Ouvert' }}
        </span>
        <button class="link text-xs" @click="toggleClosed">{{ current.isClosed ? 'Rouvrir' : 'Clôturer' }}</button>
        <button class="link text-xs ml-auto" @click="openSnapshots">Soldes de début de mois</button>
      </div>

      <!-- ─── Bilan ────────────────────────────────── -->
      <div v-if="summaryData" class="card px-5 py-4 mb-4">
        <div class="grid grid-cols-3 gap-6">
          <div class="flex flex-col gap-0.5">
            <span class="text-[20px] font-bold tracking-tight" :class="amountClass(summaryData.tiles.disponible)">
              {{ fmtOrDash(summaryData.tiles.disponible) }}
            </span>
            <span class="text-[11.5px] text-gray-400 font-medium">
              Solde actuel{{ summaryData.mainAccount ? ' — ' + summaryData.mainAccount.name : '' }}
            </span>
            <span v-if="!summaryData.mainAccount" class="text-[11px] text-amber-500">Définir un compte principal (Comptes)</span>
            <span v-else-if="summaryData.tiles.disponible === null" class="text-[11px] text-amber-500">Saisir le solde de début de mois</span>
            <span v-else-if="mainEnvelopesTotal" class="text-[11px] text-gray-400">enveloppes déduites ({{ fmt(mainEnvelopesTotal) }})</span>
          </div>
          <div
            class="flex flex-col gap-0.5"
            :title="`+ ${fmt(summaryData.tiles.detail.revenusRestants)} revenus prévus non encaissés · − ${fmt(summaryData.tiles.detail.prevusRestants)} sorties prévues non réalisées`"
          >
            <span class="text-[20px] font-bold tracking-tight" :class="amountClass(summaryData.tiles.projete)">
              {{ fmtOrDash(summaryData.tiles.projete) }}
            </span>
            <span class="text-[11.5px] text-gray-400 font-medium">Projeté fin de mois</span>
            <span class="text-[11px] text-gray-400">si tout le prévu se réalise</span>
          </div>
          <div class="flex flex-col gap-0.5">
            <span class="text-[20px] font-bold tracking-tight text-violet-600">{{ fmt(summaryData.tiles.misDeCote) }}</span>
            <span class="text-[11.5px] text-gray-400 font-medium">Mis de côté ce mois</span>
            <span v-if="summaryData.tiles.savingRate" class="text-[11px] text-gray-400">
              objectif {{ fmt(summaryData.tiles.objectifEpargne) }} ({{ summaryData.tiles.savingRate }} % du revenu)
            </span>
          </div>
        </div>

        <button class="link text-xs mt-3" @click="showAccounts = !showAccounts">
          {{ showAccounts ? '▲' : '▼' }} Soldes des comptes
        </button>
        <div v-if="showAccounts" class="grid grid-cols-4 gap-2 mt-2">
          <div v-for="a in summaryData.accounts" :key="a.accountId" class="bg-stone-50 rounded-lg px-3 py-2">
            <p class="text-[11.5px] font-semibold truncate">{{ a.name }}<span v-if="a.isMain" class="text-violet-500"> ★</span></p>
            <p class="text-[12.5px]">
              <span class="text-gray-400">{{ fmtOrDash(a.start) }}</span>
              <span class="text-gray-300"> → </span>
              <span class="font-semibold" :class="amountClass(a.current)">{{ fmtOrDash(a.current) }}</span>
            </p>
            <p v-if="a.envelopesTotal" class="text-[10.5px] text-gray-400">
              enveloppes {{ fmt(a.envelopesTotal) }} · hors enveloppes {{ fmtOrDash(a.unallocated) }}
            </p>
          </div>
        </div>
      </div>

      <!-- ─── Enveloppes ───────────────────────────── -->
      <div v-if="envelopes.length" class="card p-0 overflow-hidden mb-4">
        <div class="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
          <span class="font-semibold text-[13.5px]">Enveloppes</span>
          <span class="badge bg-violet-50 text-violet-700">épargne</span>
          <span class="ml-auto text-[12.5px] text-gray-400">ce mois : <span class="font-semibold text-violet-600">{{ fmt(monthContribTotal) }}</span></span>
        </div>

        <div v-for="env in envelopes" :key="env.id">
          <div class="line-row" @click="toggleEnvelope(env)">
            <span class="text-[13px] font-medium truncate">{{ env.name }}</span>
            <span v-if="env.accountName" class="badge bg-stone-100 text-gray-500">{{ env.accountName }}</span>
            <span v-if="contribsForEnvelope(env).length" class="badge bg-violet-50 text-violet-700">
              +{{ fmt(contribsForEnvelope(env).reduce((s, c) => s + c.amount, 0)) }} ce mois
            </span>
            <span v-else-if="env.monthlySuggestion" class="text-[11px] text-gray-400" title="Mensualité suggérée pour atteindre la cible à l'échéance">
              ≈ {{ fmt(env.monthlySuggestion) }} / mois
            </span>
            <span class="ml-auto shrink-0 text-right">
              <span class="text-[13px] font-semibold">{{ fmt(env.total) }}</span>
              <span v-if="env.targetAmount" class="text-[11px] text-gray-400" :title="env.spentInTarget ? fmt(env.targetAmount) + ' − ' + fmt(env.spentInTarget) + ' déjà dépensés pour le projet' : ''"> / {{ fmt(env.effectiveTarget) }}</span>
              <span v-if="env.targetAmount" class="block text-[10.5px]" :class="env.total >= env.effectiveTarget ? 'text-emerald-600' : 'text-gray-400'">
                {{ env.total >= env.effectiveTarget ? 'cible atteinte' : 'reste ' + fmt(env.effectiveTarget - env.total) }}{{ env.spentInTarget ? ' · ' + fmt(env.spentInTarget) + ' dépensés' : '' }}
              </span>
            </span>
          </div>
          <div v-if="env.targetAmount" class="px-4 pb-1.5 -mt-1">
            <div class="progress"><div class="progress-bar bg-violet-500" :style="{ width: envelopePct(env) + '%' }" /></div>
          </div>

          <!-- Contributions du mois + ajout -->
          <div v-if="openEnvelopeId === env.id" class="edit-panel">
            <div v-for="c in contribsForEnvelope(env)" :key="c.id" class="flex items-center gap-2 text-[12.5px] py-1">
              <span class="text-gray-400 w-20 shrink-0">{{ c.date }}</span>
              <span class="font-medium w-20 shrink-0" :class="c.amount >= 0 ? 'text-emerald-600' : 'text-red-500'">{{ fmt(c.amount) }}</span>
              <span v-if="c.kind !== 'normale'" class="badge bg-stone-100 text-gray-500">{{ c.kind }}</span>
              <span class="text-gray-400 truncate">{{ c.notes }}</span>
              <span v-if="c.fromAccountName" class="text-gray-300 text-[11px] ml-auto shrink-0">
                {{ c.fromAccountName }}<template v-if="env.accountName && env.accountName !== c.fromAccountName"> → {{ env.accountName }}</template>
              </span>
              <button v-if="!current.isClosed" class="icon-btn text-red-300 hover:text-red-500 shrink-0" :class="{ 'ml-auto': !c.fromAccountName }" @click="deleteContribution(c)">×</button>
            </div>
            <p v-if="!contribsForEnvelope(env).length" class="text-xs text-gray-400 py-1">Aucune contribution ce mois.</p>

            <div v-if="!current.isClosed" class="flex flex-wrap gap-2 mt-2 items-center">
              <input v-model="contribForm.amount" type="number" step="0.01" class="input w-24" :placeholder="env.monthlySuggestion ? String(env.monthlySuggestion) : 'Montant'" @keyup.enter="submitContribution(env)" />
              <input v-model="contribForm.date" type="date" class="input w-34" />
              <select v-model="contribForm.fromAccountId" class="input w-28" title="Compte source">
                <option value="">— depuis</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
              <span v-if="env.accountName" class="text-gray-300 text-[12px]">→ {{ env.accountName }}</span>
              <input v-model="contribForm.notes" type="text" class="input w-36" placeholder="Note (optionnelle)" @keyup.enter="submitContribution(env)" />
              <button class="btn-secondary" @click="submitContribution(env)">Ajouter</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── Investissements ──────────────────────── -->
      <div v-if="assets.length" class="card p-0 overflow-hidden mb-4">
        <div class="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
          <span class="font-semibold text-[13.5px]">Investissements</span>
          <span class="badge bg-teal-50 text-teal-700">versements</span>
          <span class="ml-auto text-[12.5px] text-gray-400">ce mois : <span class="font-semibold text-teal-600">{{ fmt(monthInvestedTotal) }}</span></span>
        </div>
        <div v-for="asset in assets" :key="asset.id">
          <div class="line-row" @click="toggleAsset(asset)">
            <!-- ☐ versé : le DCA prévu, une fois par mois -->
            <input
              v-if="asset.monthlyDca > 0"
              type="checkbox"
              class="shrink-0 accent-teal-600 cursor-pointer"
              :checked="dcaDone(asset)"
              :disabled="current.isClosed"
              :title="dcaDone(asset) ? 'Versé — décocher retire le versement DCA' : 'Marquer le versement mensuel comme fait'"
              @click.stop="toggleDca(asset)"
            />
            <span class="text-[13px] font-medium truncate" :class="{ 'text-gray-400': asset.monthlyDca > 0 && !dcaDone(asset) && !movementsForAsset(asset).length }">{{ asset.name }}</span>
            <span v-if="asset.type" class="badge bg-violet-50 text-violet-700">{{ asset.type }}</span>
            <span v-if="asset.accountName" class="badge bg-stone-100 text-gray-500">{{ asset.accountName }}</span>
            <span v-if="movementsForAsset(asset).length" class="badge bg-teal-50 text-teal-700">
              {{ movementsForAsset(asset).length }} mouvement{{ movementsForAsset(asset).length > 1 ? 's' : '' }}
            </span>
            <span class="ml-auto shrink-0 text-right">
              <span class="text-[13px] font-semibold" :class="movementsForAsset(asset).length ? '' : 'text-gray-400'">
                {{ fmt(movementsForAsset(asset).length ? movementsForAsset(asset).reduce((s, m) => s + (m.kind === 'versement' ? m.amount : -m.amount), 0) : asset.monthlyDca) }}
              </span>
              <span v-if="!movementsForAsset(asset).length && asset.monthlyDca" class="text-[11px] text-gray-400"> prévu</span>
            </span>
          </div>
          <div v-if="openAssetId === asset.id" class="edit-panel">
            <div v-for="m in movementsForAsset(asset)" :key="m.id" class="flex items-center gap-2 text-[12.5px] py-1">
              <span class="text-gray-400 w-20 shrink-0">{{ m.date }}</span>
              <span class="font-medium w-20 shrink-0" :class="m.kind === 'versement' ? 'text-emerald-600' : 'text-red-500'">{{ m.kind === 'retrait' ? '−' : '+' }}{{ fmt(m.amount) }}</span>
              <span v-if="m.source === 'dca'" class="badge bg-blue-50 text-blue-600">DCA</span>
              <span class="text-gray-300 text-[11px] ml-auto shrink-0">
                {{ m.kind === 'versement' ? (m.counterpartAccountName || '?') + ' → ' + (asset.accountName || asset.name) : (asset.accountName || asset.name) + ' → ' + (m.counterpartAccountName || '?') }}
              </span>
              <button v-if="!current.isClosed" class="icon-btn text-red-300 hover:text-red-500 shrink-0" @click="deleteAssetMovement(m)">×</button>
            </div>
            <p v-if="!movementsForAsset(asset).length" class="text-xs text-gray-400 py-1">Aucun mouvement ce mois.</p>
            <div v-if="!current.isClosed" class="flex flex-wrap gap-2 mt-2 items-center">
              <select v-model="assetMovementForm.kind" class="input w-28">
                <option value="versement">Versement</option>
                <option value="retrait">Retrait</option>
              </select>
              <input v-model="assetMovementForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="submitAssetMovement(asset)" />
              <input v-model="assetMovementForm.date" type="date" class="input w-34" />
              <select v-model="assetMovementForm.counterpartAccountId" class="input w-28" :title="assetMovementForm.kind === 'versement' ? 'Compte source' : 'Compte destination'">
                <option value="">— compte</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
              <span v-if="asset.accountName" class="text-gray-300 text-[12px]">{{ assetMovementForm.kind === 'versement' ? '→ ' + asset.accountName : '← ' + asset.accountName }}</span>
              <button class="btn-secondary" @click="submitAssetMovement(asset)">Ajouter</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── Calculateurs ─────────────────────────── -->
      <div v-if="calculators.length" class="card p-0 overflow-hidden mb-4">
        <div class="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
          <span class="font-semibold text-[13.5px]">Calculateurs</span>
          <span class="badge bg-cyan-50 text-cyan-700">relevés du mois</span>
        </div>
        <div v-for="calc in calculators" :key="calc.id" class="px-4 py-3 border-b border-stone-50 flex flex-wrap items-end gap-x-5 gap-y-2">
          <span class="text-[13px] font-medium w-28 shrink-0 self-center">{{ calc.name }}</span>

          <!-- Relevés -->
          <div v-for="r in calc.readings" :key="r.defId" class="flex items-end gap-1.5">
            <label class="field">
              <span>{{ r.label || r.symbol }}<span v-if="r.unit" class="text-gray-300"> · {{ r.unit }}</span></span>
              <span class="flex items-center gap-1">
                <template v-if="r.kind === 'index'">
                  <input v-model="r.previous" type="number" step="any" class="input w-24 text-gray-400" :disabled="current.isClosed" title="Index de début (reporté du mois précédent)" @change="saveReadings(calc)" />
                  <span class="text-gray-300 text-[12px]">→</span>
                </template>
                <input v-model="r.current" type="number" step="any" class="input w-24" :disabled="current.isClosed" :title="r.kind === 'index' ? 'Index de fin' : 'Valeur du mois'" @change="saveReadings(calc)" />
              </span>
            </label>
            <span v-if="r.kind === 'index' && r.consumption !== null" class="text-[11px] text-gray-400 pb-2">= {{ fmtNum(r.consumption) }}</span>
          </div>

          <!-- Résultat -->
          <div class="ml-auto flex items-center gap-4 self-center">
            <span v-if="calc.error" class="text-[12px] text-red-500">{{ calc.error }}</span>
            <template v-else>
              <span class="text-right">
                <span class="block text-[15px] font-bold" :class="calc.estimate === null ? 'text-gray-300' : 'text-gray-900'">{{ calc.estimate === null ? '—' : fmt(calc.estimate) }}</span>
                <span class="block text-[10.5px] text-gray-400">estimé</span>
              </span>
              <template v-if="calc.line">
                <span class="text-right">
                  <span class="block text-[13px] font-semibold text-gray-500">{{ fmt(calc.line.planned) }}</span>
                  <span class="block text-[10.5px] text-gray-400 truncate max-w-28">{{ calc.line.label }}</span>
                </span>
                <span class="text-right">
                  <span class="block text-[13px] font-semibold" :class="calc.gap === null ? 'text-gray-300' : calc.gap > 0 ? 'text-red-500' : 'text-emerald-600'">
                    {{ calc.gap === null ? '—' : (calc.gap > 0 ? '+' : '') + fmt(calc.gap) }}
                  </span>
                  <span class="block text-[10.5px] text-gray-400">écart</span>
                </span>
                <button
                  v-if="!current.isClosed && calc.gap !== null && Math.abs(calc.gap) >= 0.01 && Math.abs((calc.line.regularisation || 0) - calc.gap) >= 0.01"
                  class="btn-secondary"
                  :title="calc.line.regularisation ? 'Régularisation déjà posée : ' + fmt(calc.line.regularisation) : ''"
                  @click="regularize(calc)"
                >{{ calc.line.regularisation ? 'Mettre à jour' : 'Régulariser' }}</button>
                <span v-else-if="calc.line.regularisation" class="text-[11px] text-emerald-600">✓ régularisé</span>
              </template>
            </template>
          </div>
        </div>
      </div>

      <!-- Snapshots -->
      <div v-if="snapshotsOpen" class="card px-5 py-4 mb-4">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Soldes de début de mois</p>
        <div class="flex flex-wrap gap-3 mb-3">
          <label v-for="a in accounts" :key="a.id" class="field">
            <span>{{ a.name }}</span>
            <input v-model="snapshotEdits[a.id]" type="number" step="0.01" class="input w-28" :disabled="current.isClosed" placeholder="—" />
          </label>
        </div>
        <button v-if="!current.isClosed" class="btn-primary" @click="saveSnapshots">Sauvegarder</button>
      </div>

      <!-- Catégories -->
      <div class="grid grid-cols-2 gap-4 items-start">
        <div v-for="column in [groupsLeft, groupsRight]" :key="column === groupsLeft ? 'L' : 'R'" class="flex flex-col gap-4">
          <div v-for="group in column" :key="group.category.id ?? 'none'" class="card p-0 overflow-hidden">

            <!-- En-tête catégorie -->
            <div class="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: group.category.color }" />
              <span class="font-semibold text-[13.5px]">{{ group.category.name }}</span>
              <span class="ml-auto text-[12.5px] text-gray-400">{{ fmt(group.actual) }} <span class="text-gray-300">/ {{ fmt(group.planned) }}</span></span>
            </div>

            <!-- Lignes -->
            <div v-for="line in group.lines" :key="line.id">
              <div class="line-row" :class="{ 'line-row--pot': line.isPot }" @click="toggleEntries(line)">
                <!-- ☐ payé : prévu sans entrée → cocher crée l'entrée au prévu -->
                <input
                  v-if="showCheckbox(line)"
                  type="checkbox"
                  class="shrink-0 accent-violet-600 cursor-pointer"
                  :checked="isPaid(line)"
                  :disabled="current.isClosed"
                  :title="isPaid(line) ? 'Payé — décocher retire l\'entrée' : 'Marquer payé au montant prévu'"
                  @click.stop="togglePaid(line)"
                />
                <span class="text-[13px] font-medium truncate" :class="{ 'text-gray-400': !isPaid(line) }">
                  {{ line.label }}
                </span>
                <span v-if="line.isPot" class="badge bg-amber-50 text-amber-600" title="Cagnotte : le prévu est calculé à partir des ½">cagnotte · {{ line.pot?.partnerName }}</span>
                <span v-if="line.recurringDay && !isPaid(line)" class="badge bg-blue-50 text-blue-600">le {{ line.recurringDay }}</span>
                <span v-if="sharingOn && line.isShared && !line.isPot" class="badge bg-amber-50 text-amber-600" :title="'Cagnotte : ' + (potById(line.potLineId) || pots[0]).label">
                  ½{{ pots.length > 1 ? ' ' + ((potById(line.potLineId) || pots[0]).pot?.partnerName || '') : '' }}
                </span>

                <!-- Montant : le réel remplace le prévu (cagnotte : « à envoyer » calculé) -->
                <span class="ml-auto shrink-0 text-right">
                  <template v-if="line.isPot && !isPaid(line) && line.pot">
                    <span class="text-[11px] text-gray-400 mr-1">{{ potStatus(line) }}</span>
                    <span class="text-[13px] font-semibold" :class="line.pot.toSend > 0 ? 'text-amber-600' : line.pot.toSend < 0 ? 'text-emerald-600' : 'text-gray-400'">
                      {{ fmt(Math.abs(line.pot.toSend)) }}
                    </span>
                  </template>
                  <template v-else>
                    <span class="text-[13px] font-semibold" :class="!isPaid(line) ? 'text-gray-400' : overBudget(line) ? 'text-red-500' : ''">
                      {{ fmt(isPaid(line) ? line.actualAmount : line.plannedAmount) }}
                    </span>
                    <span v-if="isPaid(line) && line.plannedAmount > 0 && line.actualAmount !== line.plannedAmount" class="text-[11px] text-gray-400"> / {{ fmt(line.plannedAmount) }} prévu</span>
                  </template>
                </span>
                <button
                  v-if="!current.isClosed"
                  class="icon-btn shrink-0 text-gray-300 hover:text-gray-600"
                  title="Modifier la ligne"
                  @click.stop="lineFormId === line.id ? closeLineForm() : openEditLine(line)"
                >✎</button>
              </div>

              <!-- Panneau d'édition de la ligne -->
              <div v-if="lineFormId === line.id" class="edit-panel">
                <div class="flex flex-wrap gap-3">
                  <label class="field"><span>Libellé</span><input v-model="lineForm.label" type="text" class="input w-40" /></label>
                  <label v-if="!lineForm.isPot" class="field"><span>Prévu (€)</span><input v-model="lineForm.plannedAmount" type="number" step="0.01" class="input w-24" /></label>
                  <label class="field" title="Date par défaut du « payé »"><span>Jour</span><input v-model="lineForm.recurringDay" type="number" min="1" max="31" class="input w-16" placeholder="—" /></label>
                  <label class="field"><span>Catégorie</span>
                    <select v-model="lineForm.categoryId" class="input w-34">
                      <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                    </select>
                  </label>
                  <label v-if="themes.length" class="field"><span>Thème</span>
                    <select v-model="lineForm.themeId" class="input w-28">
                      <option value="">—</option>
                      <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
                    </select>
                  </label>
                  <label v-if="lineFormCategoryType !== 'revenu'" class="field"><span>Depuis</span>
                    <select v-model="lineForm.fromAccountId" class="input w-28">
                      <option value="">—</option>
                      <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                    </select>
                  </label>
                  <label v-if="lineFormCategoryType !== 'depense'" class="field"><span>Vers</span>
                    <select v-model="lineForm.toAccountId" class="input w-28">
                      <option value="">—</option>
                      <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                    </select>
                  </label>
                  <label v-if="sharingOn && !lineForm.isPot && lineFormCategoryType !== 'revenu'" class="checkbox self-end" title="Dépense commune (rattachée à une cagnotte)"><input v-model="lineForm.isShared" type="checkbox" /><span>Partagé ½</span></label>
                  <select v-if="sharingOn && !lineForm.isPot && lineForm.isShared && pots.length > 1" v-model="lineForm.potLineId" class="input w-36 self-end" title="Cagnotte concernée">
                    <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.pot?.partnerName }}</option>
                  </select>
                  <label v-if="lineFormCategoryType !== 'revenu'" class="checkbox self-end" title="Partage avec quelqu'un : le prévu de la ligne est calculé à partir des ½"><input v-model="lineForm.isPot" type="checkbox" /><span>Cagnotte</span></label>
                  <template v-if="lineForm.isPot">
                    <label class="field"><span>Partenaire</span><input v-model="lineForm.potPartnerName" type="text" class="input w-28" placeholder="Prénom" /></label>
                    <label class="field"><span>Il/elle a payé (€)</span><input v-model="lineForm.potPartnerPaid" type="number" step="0.01" class="input w-24" placeholder="0" /></label>
                    <label class="field"><span>Ma part (%)</span><input v-model="lineForm.potMyShare" type="number" min="0" max="100" class="input w-16" /></label>
                  </template>
                </div>
                <div class="flex gap-2 mt-3 items-center">
                  <button class="btn-primary" @click="submitLineForm">Sauver</button>
                  <button class="btn-secondary" @click="closeLineForm">Annuler</button>
                  <button v-if="line.templateLineId" class="link text-xs" title="Les prochains mois utiliseront ces valeurs" @click="pushToTemplate(line)">
                    Reporter dans le template
                  </button>
                  <span v-else class="text-[11px] text-gray-400">ligne propre à ce mois</span>
                  <button class="btn-danger ml-auto" @click="removeLineConfirm(line)">Supprimer</button>
                </div>
              </div>

              <!-- Entrées dépliées -->
              <div v-if="openEntriesLineId === line.id" class="edit-panel">
                <!-- Cagnotte : le détail du calcul -->
                <div v-if="line.isPot && line.pot" class="text-[12px] text-gray-500 grid grid-cols-2 gap-x-6 gap-y-0.5 max-w-md mb-2 pb-2 border-b border-stone-200">
                  <span>Payé par moi en commun (½)</span><span class="text-right font-medium text-gray-700">{{ fmt(line.pot.sharedByMe) }}<span v-if="line.pot.sharedPlanned" class="text-gray-400 font-normal"> dont {{ fmt(line.pot.sharedPlanned) }} prévu</span></span>
                  <span>Payé par {{ line.pot.partnerName }}</span><span class="text-right font-medium text-gray-700">{{ fmt(line.pot.partnerPaid) }}</span>
                  <span>Total commun</span><span class="text-right font-medium text-gray-700">{{ fmt(line.pot.total) }}</span>
                  <span>Ma part ({{ line.pot.myShare }} %)</span><span class="text-right font-medium text-gray-700">{{ fmt(line.pot.myPart) }}</span>
                  <span class="font-medium text-gray-700">{{ potStatus(line) }}</span><span class="text-right font-semibold" :class="line.pot.toSend > 0 ? 'text-amber-600' : 'text-emerald-600'">{{ fmt(Math.abs(line.pot.toSend)) }}</span>
                </div>
                <div v-for="e in entriesForLine(line)" :key="e.id" class="flex items-center gap-2 text-[12.5px] py-1 flex-wrap">
                  <!-- Édition inline de l'entrée -->
                  <template v-if="editingEntryId === e.id">
                    <input v-model="entryEdit.amount" type="number" step="0.01" class="input w-24" @keyup.enter="saveEntryEdit(e)" />
                    <input v-model="entryEdit.date" type="date" class="input w-34" />
                    <input v-model="entryEdit.label" type="text" class="input w-36" placeholder="Détail" @keyup.enter="saveEntryEdit(e)" />
                    <select v-if="themes.length" v-model="entryEdit.themeId" class="input w-28">
                      <option value="">— thème</option>
                      <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
                    </select>
                    <select v-model="entryEdit.accountId" class="input w-28">
                      <option value="">— compte</option>
                      <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                    </select>
                    <template v-if="lineHasDestination(line)">
                      <span class="text-gray-300">→</span>
                      <select v-model="entryEdit.toAccountId" class="input w-28">
                        <option value="">— vers</option>
                        <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                      </select>
                    </template>
                    <label v-if="sharingOn && !line.isPot" class="checkbox"><input v-model="entryEdit.isShared" type="checkbox" /><span>½</span></label>
                    <select v-if="sharingOn && !line.isPot && entryEdit.isShared && pots.length > 1" v-model="entryEdit.potLineId" class="input w-32">
                      <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.pot?.partnerName }}</option>
                    </select>
                    <select v-if="envelopes.length" v-model="entryEdit.envelopeId" class="input w-36" title="Dépense prise dans une enveloppe">
                      <option value="">— pas d'enveloppe</option>
                      <option v-for="env in envelopes" :key="env.id" :value="env.id">depuis {{ env.name }}</option>
                    </select>
                    <label v-if="entryEdit.envelopeId && envelopeById(entryEdit.envelopeId)?.targetAmount" class="checkbox" title="La cible affichée est corrigée d'autant"><input v-model="entryEdit.envelopeInTarget" type="checkbox" /><span>fait partie de l'objectif</span></label>
                    <button class="btn-primary" @click="saveEntryEdit(e)">Sauver</button>
                    <button class="btn-secondary" @click="editingEntryId = null">Annuler</button>
                  </template>
                  <template v-else>
                  <span class="text-gray-400 w-20 shrink-0">{{ e.date }}</span>
                  <span class="font-medium w-20 shrink-0">{{ fmt(e.amount) }}</span>
                  <span v-if="e.source === 'paye'" class="badge bg-blue-50 text-blue-600">payé</span>
                  <span v-if="themeById(e.themeId)" class="badge" :style="{ background: themeById(e.themeId).color + '22', color: themeById(e.themeId).color }">{{ themeById(e.themeId).name }}</span>
                  <span v-if="sharingOn && e.isShared" class="badge bg-amber-50 text-amber-600" :title="'Cagnotte : ' + (potById(e.potLineId) || pots[0]).label">
                    ½{{ pots.length > 1 ? ' ' + ((potById(e.potLineId) || pots[0]).pot?.partnerName || '') : '' }}
                  </span>
                  <span class="text-gray-400 truncate">{{ e.label }}</span>
                  <span v-if="e.envelopeId && envelopeById(e.envelopeId)" class="badge bg-violet-50 text-violet-700" :title="e.envelopeInTarget ? 'Fait partie de l\'objectif' : 'Hors objectif'">
                    depuis {{ envelopeById(e.envelopeId).name }}{{ e.envelopeInTarget ? '' : ' · hors objectif' }}
                  </span>
                  <span v-if="accountById(e.accountId) || accountById(e.toAccountId)" class="text-gray-300 text-[11px] ml-auto shrink-0">
                    {{ accountById(e.accountId)?.name || '?' }}<template v-if="accountById(e.toAccountId)"> → {{ accountById(e.toAccountId).name }}</template>
                  </span>
                  <button v-if="!current.isClosed" class="icon-btn text-gray-300 hover:text-gray-600 shrink-0" :class="{ 'ml-auto': !accountById(e.accountId) && !accountById(e.toAccountId) }" title="Modifier l'entrée" @click="openEditEntry(e)">✎</button>
                  <button v-if="!current.isClosed" class="icon-btn text-red-300 hover:text-red-500 shrink-0" @click="removeEntry(e)">×</button>
                  </template>
                </div>
                <p v-if="!entriesForLine(line).length" class="text-xs text-gray-400 py-1">Aucune entrée.</p>

                <!-- Ajout d'entrée -->
                <div v-if="!current.isClosed" class="flex flex-wrap gap-2 mt-2 items-center">
                  <input v-model="entryForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="submitEntry(line)" />
                  <input v-model="entryForm.date" type="date" class="input w-34" />
                  <input v-model="entryForm.label" type="text" class="input w-36" placeholder="Détail (optionnel)" @keyup.enter="submitEntry(line)" />
                  <select v-if="themes.length" v-model="entryForm.themeId" class="input w-28">
                    <option value="">— thème</option>
                    <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                  <select v-model="entryForm.accountId" class="input w-28" :title="lineHasDestination(line) ? 'Depuis' : 'Compte'">
                    <option value="">{{ lineHasDestination(line) ? '— depuis' : '— compte' }}</option>
                    <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                  </select>
                  <template v-if="lineHasDestination(line)">
                    <span class="text-gray-300 text-[12px]">→</span>
                    <select v-model="entryForm.toAccountId" class="input w-28" title="Vers">
                      <option value="">— vers</option>
                      <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                    </select>
                  </template>
                  <label v-if="sharingOn && !line.isPot" class="checkbox" title="Dépense commune (rattachée à une cagnotte)"><input v-model="entryForm.isShared" type="checkbox" /><span>½</span></label>
                  <select v-if="sharingOn && !line.isPot && entryForm.isShared && pots.length > 1" v-model="entryForm.potLineId" class="input w-32" title="Cagnotte concernée">
                    <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.pot?.partnerName }}</option>
                  </select>
                  <select v-if="envelopes.length" v-model="entryForm.envelopeId" class="input w-36" title="Dépense prise dans une enveloppe : elle baisse d'autant">
                    <option value="">— pas d'enveloppe</option>
                    <option v-for="env in envelopes" :key="env.id" :value="env.id">depuis {{ env.name }}</option>
                  </select>
                  <label v-if="entryForm.envelopeId && envelopeById(entryForm.envelopeId)?.targetAmount" class="checkbox" title="La cible affichée est corrigée d'autant (le reste à épargner ne bouge pas)"><input v-model="entryForm.envelopeInTarget" type="checkbox" /><span>fait partie de l'objectif</span></label>
                  <button class="btn-secondary" @click="submitEntry(line)">Ajouter</button>
                </div>
              </div>
            </div>

            <p v-if="!group.lines.length && lineFormId !== `new-${group.category.id}`" class="text-xs text-gray-400 px-4 py-2.5">Aucune ligne.</p>

            <!-- Ajout d'une ligne au mois (sans toucher au template) -->
            <div v-if="lineFormId === `new-${group.category.id}`" class="edit-panel">
              <div class="flex flex-wrap gap-3">
                <label class="field"><span>Libellé</span><input v-model="lineForm.label" type="text" class="input w-40" placeholder="Canva, Cadeau…" @keyup.enter="submitLineForm" /></label>
                <label v-if="!lineForm.isPot" class="field" title="À venir : la ligne se cochera quand ce sera passé"><span>Prévu (€)</span><input v-model="lineForm.plannedAmount" type="number" step="0.01" class="input w-24" placeholder="à venir" @keyup.enter="submitLineForm" /></label>
                <label v-if="!lineForm.isPot" class="field" title="Déjà passé : l'entrée est créée tout de suite"><span>Montant (€)</span><input v-model="lineForm.actualAmount" type="number" step="0.01" class="input w-24" placeholder="déjà passé" @keyup.enter="submitLineForm" /></label>
                <label v-if="!lineForm.isPot && lineForm.actualAmount" class="field"><span>Date</span><input v-model="lineForm.entryDate" type="date" class="input w-34" /></label>
                <label v-else class="field" title="Date par défaut du « payé »"><span>Jour</span><input v-model="lineForm.recurringDay" type="number" min="1" max="31" class="input w-16" placeholder="—" /></label>
                <label v-if="themes.length" class="field"><span>Thème</span>
                  <select v-model="lineForm.themeId" class="input w-28">
                    <option value="">—</option>
                    <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                </label>
                <label v-if="lineFormCategoryType !== 'revenu'" class="field"><span>Depuis</span>
                  <select v-model="lineForm.fromAccountId" class="input w-28">
                    <option value="">—</option>
                    <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                  </select>
                </label>
                <label v-if="lineFormCategoryType !== 'depense'" class="field"><span>Vers</span>
                  <select v-model="lineForm.toAccountId" class="input w-28">
                    <option value="">—</option>
                    <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                  </select>
                </label>
                <label v-if="sharingOn && !lineForm.isPot && lineFormCategoryType !== 'revenu'" class="checkbox self-end" title="Dépense commune (rattachée à une cagnotte)"><input v-model="lineForm.isShared" type="checkbox" /><span>Partagé ½</span></label>
                  <select v-if="sharingOn && !lineForm.isPot && lineForm.isShared && pots.length > 1" v-model="lineForm.potLineId" class="input w-36 self-end" title="Cagnotte concernée">
                    <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.pot?.partnerName }}</option>
                  </select>
                  <label v-if="lineFormCategoryType !== 'revenu'" class="checkbox self-end" title="Partage avec quelqu'un : le prévu de la ligne est calculé à partir des ½"><input v-model="lineForm.isPot" type="checkbox" /><span>Cagnotte</span></label>
                  <template v-if="lineForm.isPot">
                    <label class="field"><span>Partenaire</span><input v-model="lineForm.potPartnerName" type="text" class="input w-28" placeholder="Prénom" /></label>
                    <label class="field"><span>Il/elle a payé (€)</span><input v-model="lineForm.potPartnerPaid" type="number" step="0.01" class="input w-24" placeholder="0" /></label>
                    <label class="field"><span>Ma part (%)</span><input v-model="lineForm.potMyShare" type="number" min="0" max="100" class="input w-16" /></label>
                  </template>
              </div>
              <div class="flex gap-2 mt-3">
                <button class="btn-primary" @click="submitLineForm">Ajouter</button>
                <button class="btn-secondary" @click="closeLineForm">Annuler</button>
              </div>
            </div>
            <button v-else-if="!current.isClosed" class="link text-xs px-4 py-2 block" @click="openAddLine(group.category)">+ ligne</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/style.css";

.card { @apply bg-white rounded-xl border border-stone-200; }
.badge { @apply text-[10.5px] font-semibold px-1.5 py-px rounded-full shrink-0; }
.line-row { @apply flex items-center gap-2 px-4 py-2 border-b border-stone-50 cursor-pointer hover:bg-stone-50; }
.line-row--pot { @apply bg-amber-50/60 hover:bg-amber-50 border-l-2 border-l-amber-400; }
.edit-panel { @apply px-4 py-3 bg-stone-50 border-b border-stone-100; }
.field { @apply flex flex-col gap-1 text-[11px] font-medium text-gray-500; }
.input { @apply py-1.5 px-2 border border-stone-200 rounded-md text-[13px] text-gray-900 bg-white outline-none focus:border-violet-400 disabled:opacity-50; }
.checkbox { @apply flex items-center gap-1 text-[12.5px] text-gray-600 cursor-pointer; }
.btn-primary { @apply py-1.5 px-3 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-[12.5px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-secondary { @apply py-1.5 px-3 bg-white border border-stone-200 hover:bg-stone-100 text-gray-600 rounded-md text-[12.5px] font-medium cursor-pointer; }
.icon-btn { @apply w-6 h-6 rounded hover:bg-stone-200 cursor-pointer text-[13px]; }
.progress { @apply h-1 bg-stone-200 rounded-full overflow-hidden; }
.progress-bar { @apply h-full rounded-full; }
.link { @apply text-violet-600 hover:underline cursor-pointer; }
</style>
