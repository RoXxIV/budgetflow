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
import { confirmDialog, apiError } from '@/composables/useDialog.js'

// ─── Data ────────────────────────────────────────────────
const assets = ref([])
const accounts = ref([])
const settings = ref(null)

async function load() {
  const [aRes, accRes, sRes] = await Promise.all([getAssets(), getAccounts(), getSettings()])
  assets.value = aRes.data
  accounts.value = accRes.data
  settings.value = sRes.data
}
onMounted(load)


const fmt = (n) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtOrDash = (n) => (n === null || n === undefined ? '—' : fmt(n))
const fmtPct = (n) => (n === null || n === undefined ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + ' %')
const gainClass = (n) => (n === null || n === undefined ? 'text-gray-300' : n >= 0 ? 'text-emerald-600' : 'text-red-500')
const types = computed(() => settings.value?.investmentTypes || [])
const openAssets = computed(() => assets.value.filter((a) => !a.isClosed))
const closedAssets = computed(() => assets.value.filter((a) => a.isClosed))

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

// ─── Panneau déplié : valorisation, mouvements ───────────
const openId = ref(null)
const movements = ref([])
const valuations = ref([])
const valuationForm = ref({ value: '', date: '' })
const movementForm = ref({ kind: 'versement', amount: '', date: '', counterpartAccountId: '', notes: '' })
const today = () => new Date().toISOString().substring(0, 10)

async function togglePanel(asset) {
  if (openId.value === asset.id) { openId.value = null; return }
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
  <div>
    <!-- ─── En-tête + totaux ─────────────────────────── -->
    <div class="flex items-start justify-between mb-5">
      <div>
        <h1 class="text-[22px] font-semibold">Investissements</h1>
        <p class="text-[13px] text-gray-400 mt-0.5 flex items-center gap-1.5">
          Actifs, versements, valorisation
          <HelpTip wide text="Un actif (ETF, crypto…) est hébergé sur un compte de type investissement. Vous saisissez ses versements (aussi via ☐ versé dans le mois si un DCA mensuel est prévu) et, de temps en temps, sa valeur actuelle. Performance = (valeur + retiré − investi) / investi : un retrait ne fausse pas le pourcentage." />
        </p>
      </div>
      <button class="btn-primary" @click="openAdd">+ Actif</button>
    </div>

    <div class="card px-5 py-4 mb-5 grid grid-cols-4 gap-6">
      <div><span class="tile-value">{{ fmt(totals.invested) }}</span><span class="tile-label">Investi<span v-if="totals.withdrawn"> · retiré {{ fmt(totals.withdrawn) }}</span></span></div>
      <div><span class="tile-value">{{ fmtOrDash(totals.value) }}</span><span class="tile-label">Valeur actuelle</span></div>
      <div><span class="tile-value" :class="gainClass(totals.gain)">{{ totals.gain === null ? '—' : (totals.gain >= 0 ? '+' : '') + fmt(totals.gain) }}</span><span class="tile-label">Plus-value <span :class="gainClass(totals.gainPct)">{{ fmtPct(totals.gainPct) }}</span></span></div>
      <div><span class="tile-value text-violet-600">{{ fmt(totals.monthlyDca) }}</span><span class="tile-label">Versements prévus / mois</span></div>
    </div>

    <!-- ─── Formulaire ───────────────────────────────── -->
    <AppModal :open="formOpen" :title="editingId ? 'Modifier l\'actif' : 'Nouvel actif'" @close="formOpen = false">
      <div class="flex flex-wrap gap-4 items-end">
        <label class="field"><span>Nom</span><input v-model="form.name" type="text" class="input w-44" placeholder="MSCI World, BTC…" @keyup.enter="submit" /></label>
        <label class="field"><span>Type</span>
          <select v-model="form.type" class="input w-32">
            <option value="">—</option>
            <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label class="field"><span>Compte hôte</span>
          <select v-model="form.accountId" class="input w-40">
            <option value="">—</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <label class="field"><span>Versement mensuel prévu (€)</span><input v-model="form.monthlyDca" type="number" step="0.01" class="input w-28" placeholder="0" /></label>
      </div>
      <template #footer>
        <button class="btn-primary" @click="submit">{{ editingId ? 'Sauver' : 'Créer' }}</button>
        <button class="btn-secondary" @click="formOpen = false">Annuler</button>
      </template>
    </AppModal>

    <div v-if="!assets.length && !formOpen" class="text-center py-16 text-gray-400">
      <p class="mb-4">Aucun actif pour l'instant.</p>
      <button class="btn-primary" @click="openAdd">Créer le premier actif</button>
    </div>

    <!-- ─── Actifs ───────────────────────────────────── -->
    <div class="card p-0 overflow-hidden" v-if="openAssets.length || closedAssets.length">
      <div v-for="asset in [...openAssets, ...closedAssets]" :key="asset.id" :class="{ 'opacity-50': asset.isClosed }">
        <div class="line-row" @click="togglePanel(asset)">
          <span class="text-[13.5px] font-medium">{{ asset.name }}</span>
          <span v-if="asset.type" class="badge bg-violet-50 text-violet-700">{{ asset.type }}</span>
          <span v-if="asset.accountName" class="badge bg-stone-100 text-gray-500">{{ asset.accountName }}</span>
          <span v-if="asset.isClosed" class="badge bg-gray-100 text-gray-500">clôturé</span>
          <span v-if="asset.monthlyDca" class="text-[11px] text-gray-400">{{ fmt(asset.monthlyDca) }} / mois</span>
          <span class="ml-auto grid grid-cols-3 gap-6 text-right shrink-0">
            <span><span class="block text-[13px] font-semibold">{{ fmt(asset.invested) }}</span><span class="block text-[10.5px] text-gray-400">investi{{ asset.withdrawn ? ' · retiré ' + fmt(asset.withdrawn) : '' }}</span></span>
            <span><span class="block text-[13px] font-semibold">{{ fmtOrDash(asset.value) }}</span><span class="block text-[10.5px] text-gray-400">valeur{{ asset.valuationDate ? ' au ' + asset.valuationDate : '' }}</span></span>
            <span><span class="block text-[13px] font-semibold" :class="gainClass(asset.gain)">{{ asset.gain === null ? '—' : (asset.gain >= 0 ? '+' : '') + fmt(asset.gain) }}</span><span class="block text-[10.5px]" :class="gainClass(asset.gainPct)">{{ fmtPct(asset.gainPct) }}</span></span>
          </span>
          <button class="icon-btn shrink-0 text-gray-300 hover:text-gray-600" title="Modifier" @click.stop="openEdit(asset)">✎</button>
        </div>

        <!-- Panneau -->
        <div v-if="openId === asset.id" class="edit-panel grid grid-cols-2 gap-6">
          <!-- Valorisation -->
          <div>
            <p class="text-xs font-semibold text-gray-500 mb-1.5">Valeur actuelle <span class="font-normal text-gray-400">— saisie à la main, historique conservé</span></p>
            <div class="flex gap-2 mb-2">
              <input v-model="valuationForm.value" type="number" step="0.01" class="input w-28" placeholder="Valeur" @keyup.enter="submitValuation(asset)" />
              <input v-model="valuationForm.date" type="date" class="input w-34" />
              <button class="btn-secondary" @click="submitValuation(asset)">Enregistrer</button>
            </div>
            <div v-for="v in valuations.slice(0, 6)" :key="v.id" class="flex items-center gap-2 text-[12.5px] py-0.5">
              <span class="text-gray-400 w-20">{{ v.date }}</span>
              <span class="font-medium">{{ fmt(v.value) }}</span>
              <button class="icon-btn ml-auto text-red-300 hover:text-red-500" @click="deleteValuation(asset, v)">×</button>
            </div>
          </div>
          <!-- Mouvements -->
          <div>
            <p class="text-xs font-semibold text-gray-500 mb-1.5">Mouvements <span class="font-normal text-gray-400">— versement (compte → actif) ou retrait (actif → compte)</span></p>
            <div class="flex flex-wrap gap-2 mb-2 items-center">
              <select v-model="movementForm.kind" class="input w-28">
                <option value="versement">Versement</option>
                <option value="retrait">Retrait</option>
              </select>
              <input v-model="movementForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="submitMovement(asset)" />
              <input v-model="movementForm.date" type="date" class="input w-34" />
              <select v-model="movementForm.counterpartAccountId" class="input w-28" :title="movementForm.kind === 'versement' ? 'Compte source' : 'Compte destination'">
                <option value="">— compte</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
              <button class="btn-secondary" @click="submitMovement(asset)">Ajouter</button>
            </div>
            <div v-for="m in movements.slice(0, 8)" :key="m.id" class="flex items-center gap-2 text-[12.5px] py-0.5">
              <span class="text-gray-400 w-20">{{ m.date }}</span>
              <span class="font-medium w-20" :class="m.kind === 'versement' ? 'text-emerald-600' : 'text-red-500'">{{ m.kind === 'retrait' ? '−' : '+' }}{{ fmt(m.amount) }}</span>
              <span v-if="m.source === 'dca'" class="badge bg-blue-50 text-blue-600">DCA</span>
              <span class="text-gray-300 text-[11px] truncate">{{ m.kind === 'versement' ? (m.counterpartAccountName || '?') + ' → ' + (asset.accountName || 'actif') : (asset.accountName || 'actif') + ' → ' + (m.counterpartAccountName || '?') }}</span>
              <button class="icon-btn ml-auto text-red-300 hover:text-red-500" @click="deleteMovement(asset, m)">×</button>
            </div>
            <p v-if="!movements.length" class="text-xs text-gray-400">Aucun mouvement.</p>
          </div>
          <div class="col-span-2 flex gap-3 text-xs">
            <button class="link" @click="toggleClosed(asset)">{{ asset.isClosed ? 'Rouvrir' : 'Clôturer' }}</button>
            <button class="link text-red-400" @click="removeConfirm(asset)">Supprimer</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/style.css";

.card { @apply bg-white rounded-xl border border-stone-200; }
.tile-value { @apply block text-[18px] font-bold tracking-tight; }
.tile-label { @apply block text-[11px] text-gray-400 font-medium; }
.badge { @apply text-[10.5px] font-semibold px-1.5 py-px rounded-full shrink-0; }
.line-row { @apply flex items-center gap-2 px-4 py-2.5 border-b border-stone-50 cursor-pointer hover:bg-stone-50; }
.edit-panel { @apply px-4 py-3 bg-stone-50 border-b border-stone-100; }
.field { @apply flex flex-col gap-1 text-[11px] font-medium text-gray-500; }
.input { @apply py-1.5 px-2 border border-stone-200 rounded-md text-[13px] text-gray-900 bg-white outline-none focus:border-violet-400; }
.btn-primary { @apply py-1.5 px-3 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-[12.5px] font-medium cursor-pointer; }
.btn-secondary { @apply py-1.5 px-3 bg-white border border-stone-200 hover:bg-stone-100 text-gray-600 rounded-md text-[12.5px] font-medium cursor-pointer; }
.icon-btn { @apply w-6 h-6 rounded hover:bg-stone-200 cursor-pointer text-[13px]; }
.link { @apply text-violet-600 hover:underline cursor-pointer; }
</style>
