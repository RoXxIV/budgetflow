<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  getAssets, createAsset, updateAsset, deleteAsset,
  getAssetMovements, addAssetMovement, removeAssetMovement,
  getAssetValuations, addAssetValuation, removeAssetValuation,
} from '@/api/assets.js'
import { getAccounts } from '@/api/accounts.js'
import { getSettings } from '@/api/settings.js'
import AppModal from '@/components/AppModal.vue'
import HelpTip from '@/components/HelpTip.vue'
import LineChart from '@/components/LineChart.vue'
import { confirmDialog, apiError } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

// ─── Data ────────────────────────────────────────────────
const assets = ref([])
const accounts = ref([])
const settings = ref(null)

async function load() {
  const [aRes, accRes, sRes] = await Promise.all([getAssets(), getAccounts(), getSettings()])
  assets.value = aRes.data
  accounts.value = accRes.data
  settings.value = sRes.data
  await loadHistory()
}
onMounted(load)

// ─── Formats (brief §1 A3/A4 : virgule, vrai moins U+2212, espace fine avant %) ───
const fmt = eur
const fmtOrDash = (n) => (n === null || n === undefined ? '—' : fmt(n))
const fmtPct = (n) => (n === null || n === undefined ? '—'
  : (n < 0 ? '−' : '+') + Math.abs(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %')
const signedEur = (n) => (n === null || n === undefined ? '—' : (n < 0 ? '−' : '+') + fmt(Math.abs(n)))
const gainClass = (n) => (n === null || n === undefined ? 'meta' : n >= 0 ? 'is-credit' : 'is-over')
// « 1er sept. 2026 » — jamais d'ISO à l'écran
const frDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return (d.getDate() === 1 ? '1er' : d.getDate()) + ' ' + d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}
// Tags de classe : « Crypto » (les capitales sont proscrites), sauf les sigles (ETF, PEA…)
const SIGLES = new Set(['ETF', 'PEA', 'SCPI', 'PER', 'CTO'])
const typeLabel = (t) => (!t ? '' : SIGLES.has(t.toUpperCase()) ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())

const types = computed(() => settings.value?.investmentTypes || [])
const activeAccounts = computed(() => accounts.value.filter((a) => a.isActive)) // saisies : comptes actifs seulement
const openAssets = computed(() => assets.value.filter((a) => !a.isClosed))
const closedAssets = computed(() => assets.value.filter((a) => a.isClosed))
// Registre trié par valeur décroissante, les non valorisés en dernier
const sortedAssets = computed(() => [...openAssets.value].sort((a, b) => (b.value ?? -1) - (a.value ?? -1)))

// ─── Totaux ──────────────────────────────────────────────
const totals = computed(() => {
  const list = openAssets.value
  const invested = list.reduce((s, a) => s + a.invested, 0)
  const withdrawn = list.reduce((s, a) => s + a.withdrawn, 0)
  const valued = list.filter((a) => a.value !== null)
  const value = valued.reduce((s, a) => s + a.value, 0)
  const investedValued = valued.reduce((s, a) => s + a.invested, 0)
  const withdrawnValued = valued.reduce((s, a) => s + a.withdrawn, 0)
  const gain = valued.length ? value + withdrawnValued - investedValued : null
  return {
    invested, withdrawn, value: valued.length ? value : null, gain,
    gainPct: gain !== null && investedValued > 0 ? (gain / investedValued) * 100 : null,
    monthlyDca: list.reduce((s, a) => s + (a.monthlyDca || 0), 0),
  }
})
// Poids d'un actif dans la valeur totale (colonne poids, brief §4)
const weightPct = (a) => (a.value === null || !totals.value.value ? null : (a.value / totals.value.value) * 100)

// Date de la dernière valorisation du portefeuille ; > 30 jours → à mettre à jour (brief §3)
const latestValuationDate = computed(() => {
  const dates = openAssets.value.map((a) => a.valuationDate).filter(Boolean)
  return dates.length ? dates.sort()[dates.length - 1] : null
})
const valuationStale = computed(() => {
  if (!latestValuationDate.value) return false
  return (Date.now() - new Date(latestValuationDate.value + 'T00:00:00').getTime()) / 86400000 > 30
})

// ─── Répartition (brief §5a) : un segment par actif au prorata de la valeur ───
const repartition = computed(() => {
  const valued = sortedAssets.value.filter((a) => a.value !== null && a.value > 0)
  const total = valued.reduce((s, a) => s + a.value, 0)
  if (!total || valued.length < 2) return []
  return valued.map((a, i) => ({
    id: a.id, name: a.name,
    pct: (a.value / total) * 100,
    opacity: Math.max(0.3, 1 - i * 0.24), // nuances d'une même encre, pas de palette
  }))
})

// ─── Évolution (brief §5b) : valorisations mensuelles vs investi cumulé ───
const history = ref(null) // { labels, valeur[], investi[] } — null si < 3 mois de valorisations
async function loadHistory() {
  const list = assets.value.filter((a) => !a.isClosed)
  if (!list.length) { history.value = null; return }
  try {
    const [valsRes, movsRes] = await Promise.all([
      Promise.all(list.map((a) => getAssetValuations(a.id))),
      Promise.all(list.map((a) => getAssetMovements(a.id))),
    ])
    const vals = valsRes.map((r) => [...r.data].sort((x, y) => x.date.localeCompare(y.date)))
    const movs = movsRes.flatMap((r) => r.data)
    const months = [...new Set(vals.flat().map((v) => v.date.slice(0, 7)))].sort()
    if (months.length < 3) { history.value = null; return }
    const labels = months.map((m) => {
      const [y, mo] = m.split('-').map(Number)
      return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    })
    // Valeur du mois = dernière valorisation connue de chaque actif à cette date
    const valeur = months.map((m) => {
      let sum = 0, any = false
      for (const list of vals) {
        let last = null
        for (const v of list) { if (v.date.slice(0, 7) <= m) last = v; else break }
        if (last) { sum += last.value; any = true }
      }
      return any ? Math.round(sum * 100) / 100 : null
    })
    const investi = months.map((m) => Math.round(movs.reduce(
      (s, mv) => (mv.date.slice(0, 7) <= m ? s + (mv.kind === 'retrait' ? -mv.amount : mv.amount) : s), 0) * 100) / 100)
    history.value = { labels, valeur, investi }
  } catch { history.value = null }
}
const chartSeries = computed(() => (history.value ? [
  { key: 'valeur', name: 'Valeur', color: 'var(--c-ink)', points: history.value.valeur },
  { key: 'investi', name: 'Investi', color: 'var(--c-ink-3)', dash: true, points: history.value.investi },
] : []))

// ─── Mettre à jour : valorisation groupée, un champ par actif (brief §3) ───
const updateOpen = ref(false)
const updateForm = ref({ date: '', values: {} })
function openBulkUpdate() {
  updateForm.value = { date: today(), values: Object.fromEntries(openAssets.value.map((a) => [a.id, ''])) }
  updateOpen.value = true
}
async function submitBulkUpdate() {
  const f = updateForm.value
  const entries = Object.entries(f.values).filter(([, v]) => v !== '' && v !== null)
  if (!entries.length) { updateOpen.value = false; return }
  try {
    for (const [id, v] of entries) await addAssetValuation(Number(id), { value: parseFloat(v), date: f.date || null })
    updateOpen.value = false
    await load()
  } catch (e) { apiError(e) }
}

// ─── Formulaire actif ────────────────────────────────────
const formOpen = ref(false)
const editingId = ref(null)
const form = ref({})

function openAdd() {
  editingId.value = null
  form.value = { name: '', type: types.value[0] || '', accountId: accounts.value.find((a) => a.type === 'investissement')?.id || '', monthlyDca: '' }
  formOpen.value = true
}
function openEdit(asset) {
  editingId.value = asset.id
  form.value = { name: asset.name, type: asset.type || '', accountId: asset.accountId || '', monthlyDca: asset.monthlyDca || '' }
  formOpen.value = true
}
async function submit() {
  const f = form.value
  if (!f.name.trim()) return
  const data = { name: f.name, type: f.type || null, accountId: f.accountId || null, monthlyDca: f.monthlyDca === '' ? 0 : parseFloat(f.monthlyDca) }
  try {
    if (editingId.value) await updateAsset(editingId.value, data)
    else await createAsset(data)
    formOpen.value = false
    await load()
  } catch (e) { apiError(e) }
}
async function toggleClosed(asset) {
  try { await updateAsset(asset.id, { isClosed: !asset.isClosed }); await load() } catch (e) { apiError(e) }
}
async function removeConfirm(asset) {
  const ok = await confirmDialog({ title: "Supprimer l'actif", message: `Supprimer « ${asset.name} » ? (impossible s'il a des mouvements : clôturez-le pour garder l'historique)`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try { await deleteAsset(asset.id); await load() } catch (e) { apiError(e) }
}

// ─── Menu ⋯ par ligne ────────────────────────────────────
const menuAssetId = ref(null)

// ─── Panneau déplié : valorisation, mouvements ───────────
const openId = ref(null)
const movements = ref([])
const valuations = ref([])
const valuationForm = ref({ value: '', date: '' })
const movementForm = ref({ kind: 'versement', amount: '', date: '', counterpartAccountId: '', notes: '' })
const today = () => new Date().toISOString().substring(0, 10)

async function togglePanel(asset) {
  if (openId.value === asset.id) { openId.value = null; return }
  await openPanel(asset)
}
async function openPanel(asset) {
  openId.value = asset.id
  valuationForm.value = { value: asset.value ?? '', date: today() }
  movementForm.value = { kind: 'versement', amount: '', date: today(), counterpartAccountId: accounts.value.find((a) => a.isMain)?.id || '', notes: '' }
  await refreshPanel(asset)
}
async function refreshPanel(asset) {
  const [mRes, vRes] = await Promise.all([getAssetMovements(asset.id), getAssetValuations(asset.id)])
  movements.value = mRes.data
  valuations.value = vRes.data
}
async function submitValuation(asset) {
  if (valuationForm.value.value === '') return
  try {
    await addAssetValuation(asset.id, { value: parseFloat(valuationForm.value.value), date: valuationForm.value.date || null })
    await load(); await refreshPanel(asset)
  } catch (e) { apiError(e) }
}
async function deleteValuation(asset, v) {
  try { await removeAssetValuation(asset.id, v.id); await load(); await refreshPanel(asset) } catch (e) { apiError(e) }
}
async function submitMovement(asset) {
  const f = movementForm.value
  if (!f.amount) return
  try {
    await addAssetMovement(asset.id, { kind: f.kind, amount: parseFloat(f.amount), date: f.date || null, counterpartAccountId: f.counterpartAccountId || null, notes: f.notes || null })
    movementForm.value = { ...f, amount: '', notes: '' }
    await load(); await refreshPanel(asset)
  } catch (e) { apiError(e) }
}
async function deleteMovement(asset, m) {
  try { await removeAssetMovement(asset.id, m.id); await load(); await refreshPanel(asset) } catch (e) { apiError(e) }
}
</script>

<template>
  <div @click="menuAssetId = null">
    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold">Investissements</h1>
        <p class="page-sub">Actifs, versements, valorisation</p>
      </div>
      <div class="flex gap-2">
        <button v-if="openAssets.length" class="btn-secondary" @click="openBulkUpdate">Mettre à jour</button>
        <button class="btn-primary" @click="openAdd">+ Actif</button>
      </div>
    </div>

    <!-- ─── Bandeau : la valeur actuelle en héros — brief §3 ── -->
    <div v-if="openAssets.length" class="panel bandeau">
      <div class="bandeau-row">
        <div class="synth-hero">
          <span class="num synth-solde">{{ fmtOrDash(totals.value) }}</span>
          <span class="synth-sub">
            Valeur actuelle<template v-if="latestValuationDate"> · <span :class="{ 'is-warn': valuationStale }">au {{ frDate(latestValuationDate) }}</span></template>
            <span v-if="valuationStale" class="tag tag-warn">à mettre à jour</span>
          </span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k">Investi<template v-if="totals.withdrawn"> · retiré {{ fmt(totals.withdrawn) }}</template></span>
          <span class="num synth-v">{{ fmt(totals.invested) }}</span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k has-tip" title="(valeur + retiré − investi) / investi. Avec des versements réguliers, ce pourcentage est dilué par les versements récents : c'est un écart comptable, pas une performance annualisée.">Écart</span>
          <span class="num synth-v" :class="gainClass(totals.gain)">{{ signedEur(totals.gain) }}</span>
          <span class="num synth-v2" :class="gainClass(totals.gainPct)">{{ fmtPct(totals.gainPct) }}</span>
        </div>
        <div class="synth-sep" />
        <RouterLink to="/mois" class="synth-kv synth-link" title="Les versements se pointent dans la section Investissements de la page Mois">
          <span class="synth-k">Versements / mois</span>
          <span class="num synth-v">{{ fmt(totals.monthlyDca) }}</span>
        </RouterLink>
      </div>
      <!-- Répartition : barre empilée au prorata de la valeur — brief §5a -->
      <div v-if="repartition.length" class="repart">
        <div class="repart-bar">
          <span v-for="seg in repartition" :key="seg.id" class="repart-seg" :style="{ width: seg.pct + '%', opacity: seg.opacity }" />
        </div>
        <div class="repart-legend">
          <span v-for="seg in repartition" :key="'l' + seg.id" class="repart-item">
            <span class="repart-dot" :style="{ opacity: seg.opacity }" />{{ seg.name }} <span class="num meta">{{ Math.round(seg.pct) }}&#8239;%</span>
          </span>
        </div>
      </div>
    </div>

    <!-- ─── Formulaire actif ─────────────────────────── -->
    <AppModal :open="formOpen" :title="editingId ? 'Modifier l\'actif' : 'Nouvel actif'" @close="formOpen = false">
      <div class="flex flex-wrap gap-4 items-end">
        <label class="field"><span>Nom</span><input v-model="form.name" type="text" class="input w-44" placeholder="MSCI World, BTC…" @keyup.enter="submit" /></label>
        <label class="field"><span>Type</span>
          <select v-model="form.type" class="input w-32">
            <option value="">—</option>
            <option v-for="t in types" :key="t" :value="t">{{ typeLabel(t) }}</option>
          </select>
        </label>
        <label class="field"><span>Compte hôte</span>
          <select v-model="form.accountId" class="input w-40">
            <option value="">—</option>
            <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
      </div>
      <div class="mt-3">
        <p class="field-title">
          Mettre en place un DCA (optionnel)
          <HelpTip wide text="DCA (versement programmé) : la même somme investie chaque mois. Indiquez un montant : le mois affichera un ☐ versé qui pose le versement en un clic, et le projeté en tient compte. Laissez vide pour un actif sans versement récurrent." />
        </p>
        <label class="field"><span>Versement mensuel prévu (€)</span><input v-model="form.monthlyDca" type="number" step="0.01" class="input w-28" placeholder="0" /></label>
      </div>
      <template #footer>
        <button class="btn-primary" @click="submit">{{ editingId ? 'Sauver' : 'Créer' }}</button>
        <button class="btn-secondary" @click="formOpen = false">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Mettre à jour : valorisation groupée — brief §3 ── -->
    <AppModal :open="updateOpen" title="Mettre à jour les valorisations" @close="updateOpen = false">
      <div class="flex flex-col gap-3">
        <label class="field w-40"><span>Date</span><input v-model="updateForm.date" type="date" class="input" /></label>
        <div v-for="asset in openAssets" :key="asset.id" class="bulk-row">
          <span class="bulk-name">{{ asset.name }}</span>
          <span class="num meta bulk-current">{{ asset.value === null ? 'jamais valorisé' : fmt(asset.value) + (asset.valuationDate ? ' au ' + frDate(asset.valuationDate) : '') }}</span>
          <input v-model="updateForm.values[asset.id]" type="number" step="0.01" class="input w-32" :placeholder="asset.value === null ? 'Valeur' : String(asset.value)" @keyup.enter="submitBulkUpdate" />
        </div>
        <p class="meta text-[11.5px]">Seuls les champs remplis sont enregistrés ; l'historique des valorisations est conservé.</p>
      </div>
      <template #footer>
        <button class="btn-primary" @click="submitBulkUpdate">Enregistrer</button>
        <button class="btn-secondary" @click="updateOpen = false">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Aucun actif — brief §6 : pas de bandeau à zéros ── -->
    <div v-if="!assets.length && !formOpen" class="panel empty-panel">
      <p>Aucun actif suivi pour l'instant.</p>
      <button class="btn-primary" @click="openAdd">Ajouter un actif</button>
    </div>

    <!-- ─── Registre des actifs — brief §4 ───────────── -->
    <div v-if="assets.length" class="panel inv-panel">
      <div class="inv-grid inv-head">
        <span></span>
        <span class="colh is-left">support</span>
        <span class="colh">/ mois</span>
        <span class="colh">investi</span>
        <span class="colh">valeur<template v-if="latestValuationDate"><br /><span :class="{ 'is-warn': valuationStale }">au {{ frDate(latestValuationDate) }}</span></template></span>
        <span class="colh">écart</span>
        <span class="colh">poids</span>
        <span></span>
      </div>

      <div v-for="asset in sortedAssets" :key="asset.id" class="inv-rowwrap">
        <div class="inv-grid inv-row" @click="togglePanel(asset)">
          <span class="cell-label">
            <span v-if="asset.type" class="tag tag-neutral">{{ typeLabel(asset.type) }}</span>
            <span class="row-label" :title="asset.name">{{ asset.name }}</span>
            <span v-if="asset.value === null" class="tag tag-alert">à valoriser</span>
            <span class="cell-support-inline meta">{{ asset.accountName || '' }}</span>
          </span>
          <span class="cell-support">{{ asset.accountName || '—' }}</span>
          <span class="num cell-n" :class="{ meta: !asset.monthlyDca }">{{ asset.monthlyDca ? fmt(asset.monthlyDca) : '—' }}</span>
          <span class="num cell-n" :title="asset.withdrawn ? 'retiré ' + fmt(asset.withdrawn) : ''">{{ fmt(asset.invested) }}</span>
          <span class="num cell-n" :class="{ meta: asset.value === null }" :title="asset.valuationDate ? 'valorisé au ' + frDate(asset.valuationDate) : ''">{{ fmtOrDash(asset.value) }}</span>
          <span class="cell-gain">
            <span class="num" :class="gainClass(asset.gain)">{{ asset.gain === null ? '' : signedEur(asset.gain) }}</span>
            <span class="num cell-gain-pct" :class="gainClass(asset.gainPct)">{{ asset.gainPct === null ? '' : fmtPct(asset.gainPct) }}</span>
          </span>
          <span class="cell-weight">
            <template v-if="weightPct(asset) !== null">
              <span class="num">{{ Math.round(weightPct(asset)) }}&#8239;%</span>
              <span class="weight-bar"><span class="weight-fill" :style="{ width: weightPct(asset) + '%' }" /></span>
            </template>
          </span>
          <span class="cell-actions" @click.stop>
            <button class="btn-icon row-action" title="Modifier" @click="openEdit(asset)">✎</button>
            <span class="menu-wrap">
              <button class="btn-icon" title="Actions" @click="menuAssetId = menuAssetId === asset.id ? null : asset.id">⋯</button>
              <div v-if="menuAssetId === asset.id" class="menu">
                <button class="menu-item" @click="menuAssetId = null; openPanel(asset)">Mettre à jour la valorisation</button>
                <button class="menu-item" @click="menuAssetId = null; openEdit(asset)">Modifier</button>
                <button class="menu-item" @click="menuAssetId = null; toggleClosed(asset)">Clôturer</button>
                <div class="menu-sep" />
                <button class="menu-item is-danger" @click="menuAssetId = null; removeConfirm(asset)">Supprimer</button>
              </div>
            </span>
          </span>
        </div>

        <!-- Panneau déplié : historique de valorisation + mouvements -->
        <div v-if="openId === asset.id" class="inv-expand" @click.stop>
          <div class="inv-expand-cols">
            <div>
              <p class="expand-title">Valeur actuelle <span class="meta">— saisie à la main, historique conservé</span></p>
              <div class="expand-form">
                <input v-model="valuationForm.value" type="number" step="0.01" class="input w-28" placeholder="Valeur" @keyup.enter="submitValuation(asset)" />
                <input v-model="valuationForm.date" type="date" class="input w-36" />
                <button class="btn-secondary" @click="submitValuation(asset)">Enregistrer</button>
              </div>
              <div v-for="v in valuations.slice(0, 6)" :key="v.id" class="entry-row">
                <span class="entry-date num">{{ frDate(v.date) }}</span>
                <span class="entry-amount num ink">{{ fmt(v.value) }}</span>
                <span class="entry-actions"><button class="btn-icon is-danger" title="Supprimer la valorisation" @click="deleteValuation(asset, v)">×</button></span>
              </div>
            </div>
            <div>
              <p class="expand-title">Mouvements <span class="meta">— versement (compte → actif) ou retrait (actif → compte)</span></p>
              <div class="expand-form">
                <select v-model="movementForm.kind" class="input w-28">
                  <option value="versement">Versement</option>
                  <option value="retrait">Retrait</option>
                </select>
                <input v-model="movementForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="submitMovement(asset)" />
                <input v-model="movementForm.date" type="date" class="input w-36" />
                <select v-model="movementForm.counterpartAccountId" class="input w-28" :title="movementForm.kind === 'versement' ? 'Compte source' : 'Compte destination'">
                  <option value="">— compte</option>
                  <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
                </select>
                <button class="btn-secondary" @click="submitMovement(asset)">Ajouter</button>
              </div>
              <div v-for="m in movements.slice(0, 8)" :key="m.id" class="entry-row is-movement">
                <span class="entry-date num">{{ frDate(m.date) }}</span>
                <span class="entry-amount num" :class="m.kind === 'versement' ? 'is-credit' : 'is-over'">{{ m.kind === 'retrait' ? '−' : '+' }}{{ fmt(m.amount) }}</span>
                <span v-if="m.source === 'dca'" class="tag tag-neutral">DCA</span>
                <span class="entry-label">{{ m.kind === 'versement' ? (m.counterpartAccountName || '?') + ' → ' + (asset.accountName || 'actif') : (asset.accountName || 'actif') + ' → ' + (m.counterpartAccountName || '?') }}</span>
                <span class="entry-actions"><button class="btn-icon is-danger" title="Supprimer le mouvement" @click="deleteMovement(asset, m)">×</button></span>
              </div>
              <p v-if="!movements.length" class="entries-empty">Aucun mouvement.</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Ligne de total — brief §4 -->
      <div v-if="sortedAssets.length" class="inv-grid inv-total">
        <span class="total-label">Total</span>
        <span></span>
        <span class="num cell-n">{{ fmt(totals.monthlyDca) }}</span>
        <span class="num cell-n">{{ fmt(totals.invested) }}</span>
        <span class="num cell-n">{{ fmtOrDash(totals.value) }}</span>
        <span class="cell-gain">
          <span class="num" :class="gainClass(totals.gain)">{{ totals.gain === null ? '—' : signedEur(totals.gain) }}</span>
          <span class="num cell-gain-pct" :class="gainClass(totals.gainPct)">{{ totals.gainPct === null ? '' : fmtPct(totals.gainPct) }}</span>
        </span>
        <span class="cell-weight"><span v-if="totals.value" class="num">100&#8239;%</span></span>
        <span></span>
      </div>

      <!-- Actifs clôturés : historique conservé, réouvrables -->
      <section v-if="closedAssets.length" class="inv-closed">
        <div class="inv-grid inv-sec-head">
          <span class="reg-sec-title meta">Actifs clôturés <span class="reg-sec-count num">{{ closedAssets.length }}</span></span>
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <div v-for="asset in closedAssets" :key="asset.id" class="inv-grid inv-row is-closed">
          <span class="cell-label">
            <span v-if="asset.type" class="tag tag-neutral">{{ typeLabel(asset.type) }}</span>
            <span class="row-label meta">{{ asset.name }}</span>
            <span class="tag tag-neutral">clôturé</span>
          </span>
          <span class="cell-support meta">{{ asset.accountName || '—' }}</span>
          <span></span>
          <span class="num cell-n meta">{{ fmt(asset.invested) }}</span>
          <span></span><span></span><span></span>
          <span class="cell-actions" @click.stop>
            <button class="link-accent" @click="toggleClosed(asset)">Rouvrir</button>
            <button class="btn-icon is-danger row-action" title="Supprimer définitivement (seulement sans mouvement)" @click="removeConfirm(asset)">×</button>
          </span>
        </div>
      </section>
    </div>

    <!-- ─── Évolution de la valeur — brief §5b ───────── -->
    <div v-if="openAssets.length" class="panel evo-panel">
      <div class="evo-head">
        <span class="reg-sec-title">Évolution</span>
        <span v-if="history" class="evo-legend">
          <span class="evo-item"><span class="evo-line" /> Valeur</span>
          <span class="evo-item"><span class="evo-line is-dashed" /> Investi</span>
        </span>
      </div>
      <LineChart v-if="history" :labels="history.labels" :series="chartSeries" :height="200" minimal-axis />
      <p v-else class="evo-empty">L'évolution s'affichera après trois valorisations mensuelles.</p>
    </div>
  </div>
</template>

<style scoped>
/* ─── Page ─── */
.page-sub { font-size: 13px; color: var(--c-ink-2); margin-top: 2px; }
.panel { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--r-container); }
.meta { color: var(--c-ink-3); font-weight: 400; }
.ink { color: var(--c-ink); }
.is-over { color: var(--c-over); }
.is-credit { color: var(--c-credit); }
.is-warn { color: var(--c-warn); }

/* ─── Bandeau ─── */
.bandeau { padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.bandeau-row { display: flex; align-items: center; gap: var(--s-6); }
.synth-hero { display: flex; flex-direction: column; line-height: var(--lh-tight); }
.synth-solde { font-size: var(--t-hero); font-weight: 600; color: var(--c-ink); }
.synth-sub { font-size: var(--t-meta); color: var(--c-ink-3); margin-top: 2px; display: flex; align-items: center; gap: var(--s-2); }
.has-tip { text-decoration: underline dotted var(--c-ink-3); text-underline-offset: 3px; cursor: help; }
.synth-sep { width: 1px; align-self: stretch; background: var(--c-line); }
.synth-kv { display: flex; flex-direction: column; gap: 2px; line-height: var(--lh-tight); }
.synth-k { font-size: var(--t-small); color: var(--c-ink-3); }
.synth-v { font-size: var(--t-amount); color: var(--c-ink); }
.synth-v2 { font-size: var(--t-small); }
.synth-link { border-radius: var(--r-control); text-decoration: none; }
.synth-link:hover .synth-k { color: var(--c-accent); text-decoration: underline; }

/* ─── Répartition ─── */
.repart { margin-top: var(--s-4); border-top: 1px solid var(--c-line); padding-top: var(--s-4); }
.repart-bar { display: flex; height: 10px; border-radius: var(--r-pill); overflow: hidden; background: var(--c-track); }
.repart-seg { display: block; background: var(--c-fill); }
.repart-seg + .repart-seg { border-left: 2px solid var(--c-surface); }
.repart-legend { display: flex; flex-wrap: wrap; gap: var(--s-5); margin-top: var(--s-2); font-size: var(--t-small); color: var(--c-ink-2); }
.repart-item { display: inline-flex; align-items: center; gap: var(--s-2); }
.repart-dot { width: 8px; height: 8px; border-radius: var(--r-pill); background: var(--c-fill); flex-shrink: 0; }

/* ─── Registre des actifs ─── */
.inv-panel { overflow: visible; margin-bottom: var(--s-5); }
.inv-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px 92px 110px 110px 110px 64px 64px;
  align-items: center;
  gap: var(--s-3);
  padding-inline: var(--s-5);
}
.inv-head { min-height: 34px; padding-block: var(--s-2); border-bottom: 1px solid var(--c-line); background: var(--c-surface-sunken); border-radius: var(--r-container) var(--r-container) 0 0; }
.colh { font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); text-align: right; line-height: 1.3; }
.colh.is-left { text-align: left; }

.inv-row { min-height: 48px; border-bottom: 1px solid var(--c-line); cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.inv-row:hover { background: var(--c-surface-hover); }
.cell-label { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.row-label { font-size: var(--t-body); font-weight: 500; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-support { font-size: 13px; color: var(--c-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-support-inline { display: none; font-size: var(--t-meta); }
.cell-n { font-size: var(--t-body); color: var(--c-ink); text-align: right; }
.cell-gain { display: flex; flex-direction: column; align-items: flex-end; line-height: var(--lh-tight); gap: 1px; }
.cell-gain .num { font-size: var(--t-body); }
.cell-gain-pct { font-size: var(--t-small); }
.cell-weight { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; font-size: var(--t-small); color: var(--c-ink-2); }
.weight-bar { width: 48px; height: 3px; border-radius: var(--r-pill); background: var(--c-track); overflow: hidden; }
.weight-fill { display: block; height: 100%; background: var(--c-fill); }
.cell-actions { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.row-action { opacity: 0; }
.inv-row:hover .row-action, .row-action:focus-visible { opacity: 1; }

.inv-total { min-height: var(--h-row); background: var(--c-surface-sunken); border-top: 1px solid var(--c-line-strong); border-radius: 0 0 var(--r-container) var(--r-container); }
.inv-rowwrap:last-of-type .inv-row { border-bottom: none; }
.total-label { font-size: var(--t-body); font-weight: 600; color: var(--c-ink); }
.inv-total .cell-n, .inv-total .cell-gain .num { font-weight: 600; }

.inv-closed { border-top: 1px solid var(--c-line-strong); }
.inv-sec-head { min-height: 40px; background: var(--c-surface-sunken); }
.reg-sec-title { font-size: var(--t-section); font-weight: 600; color: var(--c-ink); }
.reg-sec-count { font-size: var(--t-small); font-weight: 400; color: var(--c-ink-3); margin-left: var(--s-2); }
.inv-row.is-closed { cursor: default; }
.inv-row.is-closed:hover { background: none; }

/* Menu ⋯ */
.menu-wrap { position: relative; }
.menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 40;
  min-width: 230px;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-container);
  box-shadow: var(--shadow-overlay);
  padding: var(--s-2);
}
.menu-item {
  display: block; width: 100%; text-align: left;
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-control);
  font-size: 13px; color: var(--c-ink);
  cursor: pointer;
}
.menu-item:hover { background: var(--c-surface-hover); }
.menu-item.is-danger { color: var(--c-over); }
.menu-item.is-danger:hover { background: var(--c-over-soft); }
.menu-sep { height: 1px; background: var(--c-line); margin: var(--s-2) 0; }

/* ─── Panneau déplié ─── */
.inv-expand {
  margin: var(--s-1) var(--s-5) var(--s-3);
  background: var(--c-surface-sunken);
  border-radius: var(--r-control);
  padding: var(--s-3) var(--s-4);
  animation: reg-in var(--dur-base) var(--ease);
  cursor: default;
}
.inv-expand-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-6); }
.expand-title { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); margin-bottom: var(--s-2); }
.expand-form { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; margin-bottom: var(--s-2); }
.entry-row { display: flex; align-items: center; gap: var(--s-3); min-height: 28px; }
.entry-date { font-size: var(--t-small); color: var(--c-ink-3); width: 96px; flex-shrink: 0; }
.entry-amount { font-size: var(--t-small); }
.entry-label { font-size: var(--t-meta); color: var(--c-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry-actions { margin-left: auto; }
.entries-empty { font-size: var(--t-small); color: var(--c-ink-3); padding: var(--s-2) 0; }

/* ─── Évolution ─── */
.evo-panel { padding: var(--s-4) var(--s-5); }
.evo-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-3); }
.evo-legend { display: flex; gap: var(--s-5); font-size: var(--t-small); color: var(--c-ink-2); }
.evo-item { display: inline-flex; align-items: center; gap: var(--s-2); }
.evo-line { width: 16px; height: 0; border-top: 2px solid var(--c-ink); }
.evo-line.is-dashed { border-top-style: dashed; border-top-color: var(--c-ink-3); }
.evo-empty { font-size: 13px; color: var(--c-ink-3); padding: var(--s-4) 0; }

/* ─── États vides ─── */
.empty-panel { text-align: center; padding: var(--s-8); font-size: 13px; color: var(--c-ink-2); display: flex; flex-direction: column; align-items: center; gap: var(--s-4); }

/* ─── Modale valorisation groupée ─── */
.bulk-row { display: flex; align-items: center; gap: var(--s-4); }
.bulk-name { font-size: 13px; font-weight: 500; color: var(--c-ink); width: 130px; flex-shrink: 0; }
.bulk-current { font-size: var(--t-small); flex: 1; }
.field-title { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); margin-bottom: var(--s-2); display: flex; align-items: center; gap: var(--s-2); }

/* ─── Tags ─── */
.tag {
  display: inline-flex; align-items: center; gap: var(--s-1);
  height: 20px; padding: 0 var(--s-3);
  border-radius: var(--r-control);
  font-size: var(--t-tag); font-weight: 500;
  white-space: nowrap; flex-shrink: 0;
}
.tag-neutral { background: var(--c-surface-sunken); color: var(--c-ink-2); border: 1px solid var(--c-line); }
.tag-alert { background: var(--c-over-soft); color: var(--c-over); }
.tag-warn { background: var(--c-warn-soft); color: var(--c-warn); }

/* ─── Boutons, liens, champs (partagés avec les modales) ─── */
.btn-primary { height: 34px; padding: 0 var(--s-5); background: var(--c-accent); color: #fff; border-radius: var(--r-control); font-size: 13px; font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-primary:hover { background: var(--c-accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { height: 30px; padding: 0 var(--s-4); background: var(--c-surface); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); color: var(--c-ink); font-size: var(--t-small); font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-secondary:hover { background: var(--c-surface-hover); }
.btn-icon { width: 26px; height: 26px; border-radius: var(--r-control); display: inline-flex; align-items: center; justify-content: center; color: var(--c-ink-3); font-size: 13px; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-icon:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.btn-icon.is-danger:hover { background: var(--c-over-soft); color: var(--c-over); }
.link-accent { color: var(--c-accent); font-size: var(--t-small); font-weight: 500; cursor: pointer; }
.link-accent:hover { color: var(--c-accent-hover); text-decoration: underline; }
.field { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); }
.input { padding: 6px var(--s-3); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); font-size: 13px; color: var(--c-ink); background: var(--c-surface); outline: none; font-family: var(--font-ui); }
.input:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }

@keyframes reg-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

button:focus-visible, select:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); border-radius: var(--r-control); }

/* ─── Responsive — brief §8 ─── */
@media (max-width: 1119px) {
  /* support et /mois disparaissent, le support passe en méta sous le nom */
  .inv-grid { grid-template-columns: minmax(0, 1fr) 110px 110px 110px 64px 64px; }
  .inv-grid > :nth-child(2), .inv-grid > :nth-child(3) { display: none; }
  .cell-support-inline { display: inline; }
  .inv-expand-cols { grid-template-columns: 1fr; }
}
@media (max-width: 779px) {
  /* investi et poids disparaissent : nom, valeur, écart, actions */
  .inv-grid { grid-template-columns: minmax(0, 1fr) 110px 110px 64px; min-height: var(--h-row-touch); }
  .inv-grid > :nth-child(4), .inv-grid > :nth-child(7) { display: none; }
  .bandeau-row { flex-wrap: wrap; gap: var(--s-4); }
  .synth-sep { display: none; }
}
</style>
