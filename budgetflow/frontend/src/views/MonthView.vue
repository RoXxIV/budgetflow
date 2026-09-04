<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { eur } from '@/lib/format.js'
import {
  getMonths, getMonthPrefill, createMonth, setMonthClosed, setMonthNotes,
  getMonthLines, payLine,
  getMonthSnapshots, upsertMonthSnapshots,
  getMonthEntries, createEntry, updateEntry, deleteEntry,
  getMonthSummary, getMonthEnvelopeContributions,
  createMonthLine, updateMonthLine, deleteMonthLine, applyLineToTemplate,
} from '@/api/months.js'
import { getEnvelopes, addContribution, removeContribution } from '@/api/envelopes.js'
import { getMonthCalculators, saveMonthReadings, regularizeCalculator } from '@/api/calculators.js'
import AppModal from '@/components/AppModal.vue'
import HelpTip from '@/components/HelpTip.vue'
import { confirmDialog, apiError } from '@/composables/useDialog.js'
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
const calcOpen = ref(false)        // bloc calculateurs replié par défaut
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
  applyOpenDefaults()
}

async function reload() {
  await loadMonthData(current.value.id)
}

// ─── Note du mois : texte libre, une par mois, enregistrée au blur ───
const monthNotes = ref('')
const notesSaved = ref(false)
let notesSavedTimer = null
watch(() => current.value?.id, () => { monthNotes.value = current.value?.notes || '' })
async function saveNotes() {
  if (!current.value || monthNotes.value.trim() === (current.value.notes || '').trim()) return
  try {
    const { data } = await setMonthNotes(current.value.id, monthNotes.value)
    current.value.notes = data.notes
    notesSaved.value = true
    clearTimeout(notesSavedTimer)
    notesSavedTimer = setTimeout(() => { notesSaved.value = false }, 2000)
  } catch (e) { apiError(e) }
}

// ─── Investissements : ☐ versé (DCA), mouvements du mois ─
const openAssetId = ref(null)
const assetMovementForm = ref({})
const movementsForAsset = (asset) => monthAssetMovements.value.filter((m) => m.assetId === asset.id)
const dcaDone = (asset) => movementsForAsset(asset).some((m) => m.source === 'dca')
const monthInvestedTotal = computed(() => monthAssetMovements.value.filter((m) => m.kind === 'versement').reduce((s, m) => s + m.amount, 0))

async function toggleDca(asset) {
  if (movementsForAsset(asset).length) return // ☐ à sens unique : le réel remplace le prévu
  try {
    await dcaAsset(current.value.id, asset.id)
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
  const ok = await confirmDialog({ title: `${verb} la régularisation`, message: `Une entrée de ${fmt(calc.gap)} sera posée sur « ${calc.line.label} » (écart entre l'estimé ${fmt(calc.estimate)} et la mensualité ${fmt(calc.line.planned)}).${calc.line?.regularisation ? ' La précédente est remplacée.' : ''}`, confirmLabel: verb })
  if (!ok) return
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
// ─── Synthèse & navigation de mois (refonte registre §5.3) ───
const sortedMonths = computed(() => [...monthsList.value].sort((a, b) => a.period.localeCompare(b.period)))
const curIdx = computed(() => sortedMonths.value.findIndex((m) => m.id === current.value?.id))
const prevMonthTarget = computed(() => (curIdx.value > 0 ? sortedMonths.value[curIdx.value - 1] : null))
const nextMonthTarget = computed(() => sortedMonths.value[curIdx.value + 1] || null)
function stepMonth(d) {
  const t = d < 0 ? prevMonthTarget.value : nextMonthTarget.value
  if (t) openMonth(t)
}
const nextPeriodName = computed(() => {
  const last = sortedMonths.value[sortedMonths.value.length - 1]
  if (!last) return ''
  const [y, m] = last.period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  const s = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
})
function onMonthSelect(e) {
  const v = e.target.value
  if (v === '__new') {
    e.target.value = String(current.value?.id ?? '')
    openCreateForm()
    return
  }
  openMonth(monthsList.value.find((m) => m.id === Number(v)))
}
const objectifPct = computed(() => {
  const t = summaryData.value?.tiles
  return t?.objectifEpargne ? Math.round((t.misDeCote / t.objectifEpargne) * 100) : 0
})

// Ombre de la barre sticky uniquement après scroll (sentinelle + IntersectionObserver)
const scrolled = ref(false)
const stickySentinel = ref(null)
let sentinelObs = null
watch(stickySentinel, (el) => {
  if (sentinelObs) { sentinelObs.disconnect(); sentinelObs = null }
  if (el) {
    sentinelObs = new IntersectionObserver(([e]) => { scrolled.value = !e.isIntersecting })
    sentinelObs.observe(el)
  }
})

// Couleur de catégorie désaturée (~65 %) : seule couleur libre admise dans le registre
function desat(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 'var(--c-ink-3)'
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const gray = 0.299 * r + 0.587 * g + 0.114 * b
  const mix = (c) => Math.round(c * 0.65 + gray * 0.35)
  return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')'
}
// Variante de remplissage de la barre de section (§5.8)
const barVariant = (group) => {
  if (!group.planned) return ''
  const ratio = group.actual / group.planned
  if (ratio > 1) return 'is-over'
  if (ratio >= 0.85) return 'is-warn'
  return ''
}
// Ligne à signaler : cagnotte à régler, ou échéance passée non pointée (§5.6)
function rowAlert(line) {
  if (line.isPot && line.pot && line.pot.toSend > 0 && !isPaid(line)) return true
  if (line.recurringDay && !isPaid(line) && line.plannedAmount > 0 && current.value) {
    const today = new Date().toISOString().substring(0, 10)
    const due = current.value.period + '-' + String(line.recurringDay).padStart(2, '0')
    if (today.startsWith(current.value.period) && due < today) return true
  }
  return false
}
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

// ☐ versé : contribution de la mensualité suggérée, depuis le compte principal (virtuelle si c'est aussi l'hôte)
async function contributeSuggested(env) {
  if (contribsForEnvelope(env).some((c) => c.kind === 'normale')) return
  const today = new Date().toISOString().substring(0, 10)
  try {
    await addContribution(env.id, {
      amount: env.monthlySuggestion,
      date: today.startsWith(current.value.period) ? today : `${current.value.period}-01`,
      fromAccountId: accounts.value.find((a) => a.isMain)?.id || null,
      notes: 'Mensualité',
    })
    await reload()
  } catch (e) { apiError(e) }
}

// ─── Helpers ─────────────────────────────────────────────
const fmt = eur // format registre : « 1 667,85 € » avec espaces fines insécables
const shortDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
const themeById = (id) => themes.value.find((t) => t.id === id) || null
const accountById = (id) => accounts.value.find((a) => a.id === id) || null // liste complète : les entrées passées gardent leur nom
const activeAccounts = computed(() => accounts.value.filter((a) => a.isActive)) // saisies : comptes actifs seulement
const entriesForLine = (line) => entriesAll.value.filter((e) => e.lineId === line.id)
// Une seule entrée avec un détail → la ligne s'affiche « Amazon — TV » (déplier pour le multi)
const singleEntryDetail = (line) => {
  const es = entriesForLine(line)
  return es.length === 1 ? (es[0].label || null) : null
}
// Tous les thèmes portés par la ligne et ses entrées (dédupliqués), visibles sans déplier
const themesForLine = (line) => {
  const ids = new Set()
  if (line.themeId) ids.add(line.themeId)
  entriesForLine(line).forEach((e) => { if (e.themeId) ids.add(e.themeId) })
  return [...ids].map((id) => themeById(id)).filter(Boolean)
}
// Virements système rattachés à la ligne (sans ligne ni catégorie : enveloppe → compte prélevé, reste pris ailleurs)
const transfersForLine = (line) => entriesAll.value.filter((e) => e.relatedLineId === line.id)
const lineCategoryType = (line) => categories.value.find((c) => c.id === line.categoryId)?.type || 'depense'
// La ligne est un mouvement entre comptes (transfert, épargne, ou Vers configuré dans le template)
const lineHasDestination = (line) => ['epargne', 'transfert'].includes(lineCategoryType(line)) || !!line.toAccountId
const isPaid = (line) => entriesForLine(line).length > 0

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
// Toutes les catégories en pleine largeur, ordonnées par type : revenu, dépense, épargne, transfert
const TYPE_ORDER = { revenu: 0, depense: 1, epargne: 2, transfert: 3 }
const displayGroups = computed(() =>
  [...groups.value].sort((a, b) => (TYPE_ORDER[a.category.type] ?? 9) - (TYPE_ORDER[b.category.type] ?? 9))
)

// Sections repliables — règle corrigée (addendum §1) : une section avec des lignes ou un prévu
// est dépliée par défaut ; le choix manuel prime et survit au rechargement (localStorage).
const CATS_LS = 'budgetflow.sections.open'
let manualOpen = {}
try { manualOpen = JSON.parse(localStorage.getItem(CATS_LS) || '{}') } catch { manualOpen = {} }
const openCats = ref(new Set())
const isCatOpen = (group) => openCats.value.has(group.category.id ?? 'none')
const defaultOpen = (group) => group.lines.length > 0 || group.planned > 0
function toggleCatOpen(group) {
  const key = group.category.id ?? 'none'
  const set = new Set(openCats.value)
  set.has(key) ? set.delete(key) : set.add(key)
  openCats.value = set
  manualOpen[key] = set.has(key)
  try { localStorage.setItem(CATS_LS, JSON.stringify(manualOpen)) } catch { /* stockage indisponible */ }
}
function applyOpenDefaults() {
  openCats.value = new Set(
    groups.value.filter((g) => manualOpen[g.category.id ?? 'none'] ?? defaultOpen(g)).map((g) => g.category.id ?? 'none')
  )
}

// En-têtes enrichis (addendum §2) : avancement du pointage et aperçu des sections repliées
const pointableLines = (group) => group.lines.filter((l) => l.plannedAmount > 0 || l.isPot)
const pointedCount = (group) => pointableLines(group).filter((l) => isPaid(l)).length
const sectionPreview = (group) => {
  const names = group.lines.slice(0, 3).map((l) => l.label || 'Sans libellé')
  return names.join(', ') + (group.lines.length > 3 ? ' +' + (group.lines.length - 3) : '')
}

// Reste à vivre (addendum §4) : solde actuel − sorties prévues non réalisées
// (prevusRestants vient du backend et inclut déjà cagnottes, DCA et mensualités)
const resteAVivre = computed(() => {
  const t = summaryData.value?.tiles
  if (!t || t.disponible === null) return null
  return Math.round((t.disponible - t.detail.prevusRestants) * 100) / 100
})

// À faire ce mois (addendum §5) : retards, cagnottes à régler, échéances ≤ 7 jours
const todoLines = computed(() => {
  if (!current.value) return []
  const today = new Date().toISOString().substring(0, 10)
  const inMonth = today.startsWith(current.value.period)
  const list = []
  for (const g of groups.value) {
    for (const l of g.lines) {
      if (isPaid(l)) continue
      if (l.isPot && l.pot && l.pot.toSend > 0) {
        list.push({ line: l, cat: g.category, kind: 'send', due: l.recurringDay && current.value ? current.value.period + '-' + String(l.recurringDay).padStart(2, '0') : null })
        continue
      }
      if (!(l.plannedAmount > 0) || !l.recurringDay || !inMonth) continue
      const due = current.value.period + '-' + String(l.recurringDay).padStart(2, '0')
      if (due < today) list.push({ line: l, cat: g.category, kind: 'late', due })
      else if ((new Date(due) - new Date(today)) / 86400000 <= 7) list.push({ line: l, cat: g.category, kind: 'soon', due })
    }
  }
  return list.sort((a, b) => ((a.due || '') < (b.due || '') ? -1 : 1)).slice(0, 6)
})
async function jumpToLine(t) {
  const key = t.cat.id ?? 'none'
  if (!openCats.value.has(key)) toggleCatOpen({ category: t.cat })
  await nextTick()
  document.getElementById('sec-' + key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Total dépenses du registre (addendum §3 — limité aux catégories de type dépense :
// additionner revenus et dépenses n'aurait pas de sens)
const plannedDepenses = computed(() => groups.value.filter((g) => g.category.type === 'depense').reduce((s, g) => s + g.planned, 0))

// Part de chaque catégorie dépense — et des enveloppes — dans les sorties réelles du mois
// (dépenses réelles + mis de côté en enveloppes), barre sous chaque titre
const totalDepenses = computed(() => groups.value.filter((g) => g.category.type === 'depense').reduce((s, g) => s + g.actual, 0))
const totalSorties = computed(() => Math.round((totalDepenses.value + monthContribTotal.value) * 100) / 100)
const depensePct = (group) => {
  if (group.category.type !== 'depense' || !totalSorties.value || group.actual <= 0) return null
  return Math.round((group.actual / totalSorties.value) * 100)
}
const envelopesPct = computed(() => {
  if (!totalSorties.value || monthContribTotal.value <= 0) return null
  return Math.round((monthContribTotal.value / totalSorties.value) * 100)
})

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
  const ok = await confirmDialog({
    title: `${action} ${current.value.name}`,
    message: current.value.isClosed ? 'Les saisies redeviendront possibles.' : 'Toutes les saisies du mois seront verrouillées (entrées, ☐ payé, contributions datées dans le mois). Vous pourrez rouvrir.',
    confirmLabel: action,
  })
  if (!ok) return
  try {
    const { data } = await setMonthClosed(current.value.id, !current.value.isClosed)
    current.value = data
    monthsList.value = (await getMonths()).data
  } catch (e) { apiError(e) }
}

// ─── ☐ payé ──────────────────────────────────────────────
// Enveloppe insuffisante (ligne mensualisée) : le backend répond ENVELOPE_SHORT → modal « vider et prendre le reste sur … »
const shortfall = ref(null) // { line, envelopeName, available, missing, amount, accountId }

async function togglePaid(line) {
  if (isPaid(line)) return // ☐ à sens unique : dès qu'une entrée existe, on gère les entrées elles-mêmes (×)
  try {
    await payLine(current.value.id, line.id)
    await reload()
  } catch (e) {
    const p = e.response?.data
    if (p?.code === 'ENVELOPE_SHORT') {
      shortfall.value = { line, ...p, accountId: line.fromAccountId || accounts.value.find((a) => a.isMain)?.id || '' }
      return
    }
    apiError(e)
  }
}

async function confirmShortfall() {
  const s = shortfall.value
  if (!s?.accountId) return
  try {
    await payLine(current.value.id, s.line.id, { shortfallAccountId: s.accountId })
    shortfall.value = null
    await reload()
  } catch (e) { apiError(e) }
}

// ─── Entrées (déroulé par ligne : liste seulement, la saisie passe par le modal) ─
const openEntriesLineId = ref(null)

// Date par défaut : toujours dans le mois de la fiche (aujourd'hui si on y est, sinon le 1er)
function defaultDate() {
  const today = new Date().toISOString().substring(0, 10)
  return current.value && !today.startsWith(current.value.period) ? `${current.value.period}-01` : today
}

function defaultEntryDate(line) {
  if (line.recurringDay && current.value) {
    return `${current.value.period}-${String(line.recurringDay).padStart(2, '0')}`
  }
  return defaultDate()
}

function toggleEntries(line) {
  openEntriesLineId.value = openEntriesLineId.value === line.id ? null : line.id
}

// Cible corrigée d'une enveloppe : « 2 700 / 3 500 (4 500 − 1 000 dépensés) »
const envelopeTargetLabel = (env) => env.spentInTarget
  ? `${fmt(env.effectiveTarget)} (${fmt(env.targetAmount)} − ${fmt(env.spentInTarget)} dépensés)`
  : fmt(env.targetAmount)
const envelopeById = (id) => envelopes.value.find((e) => e.id === id) || null

async function removeEntry(entry) {
  try { await deleteEntry(current.value.id, entry.id); await reload() } catch (e) { apiError(e) }
}

// ─── Modal d'entrée (ajout / édition) — mêmes champs que le modal de ligne ─
const entryModalLine = ref(null)   // ligne concernée (null = modal fermé)
const entryModalEntry = ref(null)  // entrée en édition (null = ajout)
const entryForm = ref({})
const entryModalOpen = computed(() => entryModalLine.value !== null)
const entryLineIsRevenu = computed(() => !!entryModalLine.value && lineCategoryType(entryModalLine.value) === 'revenu')

function openAddEntry(line) {
  entryModalLine.value = line
  entryModalEntry.value = null
  const mainId = accounts.value.find((a) => a.isMain)?.id || ''
  const isRevenu = lineCategoryType(line) === 'revenu'
  entryForm.value = {
    amount: '',
    date: defaultEntryDate(line),
    label: '',
    themeId: line.themeId || '',
    source: isRevenu ? '' : ('a:' + (line.fromAccountId || mainId)),      // compte ou enveloppe
    creditAccountId: isRevenu ? (line.toAccountId || mainId) : '',
    toAccountId: lineHasDestination(line) ? (line.toAccountId || '') : '',
    paymentMethod: line.paymentMethod || settings.value?.paymentMethods?.[0] || 'CB',
    isShared: line.isShared,
    potLineId: line.potLineId || pots.value[0]?.id || '',
    envelopeInTarget: true,
  }
}

function openEditEntry(line, e) {
  entryModalLine.value = line
  entryModalEntry.value = e
  const isRevenu = lineCategoryType(line) === 'revenu'
  entryForm.value = {
    amount: e.amount,
    date: e.date,
    label: e.label || '',
    themeId: e.themeId || '',
    source: e.envelopeId ? 'e:' + e.envelopeId : (e.accountId ? 'a:' + e.accountId : ''),
    creditAccountId: isRevenu ? (e.accountId || '') : '',
    toAccountId: e.toAccountId || '',
    paymentMethod: e.paymentMethod || line.paymentMethod || settings.value?.paymentMethods?.[0] || 'CB',
    isShared: e.isShared,
    potLineId: e.potLineId || pots.value[0]?.id || '',
    envelopeInTarget: e.envelopeInTarget !== false,
  }
}

function closeEntryModal() {
  entryModalLine.value = null
  entryModalEntry.value = null
}

const entrySourceEnvelope = computed(() => {
  const s = entryForm.value.source || ''
  return s.startsWith('e:') ? envelopeById(Number(s.slice(2))) : null
})
const entrySourceAccountId = computed(() => {
  const s = entryForm.value.source || ''
  if (s.startsWith('a:')) return Number(s.slice(2))
  if (entrySourceEnvelope.value) return entrySourceEnvelope.value.accountId || accounts.value.find((a) => a.isMain)?.id || null
  return null
})
// « Vers » : ligne à destination (épargne, transfert, Vers du template), virement, ou entrée qui en a déjà un
const entryIsTransfer = computed(() =>
  !!entryModalLine.value && !entryLineIsRevenu.value && (
    lineHasDestination(entryModalLine.value) || /virement/i.test(entryForm.value.paymentMethod || '') || !!entryForm.value.toAccountId
  )
)

function entryPayload() {
  const f = entryForm.value
  const isRevenu = entryLineIsRevenu.value
  return {
    lineId: entryModalLine.value.id,
    amount: parseFloat(f.amount),
    date: f.date,
    label: f.label || null,
    themeId: f.themeId || null,
    accountId: isRevenu ? (f.creditAccountId || null) : entrySourceAccountId.value,
    toAccountId: entryIsTransfer.value ? (f.toAccountId || null) : null,
    paymentMethod: isRevenu ? null : (f.paymentMethod || null),
    isShared: f.isShared,
    potLineId: f.isShared ? (f.potLineId || null) : null,
    envelopeId: entrySourceEnvelope.value?.id || null,
    envelopeInTarget: f.envelopeInTarget !== false,
  }
}

async function submitEntryModal() {
  const p = entryPayload()
  if (isNaN(p.amount) || !p.amount) return
  try {
    if (entryModalEntry.value) await updateEntry(current.value.id, entryModalEntry.value.id, p)
    else await createEntry(current.value.id, p)
    closeEntryModal()
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

const lineFormCategory = ref(null)

function openAddLine(category) {
  lineFormId.value = `new-${category.id}`
  lineFormCategory.value = category
  const mainId = accounts.value.find((a) => a.isMain)?.id || ''
  lineForm.value = {
    label: '',
    plannedAmount: '',   // prévu seul → ligne à cocher plus tard
    actualAmount: '',    // montant rempli → entrée créée tout de suite (le réel remplace le prévu)
    entryLabel: '',      // …avec son détail propre (ligne « Amazon », entrée « xiaomi redmi »)
    entryDate: defaultDate(),
    // « Depuis » : un compte ('a:ID') ou une enveloppe ('e:ID' → dépense prise dans l'enveloppe)
    source: category.type === 'revenu' ? '' : (mainId ? 'a:' + mainId : ''),
    envelopeInTarget: true,
    paymentMethod: settings.value?.paymentMethods?.[0] || 'CB',
    categoryId: category.id,
    themeId: '',
    fromAccountId: '',
    toAccountId: category.type === 'revenu' ? mainId : '',
    isShared: false,
    recurringDay: '',
    potLineId: pots.value[0]?.id || '',
    isPot: false,
    potPartnerName: '',
    potPartnerPaid: '',
    potMyShare: 50,
  }
}

// Source choisie dans « Depuis » : compte ou enveloppe (→ compte hôte, sinon principal)
const sourceEnvelope = computed(() => {
  const s = lineForm.value.source || ''
  return s.startsWith('e:') ? envelopeById(Number(s.slice(2))) : null
})
const sourceAccountId = computed(() => {
  const s = lineForm.value.source || ''
  if (s.startsWith('a:')) return Number(s.slice(2))
  if (sourceEnvelope.value) return sourceEnvelope.value.accountId || accounts.value.find((a) => a.isMain)?.id || null
  return null
})
// « Vers » : moyen de paiement « virement » (provision vers un de mes comptes, ou « extérieur »),
// catégorie à destination (épargne, transfert), ou ligne qui a déjà un « Vers »
const isTransfer = computed(() =>
  /virement/i.test(lineForm.value.paymentMethod || '')
  || ['epargne', 'transfert'].includes(lineFormCategoryType.value)
  || (!lineModalAdding.value && !!lineForm.value.toAccountId)
)
// « Vers » ne propose jamais le compte source (un virement vers soi-même n'a pas de sens)
const versAccountsLine = computed(() => activeAccounts.value.filter((a) => a.id !== sourceAccountId.value))
const versAccountsEntry = computed(() => activeAccounts.value.filter((a) => a.id !== entrySourceAccountId.value))

const lineFormLine = ref(null) // ligne en cours d'édition (pour supprimer / reporter dans le template)

function openEditLine(line) {
  lineFormId.value = line.id
  lineFormLine.value = line
  lineFormCategory.value = categories.value.find((c) => c.id === line.categoryId) || NO_CATEGORY
  lineForm.value = {
    label: line.label,
    plannedAmount: line.isPot ? '' : (line.plannedAmount ?? ''),
    actualAmount: '',
    entryDate: '',
    source: line.fromAccountId ? 'a:' + line.fromAccountId : '',
    envelopeInTarget: true,
    paymentMethod: line.paymentMethod || settings.value?.paymentMethods?.[0] || 'CB',
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
  lineFormLine.value = null
}
const lineModalOpen = computed(() => lineFormId.value !== null)
const lineModalAdding = computed(() => typeof lineFormId.value === 'string')

function lineFormData() {
  const f = lineForm.value
  const isRevenu = lineFormCategoryType.value === 'revenu'
  return {
    label: f.label,
    plannedAmount: f.plannedAmount === '' ? 0 : parseFloat(f.plannedAmount),
    categoryId: f.categoryId || null,
    themeId: f.themeId || null,
    fromAccountId: isRevenu ? null : sourceAccountId.value,
    toAccountId: (isRevenu || isTransfer.value) ? (f.toAccountId || null) : null,
    paymentMethod: isRevenu ? null : (f.paymentMethod || null),
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
      const isRevenu = lineFormCategoryType.value === 'revenu'
      const { data: line } = await createMonthLine(current.value.id, lineFormData())
      // Montant rempli : l'entrée est créée tout de suite (une seule saisie)
      const amount = parseFloat(f.actualAmount)
      if (amount > 0 && !f.isPot) {
        await createEntry(current.value.id, {
          lineId: line.id,
          amount,
          label: f.entryLabel || null,
          date: f.entryDate,
          themeId: f.themeId || null,
          // Revenu : le compte de l'entrée est celui qui est crédité ; sinon la source (compte ou compte hôte de l'enveloppe)
          accountId: isRevenu ? (f.toAccountId || null) : sourceAccountId.value,
          toAccountId: !isRevenu && isTransfer.value ? (f.toAccountId || null) : null,
          paymentMethod: isRevenu ? null : (f.paymentMethod || null),
          isShared: f.isShared,
          potLineId: f.isShared ? (f.potLineId || null) : null,
          envelopeId: sourceEnvelope.value?.id || null,
          envelopeInTarget: f.envelopeInTarget !== false,
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
  const ok = await confirmDialog({
    title: 'Supprimer la ligne',
    message: n ? `« ${line.label} » et ses ${n} entrée(s) seront supprimées de ce mois.` : `Supprimer la ligne « ${line.label} » de ce mois ?`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteMonthLine(current.value.id, line.id, n > 0)
    closeLineForm()
    await reload()
  } catch (e) { apiError(e) }
}

async function pushToTemplate(line) {
  const ok = await confirmDialog({ title: 'Reporter dans le template', message: `Les valeurs de « ${line.label} » (prévu, comptes, jour, thème…) deviennent le standard : les prochains mois les utiliseront.`, confirmLabel: 'Reporter' })
  if (!ok) return
  try {
    await applyLineToTemplate(current.value.id, line.id)
    closeLineForm()
  } catch (e) { apiError(e) }
}

// ─── Affichage réel / prévu ──────────────────────────────
// Le réel remplace le prévu dès qu'il existe ; la case ☐ n'apparaît que sur une ligne
// avec un prévu et AUCUNE entrée (à sens unique : pour annuler, supprimez les entrées avec ×,
// la case revient alors si le prévu reste).
function overBudget(line) {
  return line.plannedAmount > 0 && line.actualAmount > line.plannedAmount
}
function showCheckbox(line) {
  if (entriesForLine(line).length > 0) return false
  if (line.isPot) return line.pot?.toSend !== 0 // cagnotte : dès qu'il y a quelque chose à régler
  return line.plannedAmount > 0
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
        <div v-for="a in activeAccounts" :key="a.id" class="flex items-center gap-2.5">
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

    <!-- ─── Ligne du mois (modal : ajout et édition) ───── -->
    <AppModal :open="lineModalOpen" :title="lineModalAdding ? 'Nouvelle ligne — ' + (lineFormCategory?.name || '') : 'Modifier « ' + (lineFormLine?.label || '') + ' »'" wide @close="closeLineForm">
      <div class="flex flex-col gap-4">
        <!-- Quoi / combien -->
        <div class="flex flex-wrap gap-3 items-end">
          <label class="field"><span>Libellé</span><input v-model="lineForm.label" type="text" class="input w-44" placeholder="Hôtel Japon, Canva, Cadeau…" @keyup.enter="submitLineForm" /></label>
          <template v-if="!lineForm.isPot">
            <label class="field"><span class="flex items-center gap-1">Prévu (€) <HelpTip text="À venir : la ligne aura une case ☐ à cocher quand ce sera passé (ex. « on me rend 100 € la semaine prochaine »)." /></span><input v-model="lineForm.plannedAmount" type="number" step="0.01" class="input w-24" placeholder="à venir" @keyup.enter="submitLineForm" /></label>
            <label v-if="lineModalAdding" class="field"><span class="flex items-center gap-1">Montant (€) <HelpTip text="Déjà passé : l'entrée est créée tout de suite avec ce montant. Une seule saisie pour une dépense ponctuelle." /></span><input v-model="lineForm.actualAmount" type="number" step="0.01" class="input w-24" placeholder="déjà passé" @keyup.enter="submitLineForm" /></label>
          </template>
          <label v-if="lineModalAdding && !lineForm.isPot" class="field"><span class="flex items-center gap-1">Détail (optionnel) <HelpTip text="Le libellé est le général (« Amazon »), le détail est l'achat précis (« TV »). Une seule entrée → la ligne affiche « Amazon — TV » ; plusieurs → le détail de chacune apparaît en dépliant la ligne. Nécessite un Montant (c'est le détail de l'entrée créée)." /></span><input v-model="lineForm.entryLabel" type="text" class="input w-40" :disabled="!lineForm.actualAmount" :title="lineForm.actualAmount ? '' : 'Renseignez d\'abord un Montant'" placeholder="TV, micro, écouteurs…" @keyup.enter="submitLineForm" /></label>
          <label v-if="lineModalAdding && !lineForm.isPot && lineForm.actualAmount" class="field"><span>Date</span><input v-model="lineForm.entryDate" type="date" class="input w-34" /></label>
          <label v-else class="field" :title="lineForm.isPot ? 'Jour où vous réglez la cagnotte' : 'Date par défaut du « payé »'"><span>Jour du mois</span><input v-model="lineForm.recurringDay" type="number" min="1" max="31" class="input w-20" placeholder="—" /></label>
          <label v-if="!lineModalAdding" class="field"><span>Catégorie</span>
            <select v-model="lineForm.categoryId" class="input w-40">
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <label v-if="themes.length" class="field"><span>Thème</span>
            <select v-model="lineForm.themeId" class="input w-32">
              <option value="">—</option>
              <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
        </div>

        <!-- D'où vient l'argent, où il va (une cagnotte aussi : son règlement est un vrai mouvement) -->
        <div class="flex flex-wrap gap-3 items-end">
          <label v-if="lineFormCategoryType === 'revenu'" class="field"><span>Compte crédité</span>
            <select v-model="lineForm.toAccountId" class="input w-40">
              <option value="">—</option>
              <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <template v-else>
            <label class="field"><span>Depuis</span>
              <select v-model="lineForm.source" class="input w-44">
                <option value="">— aucun</option>
                <optgroup label="Mes comptes">
                  <option v-for="a in activeAccounts" :key="'a' + a.id" :value="'a:' + a.id">{{ a.name }}</option>
                </optgroup>
                <optgroup v-if="lineModalAdding && !lineForm.isPot && envelopes.length" label="Mes enveloppes">
                  <option v-for="env in envelopes" :key="'e' + env.id" :value="'e:' + env.id">{{ env.name }}{{ env.accountName ? ' (' + env.accountName + ')' : '' }}</option>
                </optgroup>
              </select>
            </label>
            <label v-if="sourceEnvelope?.targetAmount && lineForm.actualAmount" class="checkbox self-end" title="La cible affichée est corrigée d'autant : le reste à épargner ne bouge pas"><input v-model="lineForm.envelopeInTarget" type="checkbox" /><span>déduire de l'objectif</span></label>
            <label class="field"><span>Moyen de paiement</span>
              <select v-model="lineForm.paymentMethod" class="input w-32">
                <option v-for="m in settings?.paymentMethods || ['CB']" :key="m" :value="m">{{ m }}</option>
              </select>
            </label>
            <label v-if="isTransfer" class="field" :title="lineFormCategoryType === 'depense' ? 'Provision : l\'argent part vers un de vos comptes (ex. 70 € / mois vers le compte factures)' : 'Compte destination'"><span>Vers</span>
              <select v-model="lineForm.toAccountId" class="input w-44">
                <option value="">{{ lineFormCategoryType === 'depense' ? '— extérieur (quelqu\'un d\'autre)' : '— compte destination' }}</option>
                <option v-for="a in versAccountsLine" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
          </template>
        </div>
        <p v-if="sourceEnvelope" class="text-[11.5px] -mt-2" :class="lineForm.actualAmount ? 'text-gray-400' : 'text-amber-600'">
          <template v-if="lineForm.actualAmount">Pris dans l'enveloppe « {{ sourceEnvelope.name }} »{{ sourceEnvelope.accountName ? ', compte ' + sourceEnvelope.accountName : '' }} — l'enveloppe baisse du montant.</template>
          <template v-else>Renseignez un Montant : c'est l'entrée créée qui sort de l'enveloppe (une ligne seulement prévue n'y touche pas).</template>
        </p>

        <!-- Partage -->
        <div v-if="lineFormCategoryType !== 'revenu'" class="flex flex-wrap gap-3 items-end">
          <label v-if="sharingOn && !lineForm.isPot" class="checkbox" title="Dépense commune (rattachée à une cagnotte)"><input v-model="lineForm.isShared" type="checkbox" /><span>Partagé ½</span></label>
          <select v-if="sharingOn && !lineForm.isPot && lineForm.isShared && pots.length > 1" v-model="lineForm.potLineId" class="input w-40" title="Cagnotte concernée">
            <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.pot?.partnerName }}</option>
          </select>
          <label class="checkbox" title="Partage avec quelqu'un : le prévu de la ligne est calculé à partir des ½"><input v-model="lineForm.isPot" type="checkbox" /><span>Cette ligne est une cagnotte</span></label>
          <template v-if="lineForm.isPot">
            <label class="field"><span>Partenaire</span><input v-model="lineForm.potPartnerName" type="text" class="input w-28" placeholder="Prénom" /></label>
            <label class="field"><span>Il/elle a payé (€)</span><input v-model="lineForm.potPartnerPaid" type="number" step="0.01" class="input w-24" placeholder="0" /></label>
            <label class="field"><span>Ma part (%)</span><input v-model="lineForm.potMyShare" type="number" min="0" max="100" class="input w-16" /></label>
          </template>
        </div>
      </div>
      <p v-if="!lineModalAdding && lineFormLine && entriesForLine(lineFormLine).length" class="text-[11px] text-amber-600 mt-1">
        Cette ligne a {{ entriesForLine(lineFormLine).length }} entrée(s) : modifier le thème, Depuis, le moyen de paiement ou ½ s'applique à toutes.
      </p>
      <template #footer>
        <button class="btn-primary" @click="submitLineForm">{{ lineModalAdding ? 'Ajouter' : 'Sauver' }}</button>
        <button class="btn-secondary" @click="closeLineForm">Annuler</button>
        <template v-if="!lineModalAdding && lineFormLine">
          <button v-if="lineFormLine.templateLineId" class="link text-xs" title="Les prochains mois utiliseront ces valeurs" @click="pushToTemplate(lineFormLine)">Reporter dans le template</button>
          <span v-else class="text-[11px] text-gray-400 self-center">ligne propre à ce mois</span>
          <button class="btn-danger ml-auto" @click="removeLineConfirm(lineFormLine)">Supprimer</button>
        </template>
      </template>
    </AppModal>

    <!-- ─── Entrée (modal : ajout et édition) ─────────── -->
    <AppModal :open="entryModalOpen" :title="(entryModalEntry ? 'Modifier l\'entrée — ' : 'Nouvelle entrée — ') + (entryModalLine?.label || '')" wide @close="closeEntryModal">
      <div v-if="entryModalLine" class="flex flex-col gap-4">
        <div class="flex flex-wrap gap-3 items-end">
          <label class="field"><span>Montant (€)</span><input v-model="entryForm.amount" type="number" step="0.01" class="input w-28" @keyup.enter="submitEntryModal" /></label>
          <label class="field"><span>Date</span><input v-model="entryForm.date" type="date" class="input w-36" /></label>
          <label class="field"><span>Détail</span><input v-model="entryForm.label" type="text" class="input w-48" placeholder="Amazon — écouteurs (optionnel)" @keyup.enter="submitEntryModal" /></label>
          <label v-if="themes.length" class="field"><span>Thème</span>
            <select v-model="entryForm.themeId" class="input w-32">
              <option value="">—</option>
              <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
        </div>

        <div class="flex flex-wrap gap-3 items-end">
          <label v-if="entryLineIsRevenu" class="field"><span>Compte crédité</span>
            <select v-model="entryForm.creditAccountId" class="input w-40">
              <option value="">—</option>
              <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <template v-else>
            <label class="field"><span>Depuis</span>
              <select v-model="entryForm.source" class="input w-44">
                <option value="">— aucun</option>
                <optgroup label="Mes comptes">
                  <option v-for="a in activeAccounts" :key="'a' + a.id" :value="'a:' + a.id">{{ a.name }}</option>
                </optgroup>
                <optgroup v-if="!entryModalLine.isPot && envelopes.length" label="Mes enveloppes">
                  <option v-for="env in envelopes" :key="'e' + env.id" :value="'e:' + env.id">{{ env.name }}{{ env.accountName ? ' (' + env.accountName + ')' : '' }}</option>
                </optgroup>
              </select>
            </label>
            <label v-if="entrySourceEnvelope?.targetAmount" class="checkbox self-end" title="La cible affichée est corrigée d'autant : le reste à épargner ne bouge pas"><input v-model="entryForm.envelopeInTarget" type="checkbox" /><span>déduire de l'objectif</span></label>
            <label class="field"><span>Moyen de paiement</span>
              <select v-model="entryForm.paymentMethod" class="input w-32">
                <option v-for="m in settings?.paymentMethods || ['CB']" :key="m" :value="m">{{ m }}</option>
              </select>
            </label>
            <label v-if="entryIsTransfer" class="field" title="Vers un de vos comptes (provision, virement interne) ou extérieur"><span>Vers</span>
              <select v-model="entryForm.toAccountId" class="input w-44">
                <option value="">— extérieur (quelqu'un d'autre)</option>
                <option v-for="a in versAccountsEntry" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
          </template>
        </div>
        <p v-if="entrySourceEnvelope" class="text-[11.5px] text-gray-400 -mt-2">
          Pris dans l'enveloppe « {{ entrySourceEnvelope.name }} »{{ entrySourceEnvelope.accountName ? ', compte ' + entrySourceEnvelope.accountName : '' }} — l'enveloppe baisse du montant.
        </p>

        <div v-if="sharingOn && !entryLineIsRevenu && !entryModalLine.isPot" class="flex flex-wrap gap-3 items-end">
          <label class="checkbox" title="Dépense commune (rattachée à une cagnotte)"><input v-model="entryForm.isShared" type="checkbox" /><span>Partagé ½</span></label>
          <select v-if="entryForm.isShared && pots.length > 1" v-model="entryForm.potLineId" class="input w-40" title="Cagnotte concernée">
            <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.pot?.partnerName }}</option>
          </select>
        </div>
      </div>
      <template #footer>
        <button class="btn-primary" @click="submitEntryModal">{{ entryModalEntry ? 'Sauver' : 'Ajouter' }}</button>
        <button class="btn-secondary" @click="closeEntryModal">Annuler</button>
        <button v-if="entryModalEntry" class="btn-danger ml-auto" @click="removeEntry(entryModalEntry); closeEntryModal()">Supprimer</button>
      </template>
    </AppModal>

    <!-- ─── Enveloppe insuffisante (☐ payé d'une ligne mensualisée) ── -->
    <AppModal :open="!!shortfall" title="Enveloppe insuffisante" @close="shortfall = null">
      <div v-if="shortfall" class="flex flex-col gap-3 text-[13px]">
        <p>
          L'enveloppe <b>« {{ shortfall.envelopeName }} »</b> contient <b>{{ fmt(shortfall.available) }}</b>
          pour un paiement de <b>{{ fmt(shortfall.amount) }}</b> — il manque <b class="text-amber-600">{{ fmt(shortfall.missing) }}</b>.
        </p>
        <div class="flex flex-wrap gap-3 items-end">
          <label class="field"><span>Le reste est pris sur</span>
            <select v-model="shortfall.accountId" class="input w-44">
              <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
        </div>
        <p class="text-[11.5px] text-gray-400">
          Comme la banque le montre : le paiement de {{ fmt(shortfall.amount) }} depuis {{ accountById(shortfall.line.fromAccountId)?.name || 'le compte principal' }},
          un virement de {{ fmt(shortfall.available) }} depuis l'enveloppe (elle tombe à 0)<template v-if="shortfall.accountId && shortfall.accountId !== (shortfall.line.fromAccountId || accounts.find((a) => a.isMain)?.id)">, et un virement de {{ fmt(shortfall.missing) }} depuis {{ accountById(shortfall.accountId)?.name }}</template>.
          L'échéance avance d'un cycle et la mensualité repart. Supprimer l'entrée (×) annule tout.
        </p>
      </div>
      <template #footer>
        <button class="btn-primary" @click="confirmShortfall">Vider l'enveloppe et prendre le reste</button>
        <button class="btn-secondary" @click="shortfall = null">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Aucun mois ───────────────────────────────── -->
    <div v-if="!current && !monthsList.length && !createFormOpen" class="text-center py-16 text-gray-400">
      <p class="mb-4">Aucun mois pour l'instant.</p>
      <button class="btn-primary" @click="openCreateForm">Créer le premier mois</button>
    </div>

    <!-- ─── Contenu du mois ──────────────────────────── -->
    <div v-if="current">
      <!-- ─── Barre de synthèse (sticky, fond opaque) — §5.3, corrige A1 ── -->
      <div ref="stickySentinel" style="height: 1px"></div>
      <div class="synth" :class="{ 'is-scrolled': scrolled }">
        <div class="synth-hero">
          <span class="num synth-solde" :class="{ 'is-over': (summaryData?.tiles.disponible ?? 0) < 0 }">{{ fmtOrDash(summaryData?.tiles.disponible) }}</span>
          <span class="synth-sub">Solde {{ summaryData?.mainAccount?.name || '—' }}</span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k has-tip" title="Solde estimé si toutes les lignes prévues sont réalisées.">Fin de mois</span>
          <span class="num synth-v" :class="{ 'is-over': (summaryData?.tiles.projete ?? 0) < 0 }">{{ fmtOrDash(summaryData?.tiles.projete) }}</span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k has-tip" title="Ce qu'il reste une fois toutes les dépenses prévues du mois honorées.">Reste à vivre</span>
          <span class="num synth-v" :class="{ 'is-over': (resteAVivre ?? 0) < 0 }">{{ resteAVivre === null ? '—' : fmt(resteAVivre) }}</span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k has-tip" title="Épargne réalisée sur l'objectif du mois.">Épargne du mois</span>
          <span class="num synth-v">{{ fmt(summaryData?.tiles.misDeCote || 0) }} <span class="synth-meta">sur {{ fmt(summaryData?.tiles.objectifEpargne || 0) }}</span></span>
          <span v-if="summaryData?.tiles.objectifEpargne" class="mini-track"><span class="mini-fill" :style="{ width: Math.min(100, objectifPct) + '%' }" /></span>
        </div>
        <div class="synth-right">
          <div class="synth-month">
            <button class="btn-icon" title="Mois précédent" :disabled="!prevMonthTarget" @click="stepMonth(-1)">‹</button>
            <select class="month-select" :value="current?.id" @change="onMonthSelect">
              <option v-for="m in monthsList" :key="m.id" :value="m.id">{{ m.name }}</option>
              <option value="__new">Créer {{ nextPeriodName }}…</option>
            </select>
            <button class="btn-icon" title="Mois suivant" :disabled="!nextMonthTarget" @click="stepMonth(1)">›</button>
            <span class="synth-status"><span class="status-dot" :class="{ 'is-closed': current.isClosed }" />{{ current.isClosed ? 'Mois clôturé' : 'Mois ouvert' }}</span>
          </div>
          <div class="synth-actions">
            <button class="link-accent" @click="showAccounts = !showAccounts">Comptes</button>
            <button class="link-accent" @click="openSnapshots">Soldes d'ouverture</button>
            <button class="btn-secondary" @click="toggleClosed">{{ current.isClosed ? 'Rouvrir le mois' : 'Clôturer le mois' }}</button>
          </div>
        </div>
      </div>

      <!-- Soldes des comptes (panneau sous la synthèse) -->
      <div v-if="showAccounts" class="panel accounts-panel">
        <div class="accounts-grid">
          <div v-for="a in summaryData?.accounts || []" :key="a.accountId" class="account-tile">
            <p class="account-name">{{ a.name }}<span v-if="a.isMain" class="account-star"> ★</span></p>
            <p class="num account-balances"><span class="meta">{{ fmtOrDash(a.start) }}</span><span class="sep"> → </span><span class="ink" :class="{ 'is-over': (a.current ?? 0) < 0 }">{{ fmtOrDash(a.current) }}</span></p>
            <p v-if="a.envelopesTotal" class="account-meta num">
              enveloppes {{ fmt(a.envelopesTotal) }} · hors enveloppes
              <span :class="{ 'is-warn-text': a.unallocated < 0 }" :title="a.unallocated < 0 ? 'Négatif : les enveloppes réservent plus que le solde (découvert autorisé)' : ''">{{ fmtOrDash(a.unallocated) }}</span>
            </p>
          </div>
        </div>
      </div>

      <!-- Soldes d'ouverture (édition) -->
      <div v-if="snapshotsOpen" class="panel accounts-panel">
        <p class="panel-title">Soldes d'ouverture</p>
        <div class="snapshot-form">
          <label v-for="a in activeAccounts" :key="a.id" class="field">
            <span>{{ a.name }}</span>
            <input v-model="snapshotEdits[a.id]" type="number" step="0.01" class="input w-28" :disabled="current.isClosed" placeholder="—" />
          </label>
        </div>
        <button v-if="!current.isClosed" class="btn-primary" @click="saveSnapshots">Enregistrer les soldes</button>
      </div>

      <!-- À faire ce mois (addendum §5) : absent quand il n'y a rien à faire -->
      <div v-if="todoLines.length" class="panel todo-panel">
        <div class="side-head"><span class="side-title">À faire ce mois</span><span class="num side-total">{{ todoLines.length }}</span></div>
        <div v-for="t in todoLines" :key="'todo' + t.line.id" class="reg-grid reg-row" :class="t.kind === 'soon' ? 'is-soon' : 'is-alert'" @click="jumpToLine(t)">
          <span class="cell-point">
            <button
              v-if="showCheckbox(t.line)"
              class="pointbox"
              :disabled="current.isClosed"
              :aria-label="'Pointer ' + (t.line.label || 'la ligne')"
              title="Pointer : crée l'entrée au montant prévu"
              @click.stop="togglePaid(t.line)"
            ></button>
          </span>
          <span class="cell-label">
            <span class="row-label">{{ t.line.label || 'Sans libellé' }}</span>
            <span class="tag" :class="t.kind === 'soon' ? 'tag-neutral' : 'tag-alert'">{{ t.kind === 'send' ? 'à envoyer' : t.kind === 'late' ? 'en retard' : 'échéance proche' }}</span>
            <span class="tag tag-neutral">{{ t.cat.name }}</span>
          </span>
          <span class="num cell-prev">{{ t.due ? shortDate(t.due) : '' }}</span>
          <span class="num cell-real"><span :class="{ 'is-over': t.kind !== 'soon' }">{{ fmt(t.line.isPot && t.line.pot ? Math.abs(t.line.pot.toSend) : t.line.plannedAmount) }}</span></span>
          <span class="cell-actions"></span>
        </div>
      </div>

      <!-- ─── Grille : registre + colonne latérale — §5.1 ── -->
      <div class="month-layout">
        <div class="reg-col">
          <!-- Registre du mois : panneau unique — §5.4, corrige A2/A3 -->
          <div class="panel reg-panel">
            <div class="reg-grid reg-head">
              <span></span><span></span><span class="colh">prévu</span><span class="colh">réel</span><span></span>
            </div>

            <section v-for="group in displayGroups" :key="group.category.id ?? 'none'" :id="'sec-' + (group.category.id ?? 'none')" class="reg-section">
              <!-- En-tête de section — §5.5, enrichi (addendum §2) -->
              <div class="reg-sec-head" @click="toggleCatOpen(group)">
                <div class="reg-grid">
                  <span class="cat-dot" :style="{ background: desat(group.category.color) }" />
                  <span class="reg-sec-main">
                    <span class="reg-sec-title">{{ group.category.name }}</span>
                    <span class="reg-sec-count num">{{ group.lines.length }}</span>
                    <span v-if="isCatOpen(group) && pointableLines(group).length" class="sec-pointed num">{{ pointedCount(group) }}/{{ pointableLines(group).length }} pointées</span>
                    <span v-if="!isCatOpen(group) && group.lines.length" class="sec-preview">{{ sectionPreview(group) }}</span>
                    <span v-if="group.planned > 0 && group.category.type === 'depense'" class="sec-inline-track" :title="Math.round((group.actual / group.planned) * 100) + ' % du prévu consommé'">
                      <span class="sec-inline-fill" :class="barVariant(group)" :style="{ width: Math.min(100, Math.round((group.actual / group.planned) * 100)) + '%' }" />
                    </span>
                  </span>
                  <span class="num reg-sec-prev">{{ group.planned ? fmt(group.planned) : '' }}</span>
                  <span class="num reg-sec-real" :class="{ 'is-credit': group.category.type === 'revenu' && group.actual > 0 }">{{ fmt(group.actual) }}</span>
                  <PhCaretDown :size="14" class="chev" :class="{ 'is-open': isCatOpen(group) }" />
                </div>
              </div>

              <div class="collapse-wrap" :class="{ 'collapse-wrap--open': isCatOpen(group) }">
              <div class="min-h-0 overflow-hidden">
                <!-- Ligne budgétaire — §5.6 -->
                <div v-for="line in group.lines" :key="line.id" class="reg-rowwrap">
                  <div class="reg-grid reg-row" :class="{ 'is-alert': rowAlert(line) }" @click="toggleEntries(line)">
                    <span class="cell-point">
                      <button
                        v-if="showCheckbox(line)"
                        class="pointbox"
                        :disabled="current.isClosed"
                        :aria-label="'Pointer ' + (line.label || 'la ligne')"
                        title="Pointer : crée l'entrée au montant prévu (annulation : supprimer l'entrée)"
                        @click.stop="togglePaid(line)"
                      ></button>
                      <span v-else-if="isPaid(line)" class="pointbox is-checked"><PhCheck :size="12" weight="bold" /></span>
                    </span>
                    <span class="cell-label">
                      <span class="row-label" :class="{ 'is-pointed': isPaid(line), 'is-empty': !line.label }">{{ line.label || 'Sans libellé' }}<span v-if="singleEntryDetail(line)" class="row-detail"> — {{ singleEntryDetail(line) }}</span></span>
                      <span v-if="line.isPot && line.pot && line.pot.toSend !== 0 && !isPaid(line)" class="tag tag-alert">{{ line.pot.toSend > 0 ? 'à envoyer · ' + (line.pot.partnerName || '') : (line.pot.partnerName || '') + ' vous doit' }}</span>
                      <span v-else-if="line.isPot" class="tag tag-neutral">cagnotte</span>
                      <span v-if="sharingOn && line.isShared && !line.isPot" class="tag tag-info" title="Dépense partagée : 50 % à votre charge.">½ partagé</span>
                      <span v-if="line.recurringDay && !isPaid(line)" class="tag tag-neutral num">le {{ line.recurringDay }}</span>
                      <template v-if="themesForLine(line).length">
                        <span class="tag tag-neutral"><span class="tag-dot" :style="{ background: themesForLine(line)[0].color }" />{{ themesForLine(line)[0].name }}</span>
                        <span v-if="themesForLine(line).length > 1" class="tag tag-neutral" :title="themesForLine(line).map((t) => t.name).join(', ')">+{{ themesForLine(line).length - 1 }}</span>
                      </template>
                    </span>
                    <span class="num cell-prev">{{ line.isPot ? '' : (line.plannedAmount ? fmt(line.plannedAmount) : '—') }}</span>
                    <span class="num cell-real">
                      <template v-if="line.isPot && !isPaid(line) && line.pot">
                        <span :class="line.pot.toSend > 0 ? 'is-over' : 'is-credit'">{{ fmt(Math.abs(line.pot.toSend)) }}</span>
                      </template>
                      <template v-else-if="isPaid(line)">
                        <span :class="{ 'is-over': overBudget(line), 'is-credit': lineCategoryType(line) === 'revenu' }">{{ fmt(line.actualAmount) }}</span>
                      </template>
                      <span v-else class="cell-dash">—</span>
                    </span>
                    <span class="cell-actions">
                      <button v-if="!current.isClosed" class="btn-icon row-action" title="Modifier la ligne" @click.stop="openEditLine(line)">✎</button>
                    </span>
                  </div>

                  <!-- Entrées (niveau 3) — §5.7 -->
                  <div v-if="openEntriesLineId === line.id" class="entries-block">
                    <div v-if="line.isPot && line.pot" class="pot-detail">
                      <span>Payé par moi en commun (½)</span><span class="num">{{ fmt(line.pot.sharedByMe) }}</span>
                      <span>Payé par {{ line.pot.partnerName }}</span><span class="num">{{ fmt(line.pot.partnerPaid) }}</span>
                      <span>Total commun</span><span class="num">{{ fmt(line.pot.total) }}</span>
                      <span>Ma part ({{ line.pot.myShare }} %)</span><span class="num">{{ fmt(line.pot.myPart) }}</span>
                      <span class="strong">{{ potStatus(line) }}</span><span class="num strong" :class="line.pot.toSend > 0 ? 'is-over' : 'is-credit'">{{ fmt(Math.abs(line.pot.toSend)) }}</span>
                    </div>
                    <div v-for="e in entriesForLine(line)" :key="e.id" class="entry-row">
                      <span class="entry-date num">{{ shortDate(e.date) }}</span>
                      <span class="entry-label">{{ e.label || '' }}
                        <span v-if="e.source === 'paye'" class="tag tag-neutral">pointé</span>
                        <span v-if="e.envelopeId && envelopeById(e.envelopeId)" class="tag tag-info" :title="e.envelopeInTarget ? 'Compte dans l\'objectif' : 'Hors objectif'">depuis {{ envelopeById(e.envelopeId).name }}</span>
                        <span v-if="sharingOn && e.isShared" class="tag tag-info">½ partagé</span>
                      </span>
                      <span class="entry-amount num">{{ fmt(e.amount) }}</span>
                      <span class="entry-account">{{ accountById(e.accountId)?.name || '' }}<template v-if="accountById(e.toAccountId)"> → {{ accountById(e.toAccountId).name }}</template></span>
                      <span class="entry-actions">
                        <button v-if="!current.isClosed" class="btn-icon" title="Modifier l'entrée" @click.stop="openEditEntry(line, e)">✎</button>
                        <button v-if="!current.isClosed" class="btn-icon is-danger" title="Supprimer l'entrée" @click.stop="removeEntry(e)">×</button>
                      </span>
                    </div>
                    <p v-if="!entriesForLine(line).length" class="entries-empty">Aucune entrée.</p>
                    <div v-for="t in transfersForLine(line)" :key="'t' + t.id" class="entry-row is-transfer">
                      <span class="entry-date num">{{ shortDate(t.date) }}</span>
                      <span class="entry-label"><span class="tag tag-neutral">virement</span>{{ t.label }}</span>
                      <span class="entry-amount num">{{ fmt(t.amount) }}</span>
                      <span class="entry-account"></span>
                      <span class="entry-actions"><button v-if="!current.isClosed" class="btn-icon is-danger" title="Supprimer ce virement (le mouvement entre comptes est annulé)" @click.stop="removeEntry(t)">×</button></span>
                    </div>
                    <button v-if="!current.isClosed" class="btn-discret" @click.stop="openAddEntry(line)"><PhPlus :size="12" weight="bold" /> Ajouter une entrée</button>
                  </div>
                </div>

                <div v-if="!group.lines.length" class="reg-empty">Aucune ligne dans {{ group.category.name }}.</div>
                <button v-if="!current.isClosed" class="btn-addline" @click="openAddLine(group.category)"><PhPlus :size="13" weight="bold" /> Ajouter une ligne budgétaire</button>
              </div>
              </div>
            </section>

            <!-- Ligne de totaux (addendum §3) — dépenses uniquement, un total mêlant
                 revenus et dépenses n'aurait pas de sens -->
            <div class="reg-grid reg-total">
              <span></span>
              <span class="reg-total-label">Total dépenses du mois</span>
              <span class="num reg-total-prev">{{ fmt(plannedDepenses) }}</span>
              <span class="reg-total-realwrap">
                <span class="num reg-total-real">{{ fmt(totalDepenses) }}</span>
                <span class="num reg-total-rest" :class="{ 'is-over': plannedDepenses - totalDepenses < 0 }">reste {{ fmt(plannedDepenses - totalDepenses) }}</span>
              </span>
              <span></span>
            </div>
          </div>

          <!-- Relevés du mois (calculateurs) -->
          <div v-if="calculators.length" class="panel calc-panel">
            <div class="reg-sec-head" @click="calcOpen = !calcOpen">
              <div class="calc-head">
                <span class="reg-sec-title">Relevés du mois</span>
                <span class="reg-sec-count num">{{ calculators.length }}</span>
                <PhCaretDown :size="14" class="chev" :class="{ 'is-open': calcOpen }" />
              </div>
            </div>
            <div class="collapse-wrap" :class="{ 'collapse-wrap--open': calcOpen }">
            <div class="min-h-0 overflow-hidden">
              <div v-for="calc in calculators" :key="calc.id" class="calc-row">
                <span class="calc-name">{{ calc.name }}</span>
                <div v-for="r in calc.readings" :key="r.defId" class="calc-reading">
                  <label class="field">
                    <span>{{ r.label || r.symbol }}<span v-if="r.unit" class="meta"> · {{ r.unit }}</span></span>
                    <span class="calc-inputs">
                      <template v-if="r.kind === 'index'">
                        <input v-model="r.previous" type="number" step="any" class="input w-24 is-prev" :disabled="current.isClosed" title="Index de début (reporté du mois précédent)" @change="saveReadings(calc)" />
                        <span class="sep">→</span>
                      </template>
                      <input v-model="r.current" type="number" step="any" class="input w-24" :disabled="current.isClosed" :title="r.kind === 'index' ? 'Index de fin' : 'Valeur du mois'" @change="saveReadings(calc)" />
                    </span>
                  </label>
                  <span v-if="r.kind === 'index' && r.consumption !== null" class="num calc-conso">= {{ fmtNum(r.consumption) }}</span>
                </div>
                <div class="calc-result">
                  <span v-if="calc.error" class="calc-error">{{ calc.error }}</span>
                  <template v-else>
                    <span class="calc-cell"><span class="num strong">{{ calc.estimate === null ? '—' : fmt(calc.estimate) }}</span><span class="meta">estimé</span></span>
                    <template v-if="calc.line">
                      <span class="calc-cell"><span class="num">{{ fmt(calc.line.planned) }}</span><span class="meta">{{ calc.line.label }}</span></span>
                      <span class="calc-cell"><span class="num" :class="calc.gap === null ? '' : calc.gap > 0 ? 'is-over' : 'is-credit'">{{ calc.gap === null ? '—' : (calc.gap > 0 ? '+' : '') + fmt(calc.gap) }}</span><span class="meta">écart</span></span>
                      <button
                        v-if="!current.isClosed && calc.gap !== null && Math.abs(calc.gap) >= 0.01 && Math.abs((calc.line.regularisation || 0) - calc.gap) >= 0.01"
                        class="btn-secondary"
                        :title="calc.line.regularisation ? 'Régularisation déjà posée : ' + fmt(calc.line.regularisation) : ''"
                        @click="regularize(calc)"
                      >{{ calc.line.regularisation ? 'Mettre à jour' : 'Régulariser' }}</button>
                      <span v-else-if="calc.line.regularisation" class="calc-ok">Régularisé</span>
                    </template>
                  </template>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>

        <!-- ─── Colonne latérale : Enveloppes & Investissements — §5.11 ── -->
        <aside class="month-aside">
          <div v-if="envelopes.length" class="panel side-panel">
            <div class="side-head"><span class="side-title">Enveloppes</span><span class="num side-total">{{ fmt(monthContribTotal) }}</span></div>
            <div v-for="env in envelopes" :key="env.id" class="side-item" @click="toggleEnvelope(env)">
              <div class="side-row1">
                <button
                  v-if="env.monthlySuggestion > 0 && !current.isClosed && !contribsForEnvelope(env).some((c) => c.kind === 'normale')"
                  class="pointbox pointbox-sm"
                  :aria-label="'Verser la mensualité de ' + env.name"
                  :title="'Verser la mensualité suggérée : ' + fmt(env.monthlySuggestion)"
                  @click.stop="contributeSuggested(env)"
                ></button>
                <span v-else-if="contribsForEnvelope(env).some((c) => c.kind === 'normale')" class="pointbox pointbox-sm is-checked"><PhCheck :size="10" weight="bold" /></span>
                <span class="side-name">{{ env.name }}</span>
                <span class="num side-amounts"><span class="ink">{{ fmt(env.total) }}</span><span v-if="env.targetAmount" class="meta"> / {{ fmt(env.effectiveTarget) }}</span></span>
              </div>
              <div v-if="env.targetAmount" class="goal-bar"><div class="goal-fill" :style="{ width: Math.min(100, envelopePct(env) || 0) + '%' }" /></div>
              <div class="side-meta">
                <span v-if="env.accountName">{{ env.accountName }}</span><span v-if="env.monthlySuggestion" class="num"> · {{ fmt(env.monthlySuggestion) }}/mois</span>
                <span v-if="contribsForEnvelope(env).length" class="tag tag-credit num">{{ contribsForEnvelope(env).reduce((s, c) => s + c.amount, 0) >= 0 ? '+' : '' }}{{ fmt(contribsForEnvelope(env).reduce((s, c) => s + c.amount, 0)) }} ce mois</span>
                <span v-if="env.targetAmount" class="side-rest num">reste {{ fmt(Math.max(0, Math.round((env.effectiveTarget - env.total) * 100) / 100)) }}</span>
              </div>
              <div v-if="openEnvelopeId === env.id" class="side-expand" @click.stop>
                <div v-for="c in contribsForEnvelope(env)" :key="c.id" class="entry-row">
                  <span class="entry-date num">{{ shortDate(c.date) }}</span>
                  <span class="entry-label">{{ c.kind !== 'normale' ? c.kind : (c.notes || '') }}</span>
                  <span class="entry-amount num" :class="c.amount >= 0 ? 'is-credit' : 'is-over'">{{ fmt(c.amount) }}</span>
                  <span class="entry-account">{{ c.fromAccountName || '' }}</span>
                  <span class="entry-actions"><button v-if="!current.isClosed" class="btn-icon is-danger" title="Supprimer la contribution" @click.stop="deleteContribution(c)">×</button></span>
                </div>
                <p v-if="!contribsForEnvelope(env).length" class="entries-empty">Aucune contribution ce mois.</p>
                <div v-if="!current.isClosed" class="side-form">
                  <input v-model="contribForm.amount" type="number" step="0.01" class="input w-20" :placeholder="env.monthlySuggestion ? String(env.monthlySuggestion) : 'Montant'" @keyup.enter="submitContribution(env)" />
                  <input v-model="contribForm.date" type="date" class="input w-32" />
                  <select v-model="contribForm.fromAccountId" class="input flex-1" title="Compte source">
                    <option value="">— depuis</option>
                    <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                  </select>
                  <button class="btn-secondary" @click="submitContribution(env)">Ajouter</button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="assets.length" class="panel side-panel">
            <div class="side-head"><span class="side-title">Investissements</span><span class="num side-total">{{ fmt(monthInvestedTotal) }}</span></div>
            <div v-for="asset in assets" :key="asset.id" class="side-item" @click="toggleAsset(asset)">
              <div class="side-row1">
                <button
                  v-if="asset.monthlyDca > 0 && !movementsForAsset(asset).length && !current.isClosed"
                  class="pointbox pointbox-sm"
                  :aria-label="'Verser le DCA de ' + asset.name"
                  title="Marquer le versement mensuel comme fait (annulation : supprimer le mouvement)"
                  @click.stop="toggleDca(asset)"
                ></button>
                <span v-else-if="movementsForAsset(asset).length" class="pointbox pointbox-sm is-checked"><PhCheck :size="10" weight="bold" /></span>
                <span class="side-name">{{ asset.name }}</span>
                <span v-if="asset.type" class="tag tag-neutral">{{ asset.type }}</span>
                <span class="num side-amounts">
                  <span class="ink">{{ fmt(movementsForAsset(asset).length ? movementsForAsset(asset).reduce((s, m) => s + (m.kind === 'versement' ? m.amount : -m.amount), 0) : asset.monthlyDca) }}</span>
                  <span v-if="!movementsForAsset(asset).length && asset.monthlyDca" class="meta"> prévu</span>
                </span>
              </div>
              <div class="side-meta"><span v-if="asset.accountName">{{ asset.accountName }}</span></div>
              <div v-if="openAssetId === asset.id" class="side-expand" @click.stop>
                <div v-for="m in movementsForAsset(asset)" :key="m.id" class="entry-row">
                  <span class="entry-date num">{{ shortDate(m.date) }}</span>
                  <span class="entry-label"><span v-if="m.source === 'dca'" class="tag tag-info">DCA</span></span>
                  <span class="entry-amount num" :class="m.kind === 'versement' ? 'is-credit' : 'is-over'">{{ m.kind === 'retrait' ? '−' : '+' }}{{ fmt(m.amount) }}</span>
                  <span class="entry-account">{{ m.kind === 'versement' ? (m.counterpartAccountName || '?') + ' → ' + (asset.accountName || asset.name) : (asset.accountName || asset.name) + ' → ' + (m.counterpartAccountName || '?') }}</span>
                  <span class="entry-actions"><button v-if="!current.isClosed" class="btn-icon is-danger" title="Supprimer le mouvement" @click.stop="deleteAssetMovement(m)">×</button></span>
                </div>
                <p v-if="!movementsForAsset(asset).length" class="entries-empty">Aucun mouvement ce mois.</p>
                <div v-if="!current.isClosed" class="side-form">
                  <select v-model="assetMovementForm.kind" class="input w-24">
                    <option value="versement">Versement</option>
                    <option value="retrait">Retrait</option>
                  </select>
                  <input v-model="assetMovementForm.amount" type="number" step="0.01" class="input w-20" placeholder="Montant" @keyup.enter="submitAssetMovement(asset)" />
                  <input v-model="assetMovementForm.date" type="date" class="input w-32" />
                  <select v-model="assetMovementForm.counterpartAccountId" class="input flex-1" :title="assetMovementForm.kind === 'versement' ? 'Compte source' : 'Compte destination'">
                    <option value="">— compte</option>
                    <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                  </select>
                  <button class="btn-secondary" @click="submitAssetMovement(asset)">Ajouter</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Note du mois : texte libre, enregistrée au blur (aussi sur un mois clôturé) -->
          <div class="panel side-panel notes-panel">
            <div class="side-head">
              <span class="side-title">Notes</span>
              <span v-if="notesSaved" class="notes-saved">Enregistré</span>
            </div>
            <textarea
              v-model="monthNotes"
              class="notes-area"
              rows="4"
              :placeholder="'Une note pour ' + (current.name || 'ce mois') + '…'"
              @blur="saveNotes"
            ></textarea>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/style.css";

/* ─── Panneaux & utilitaires ─── */
.panel { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--r-container); }
.panel-title { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); margin-bottom: var(--s-3); }
.meta { color: var(--c-ink-3); font-weight: 400; }
.ink { color: var(--c-ink); }
.is-over { color: var(--c-over); }
.is-credit { color: var(--c-credit); }
.is-warn-text { color: var(--c-warn); font-weight: 600; }
.strong { font-weight: 600; color: var(--c-ink); }

/* ─── Barre de synthèse (sticky opaque) ─── */
.synth {
  position: sticky; top: 0; z-index: 30;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-container);
  padding: var(--s-4) var(--s-5);
  display: flex; align-items: center; gap: var(--s-5);
  margin-bottom: var(--s-5);
}
.synth.is-scrolled { box-shadow: var(--shadow-sticky); border-radius: 0 0 var(--r-container) var(--r-container); }
.synth-hero { display: flex; flex-direction: column; line-height: var(--lh-tight); }
.synth-solde { font-size: var(--t-hero); font-weight: 600; color: var(--c-ink); }
.synth-solde.is-over { color: var(--c-over); }
.synth-sub { font-size: var(--t-meta); color: var(--c-ink-3); margin-top: 2px; }
.synth-sep { width: 1px; align-self: stretch; background: var(--c-line); }
.synth-kv { display: flex; flex-direction: column; gap: 2px; line-height: var(--lh-tight); }
.synth-k { font-size: var(--t-small); color: var(--c-ink-3); }
.has-tip { text-decoration: underline dotted var(--c-ink-3); text-underline-offset: 3px; cursor: help; }
.synth-v { font-size: var(--t-amount); color: var(--c-ink); }
.synth-meta { font-size: var(--t-small); color: var(--c-ink-3); font-weight: 400; }
.mini-track { width: 64px; height: 4px; border-radius: var(--r-pill); background: var(--c-track); overflow: hidden; }
.mini-fill { display: block; height: 100%; background: var(--c-fill-goal); transition: width var(--dur-base) var(--ease); }
.synth-right { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: var(--s-2); }
.synth-month { display: flex; align-items: center; gap: var(--s-1); }
.month-select {
  font-size: 15px; font-weight: 600; color: var(--c-ink);
  background: transparent; border: none; outline: none; cursor: pointer;
  padding: 2px var(--s-1); border-radius: var(--r-control);
}
.month-select:hover { background: var(--c-surface-hover); }
.synth-status { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-small); color: var(--c-ink-2); margin-left: var(--s-3); }
.status-dot { width: 6px; height: 6px; border-radius: var(--r-pill); background: var(--c-credit); }
.status-dot.is-closed { background: var(--c-ink-disabled); }
.synth-actions { display: flex; align-items: center; gap: var(--s-4); }

/* ─── Soldes des comptes ─── */
.accounts-panel { padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.accounts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3); }
.account-tile { background: var(--c-surface-sunken); border-radius: var(--r-control); padding: var(--s-3) var(--s-4); }
.account-name { font-size: var(--t-small); font-weight: 600; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.account-star { color: var(--c-accent); }
.account-balances { font-size: var(--t-small); }
.account-balances .sep { color: var(--c-ink-disabled); }
.account-meta { font-size: var(--t-meta); color: var(--c-ink-3); }
.snapshot-form { display: flex; flex-wrap: wrap; gap: var(--s-4); margin-bottom: var(--s-4); }

/* ─── Grille de page ─── */
.month-layout { display: grid; grid-template-columns: minmax(0, 1fr) var(--w-aside); gap: var(--s-7); align-items: start; }
.reg-col { min-width: 0; display: flex; flex-direction: column; gap: var(--s-5); }
.month-aside { display: flex; flex-direction: column; gap: var(--s-5); position: sticky; top: calc(var(--h-summary) + var(--s-5) + 16px); }
@media (max-width: 1119px) {
  .month-layout { grid-template-columns: 1fr; }
  .month-aside { position: static; }
}

/* ─── Registre ─── */
.reg-panel { overflow: hidden; }
.reg-grid {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 92px 112px 32px;
  align-items: center;
  gap: var(--s-3);
  padding-inline: var(--s-5);
  min-height: var(--h-row);
}
.reg-head { min-height: 30px; border-bottom: 1px solid var(--c-line); background: var(--c-surface-sunken); border-radius: var(--r-container) var(--r-container) 0 0; }
.colh { font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); text-align: right; }
.reg-section + .reg-section { border-top: 1px solid var(--c-line-strong); }
.reg-section { scroll-margin-top: calc(var(--h-summary) + 24px); }
.reg-sec-main { display: flex; align-items: center; gap: var(--s-3); min-width: 0; }
.sec-pointed { font-size: var(--t-small); color: var(--c-ink-3); flex-shrink: 0; }
.sec-preview { font-size: var(--t-small); color: var(--c-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.sec-inline-track { margin-left: auto; width: 160px; height: 4px; border-radius: var(--r-pill); background: var(--c-track); overflow: hidden; flex-shrink: 0; }
.sec-inline-fill { display: block; height: 100%; background: var(--c-fill); transition: width var(--dur-base) var(--ease); }
.sec-inline-fill.is-warn { background: var(--c-fill-warn); }
.sec-inline-fill.is-over { background: var(--c-fill-over); }

/* Ligne de totaux (sticky en pied de registre) */
.reg-total { position: sticky; bottom: 0; background: var(--c-surface-sunken); border-top: 1px solid var(--c-line-strong); min-height: 44px; border-radius: 0 0 var(--r-container) var(--r-container); }
.reg-total-label { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); }
.reg-total-prev { font-size: var(--t-amount); font-weight: 600; color: var(--c-ink-3); text-align: right; }
.reg-total-realwrap { display: flex; flex-direction: column; align-items: flex-end; line-height: var(--lh-tight); }
.reg-total-real { font-size: var(--t-amount); font-weight: 600; color: var(--c-ink); }
.reg-total-rest { font-size: var(--t-small); color: var(--c-ink-3); }

/* À faire ce mois */
.todo-panel { margin-bottom: var(--s-5); overflow: hidden; }
.todo-panel .reg-row:last-child { border-bottom: none; }
.reg-row.is-soon::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--c-warn); }
.reg-sec-head { position: relative; background: var(--c-surface-sunken); cursor: pointer; user-select: none; }
.reg-sec-head:hover { background: var(--c-surface-hover); }
.reg-sec-head .reg-grid { min-height: 48px; }
.cat-dot { width: 8px; height: 8px; border-radius: var(--r-pill); justify-self: center; }
.reg-sec-title { font-size: var(--t-section); font-weight: 600; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.reg-sec-count { font-size: var(--t-small); font-weight: 400; color: var(--c-ink-3); margin-left: var(--s-2); }
.reg-sec-prev { font-size: var(--t-small); color: var(--c-ink-3); text-align: right; }
.reg-sec-real { font-size: var(--t-section-n); font-weight: 600; color: var(--c-ink); text-align: right; }
.chev { color: var(--c-ink-3); justify-self: center; transition: transform var(--dur-fast) var(--ease); transform: rotate(-90deg); }
.chev.is-open { transform: rotate(0deg); }
.sec-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--c-track); }
.sec-fill { height: 100%; background: var(--c-fill); transition: width var(--dur-base) var(--ease); }
.sec-fill.is-warn { background: var(--c-fill-warn); }
.sec-fill.is-over { background: var(--c-fill-over); box-shadow: inset -2px 0 0 var(--c-over); }

.reg-row { border-bottom: 1px solid var(--c-line); cursor: pointer; transition: background-color var(--dur-fast) var(--ease); position: relative; }
.reg-rowwrap:last-of-type .reg-row { border-bottom: none; }
.reg-row:hover { background: var(--c-surface-hover); }
.reg-row.is-alert::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--c-over); }
.cell-point { display: flex; justify-content: center; }
.cell-label { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.row-label { font-size: var(--t-body); font-weight: 500; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row-label.is-pointed { color: var(--c-ink-3); }
.row-label.is-empty { color: var(--c-ink-3); font-style: italic; }
.row-detail { color: var(--c-ink-3); font-weight: 400; }
.cell-prev { font-size: var(--t-small); color: var(--c-ink-3); text-align: right; }
.cell-real { font-size: var(--t-amount); color: var(--c-ink); text-align: right; }
.cell-dash { color: var(--c-ink-disabled); }
.cell-actions { display: flex; justify-content: center; }
.row-action { opacity: 0; }
.reg-row:hover .row-action, .row-action:focus-visible { opacity: 1; }

/* Case de pointage — §5.10 */
.pointbox {
  width: 18px; height: 18px;
  border: 1.5px solid var(--c-line-strong);
  border-radius: 4px;
  background: var(--c-surface);
  cursor: pointer;
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  color: transparent;
  transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.pointbox::after { content: ''; position: absolute; inset: -11px -5px; }
.pointbox:hover:not(:disabled) { border-color: var(--c-accent); }
.pointbox:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); }
.pointbox:disabled { opacity: 0.4; cursor: default; }
.pointbox.is-checked { background: var(--c-accent); border-color: var(--c-accent); color: var(--c-on-accent); cursor: default; }
.pointbox-sm { width: 15px; height: 15px; }

/* Entrées (niveau 3) */
.entries-block {
  margin: var(--s-1) var(--s-5) var(--s-3) calc(28px + var(--s-5));
  background: var(--c-surface-sunken);
  border-radius: var(--r-control);
  padding: var(--s-2) var(--s-4);
  animation: reg-in var(--dur-base) var(--ease);
}
.entry-row { display: grid; grid-template-columns: 52px minmax(0, 1fr) 92px minmax(0, 160px) 52px; gap: var(--s-3); align-items: center; min-height: 32px; }
.entry-row.is-transfer .entry-label { color: var(--c-ink-3); }
.entry-date { font-size: var(--t-small); color: var(--c-ink-3); }
.entry-label { font-size: var(--t-small); color: var(--c-ink-2); display: flex; align-items: center; gap: var(--s-2); min-width: 0; white-space: nowrap; overflow: hidden; }
.entry-amount { font-size: var(--t-small); color: var(--c-ink); text-align: right; }
.entry-account { font-size: var(--t-meta); color: var(--c-ink-3); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry-actions { display: flex; justify-content: flex-end; gap: 2px; }
.entries-empty { font-size: var(--t-small); color: var(--c-ink-3); padding: var(--s-2) 0; }
.pot-detail { display: grid; grid-template-columns: auto auto; justify-content: start; column-gap: var(--s-7); row-gap: 2px; font-size: var(--t-small); color: var(--c-ink-2); padding: var(--s-2) 0 var(--s-3); border-bottom: 1px solid var(--c-line); margin-bottom: var(--s-2); }
.pot-detail .num { text-align: right; }

/* États vides & ajout */
.reg-empty { font-size: 13px; color: var(--c-ink-2); text-align: center; padding: var(--s-7) 0 var(--s-3); }
.btn-addline {
  display: flex; align-items: center; justify-content: center; gap: var(--s-2);
  width: calc(100% - var(--s-5) * 2);
  margin: var(--s-3) var(--s-5);
  height: 36px;
  border: 1px dashed var(--c-line-strong);
  border-radius: var(--r-control);
  color: var(--c-ink-3);
  font-size: var(--t-small); font-weight: 500;
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
.btn-addline:hover { color: var(--c-accent); border-color: var(--c-accent); }
.btn-discret {
  display: inline-flex; align-items: center; gap: var(--s-1);
  color: var(--c-accent); font-size: var(--t-small); font-weight: 500;
  padding: var(--s-2) 0; cursor: pointer;
}
.btn-discret:hover { color: var(--c-accent-hover); }

/* Tags — §5.9 */
.tag {
  display: inline-flex; align-items: center; gap: var(--s-1);
  height: 20px; padding: 0 var(--s-3);
  border-radius: var(--r-control);
  font-size: var(--t-tag); font-weight: 500;
  white-space: nowrap; flex-shrink: 0;
}
.tag-neutral { background: var(--c-surface-sunken); color: var(--c-ink-2); border: 1px solid var(--c-line); }
.tag-info { background: var(--c-accent-soft); color: var(--c-accent); }
.tag-credit { background: var(--c-credit-soft); color: var(--c-credit); }
.tag-alert { background: var(--c-over-soft); color: var(--c-over); }
.tag-dot { width: 6px; height: 6px; border-radius: var(--r-pill); }

/* Repli animé */
.collapse-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-base) var(--ease); }
.collapse-wrap--open { grid-template-rows: 1fr; }
@keyframes reg-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* ─── Relevés du mois ─── */
.calc-head { display: flex; align-items: center; gap: var(--s-2); min-height: 48px; padding-inline: var(--s-5); }
.calc-head .chev { margin-left: auto; }
.calc-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--s-5); padding: var(--s-4) var(--s-5); border-top: 1px solid var(--c-line); }
.calc-name { font-size: var(--t-body); font-weight: 500; color: var(--c-ink); width: 110px; flex-shrink: 0; align-self: center; }
.calc-reading { display: flex; align-items: flex-end; gap: var(--s-2); }
.calc-inputs { display: flex; align-items: center; gap: var(--s-1); }
.calc-inputs .is-prev { color: var(--c-ink-3); }
.calc-inputs .sep { color: var(--c-ink-disabled); font-size: var(--t-small); }
.calc-conso { font-size: var(--t-meta); color: var(--c-ink-3); padding-bottom: 8px; }
.calc-result { margin-left: auto; display: flex; align-items: center; gap: var(--s-5); align-self: center; }
.calc-cell { display: flex; flex-direction: column; align-items: flex-end; line-height: var(--lh-tight); }
.calc-cell .meta { font-size: var(--t-meta); max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.calc-error { font-size: var(--t-small); color: var(--c-over); }
.calc-ok { font-size: var(--t-meta); color: var(--c-credit); }

/* ─── Colonne latérale ─── */
.side-panel { overflow: hidden; }
.side-head { display: flex; align-items: baseline; justify-content: space-between; padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-line); }
.side-title { font-size: 13px; font-weight: 600; color: var(--c-ink); }
.side-total { font-size: 13px; color: var(--c-ink-2); }
.side-item { padding: var(--s-3) var(--s-5); cursor: pointer; }
.side-item + .side-item { border-top: 1px solid var(--c-line); }

/* Note du mois : se lit comme du texte, devient un champ au focus */
.notes-panel { padding: 0 var(--s-3) var(--s-3); }
.notes-panel .side-head { margin: 0 calc(-1 * var(--s-3)) var(--s-2); }
.notes-saved { font-size: var(--t-meta); color: var(--c-ink-3); }
.notes-area {
  width: 100%; resize: vertical; min-height: 72px;
  font-family: var(--font-ui); font-size: 13px; line-height: var(--lh-body); color: var(--c-ink);
  background: transparent; border: 1px solid transparent; border-radius: var(--r-control);
  padding: var(--s-2) var(--s-3); outline: none;
  transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.notes-area:hover { border-color: var(--c-line-strong); }
.notes-area:focus { border-color: var(--c-accent); background: var(--c-surface); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.notes-area::placeholder { color: var(--c-ink-3); }
.side-item:hover { background: var(--c-surface-hover); }
.side-row1 { display: flex; align-items: center; gap: var(--s-2); }
.side-name { font-size: var(--t-body); font-weight: 500; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.side-amounts { margin-left: auto; font-size: 13px; white-space: nowrap; }
.goal-bar { height: 4px; border-radius: var(--r-pill); background: var(--c-track); overflow: hidden; margin-top: var(--s-2); }
.goal-fill { height: 100%; background: var(--c-fill-goal); transition: width var(--dur-base) var(--ease); }
.side-meta { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-meta); color: var(--c-ink-3); margin-top: var(--s-1); flex-wrap: wrap; }
.side-rest { margin-left: auto; }
.side-expand { margin-top: var(--s-3); background: var(--c-surface-sunken); border-radius: var(--r-control); padding: var(--s-2) var(--s-3); cursor: default; animation: reg-in var(--dur-base) var(--ease); }
.side-expand .entry-row { grid-template-columns: 48px minmax(0, 1fr) 76px minmax(0, 90px) 26px; }
.side-form { display: flex; align-items: center; gap: var(--s-2); margin-top: var(--s-2); flex-wrap: wrap; }

/* ─── Boutons & champs — §5.12 ─── */
.btn-primary {
  height: 34px; padding: 0 var(--s-5);
  background: var(--c-accent); color: var(--c-on-accent);
  border-radius: var(--r-control);
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}
.btn-primary:hover { background: var(--c-accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  height: 30px; padding: 0 var(--s-4);
  background: var(--c-surface);
  border: 1px solid var(--c-line-strong);
  border-radius: var(--r-control);
  color: var(--c-ink);
  font-size: var(--t-small); font-weight: 500;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}
.btn-secondary:hover { background: var(--c-surface-hover); }
.btn-danger {
  height: 30px; padding: 0 var(--s-4);
  background: var(--c-surface);
  border: 1px solid var(--c-over);
  border-radius: var(--r-control);
  color: var(--c-over);
  font-size: var(--t-small); font-weight: 500;
  cursor: pointer;
}
.btn-danger:hover { background: var(--c-over-soft); }
.btn-icon {
  width: 26px; height: 26px;
  border-radius: var(--r-control);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--c-ink-3); font-size: 13px;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}
.btn-icon:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.btn-icon.is-danger:hover { background: var(--c-over-soft); color: var(--c-over); }
.btn-icon:disabled { opacity: 0.4; cursor: default; }
.link-accent { color: var(--c-accent); font-size: var(--t-small); font-weight: 500; cursor: pointer; }
.link-accent:hover { color: var(--c-accent-hover); text-decoration: underline; }
.link { color: var(--c-accent); font-size: var(--t-small); cursor: pointer; }
.link:hover { text-decoration: underline; }

.field { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); }
.input {
  padding: 6px var(--s-3);
  border: 1px solid var(--c-line-strong);
  border-radius: var(--r-control);
  font-size: 13px; color: var(--c-ink);
  background: var(--c-surface);
  outline: none;
  font-family: var(--font-ui);
}
.input:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.input:disabled { opacity: 0.5; }
.checkbox { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-small); color: var(--c-ink-2); cursor: pointer; }
.badge {
  display: inline-flex; align-items: center;
  font-size: var(--t-meta); font-weight: 500;
  padding: 1px var(--s-3);
  border-radius: var(--r-control);
  background: var(--c-surface-sunken); color: var(--c-ink-2);
  border: 1px solid var(--c-line);
  flex-shrink: 0;
}

/* Focus visible partout */
button:focus-visible, select:focus-visible, a:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--c-accent-ring);
  border-radius: var(--r-control);
}
</style>
