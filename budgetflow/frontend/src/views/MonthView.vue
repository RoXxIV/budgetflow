<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  getMonths, getMonthPrefill, createMonth, setMonthClosed,
  getMonthLines, payLine, unpayLine,
  getMonthSnapshots, upsertMonthSnapshots,
  getMonthEntries, createEntry, deleteEntry,
  getMonthSummary,
} from '@/api/months.js'
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

async function openMonth(month) {
  current.value = month
  const [lRes, eRes, sRes, sumRes] = await Promise.all([
    getMonthLines(month.id), getMonthEntries(month.id), getMonthSnapshots(month.id), getMonthSummary(month.id),
  ])
  lines.value = lRes.data
  entriesAll.value = eRes.data
  snapshots.value = sRes.data
  summaryData.value = sumRes.data
}

async function reload() {
  const [lRes, eRes, sumRes] = await Promise.all([
    getMonthLines(current.value.id), getMonthEntries(current.value.id), getMonthSummary(current.value.id),
  ])
  lines.value = lRes.data
  entriesAll.value = eRes.data
  summaryData.value = sumRes.data
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
    .filter((g) => g.lines.length)
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
  accounts.value.forEach((a) => {
    map[a.id] = data.snapshots.find((s) => s.accountId === a.id)?.balance ?? ''
  })
  newMonth.value = { period: data.period, snapshots: map }
  createFormOpen.value = true
}

async function submitCreate() {
  if (!newMonth.value.period || newMonthTaken.value) return
  const snapshotList = Object.entries(newMonth.value.snapshots)
    .filter(([, v]) => v !== '' && v !== null)
    .map(([accountId, balance]) => ({ accountId: Number(accountId), balance: parseFloat(balance) }))
  try {
    const { data: created } = await createMonth({ period: newMonth.value.period, snapshots: snapshotList })
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
  }
}

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
    })
    entryForm.value = { ...f, amount: '', label: '' }
    await reload()
  } catch (e) { apiError(e) }
}

async function removeEntry(entry) {
  try { await deleteEntry(current.value.id, entry.id); await reload() } catch (e) { apiError(e) }
}

// ─── Affichage réel / restant ────────────────────────────
function overBudget(line) {
  return line.kind === 'variable' && line.plannedAmount > 0 && line.actualAmount > line.plannedAmount
}
function progressPct(line) {
  if (!line.plannedAmount) return 0
  return Math.min(100, Math.round((line.actualAmount / line.plannedAmount) * 100))
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
    <div v-if="createFormOpen" class="card px-5 py-4 mb-5">
      <h3 class="text-[14px] font-semibold mb-3">Nouveau mois</h3>
      <div class="flex items-center gap-3 mb-3">
        <input v-model="newMonth.period" type="month" class="input" />
        <span v-if="newMonthName && !newMonthTaken" class="text-[13px] font-medium text-violet-600">→ {{ newMonthName }}</span>
        <span v-if="newMonthTaken" class="text-[12.5px] font-medium text-red-500">Un mois existe déjà pour {{ newMonthName }}</span>
      </div>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Solde de début de mois (recalage par compte)</p>
      <div class="flex flex-col gap-1.5 mb-4">
        <div v-for="a in accounts" :key="a.id" class="flex items-center gap-2.5">
          <span class="text-[13px] text-gray-600 w-36 shrink-0">{{ a.name }}</span>
          <input v-model="newMonth.snapshots[a.id]" type="number" step="0.01" class="input w-28" placeholder="—" @keyup.enter="submitCreate" />
        </div>
      </div>
      <div class="flex gap-2">
        <button class="btn-primary" :disabled="!newMonth.period || newMonthTaken" @click="submitCreate">Créer depuis le template</button>
        <button class="btn-secondary" @click="createFormOpen = false">Annuler</button>
      </div>
    </div>

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
              Disponible{{ summaryData.mainAccount ? ' — ' + summaryData.mainAccount.name : '' }}
            </span>
            <span v-if="!summaryData.mainAccount" class="text-[11px] text-amber-500">Définir un compte principal (Comptes)</span>
            <span v-else-if="summaryData.tiles.disponible === null" class="text-[11px] text-amber-500">Saisir le solde de début de mois</span>
          </div>
          <div
            class="flex flex-col gap-0.5"
            :title="`+ ${fmt(summaryData.tiles.detail.revenusRestants)} revenus à venir · − ${fmt(summaryData.tiles.detail.fixesRestants)} fixes non payés · − ${fmt(summaryData.tiles.detail.variablesRestants)} restants sur plafonds`"
          >
            <span class="text-[20px] font-bold tracking-tight" :class="amountClass(summaryData.tiles.projete)">
              {{ fmtOrDash(summaryData.tiles.projete) }}
            </span>
            <span class="text-[11.5px] text-gray-400 font-medium">Projeté fin de mois</span>
            <span class="text-[11px] text-gray-400">si fixes payés et plafonds atteints</span>
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
              enveloppes {{ fmt(a.envelopesTotal) }} · dispo {{ fmtOrDash(a.unallocated) }}
            </p>
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
              <div class="line-row" @click="toggleEntries(line)">
                <!-- ☐ payé (fixes uniquement) -->
                <input
                  v-if="line.kind === 'fixe'"
                  type="checkbox"
                  class="shrink-0 accent-violet-600 cursor-pointer"
                  :checked="isPaid(line)"
                  :disabled="current.isClosed"
                  :title="isPaid(line) ? 'Payé' : 'Marquer payé au montant prévu'"
                  @click.stop="togglePaid(line)"
                />
                <span class="text-[13px] font-medium truncate" :class="{ 'text-gray-400': line.kind === 'fixe' && !isPaid(line) }">
                  {{ line.label }}
                </span>
                <span v-if="line.kind === 'fixe' && line.recurringDay" class="badge bg-blue-50 text-blue-600">le {{ line.recurringDay }}</span>
                <span v-if="line.isShared" class="badge bg-amber-50 text-amber-600">½</span>

                <!-- Montants -->
                <span class="ml-auto shrink-0 text-right">
                  <template v-if="line.kind === 'fixe'">
                    <span class="text-[13px] font-semibold" :class="isPaid(line) ? '' : 'text-gray-400'">
                      {{ fmt(isPaid(line) ? line.actualAmount : line.plannedAmount) }}
                    </span>
                    <span v-if="isPaid(line) && line.actualAmount !== line.plannedAmount" class="text-[11px] text-gray-400"> / {{ fmt(line.plannedAmount) }}</span>
                  </template>
                  <template v-else>
                    <span class="text-[13px] font-semibold" :class="overBudget(line) ? 'text-red-500' : ''">{{ fmt(line.actualAmount) }}</span>
                    <span v-if="line.plannedAmount" class="text-[11px] text-gray-400"> / {{ fmt(line.plannedAmount) }}</span>
                  </template>
                </span>
              </div>

              <!-- Barre de progression (variables avec plafond) -->
              <div v-if="line.kind === 'variable' && line.plannedAmount > 0" class="px-4 pb-1.5 -mt-1">
                <div class="progress">
                  <div class="progress-bar" :class="overBudget(line) ? 'bg-red-500' : 'bg-violet-500'" :style="{ width: progressPct(line) + '%' }" />
                </div>
              </div>

              <!-- Entrées dépliées -->
              <div v-if="openEntriesLineId === line.id" class="edit-panel">
                <div v-for="e in entriesForLine(line)" :key="e.id" class="flex items-center gap-2 text-[12.5px] py-1">
                  <span class="text-gray-400 w-20 shrink-0">{{ e.date }}</span>
                  <span class="font-medium w-20 shrink-0">{{ fmt(e.amount) }}</span>
                  <span v-if="e.source === 'paye'" class="badge bg-blue-50 text-blue-600">payé</span>
                  <span v-if="themeById(e.themeId)" class="badge" :style="{ background: themeById(e.themeId).color + '22', color: themeById(e.themeId).color }">{{ themeById(e.themeId).name }}</span>
                  <span v-if="e.isShared" class="badge bg-amber-50 text-amber-600">½</span>
                  <span class="text-gray-400 truncate">{{ e.label }}</span>
                  <span v-if="accountById(e.accountId) || accountById(e.toAccountId)" class="text-gray-300 text-[11px] ml-auto shrink-0">
                    {{ accountById(e.accountId)?.name || '?' }}<template v-if="accountById(e.toAccountId)"> → {{ accountById(e.toAccountId).name }}</template>
                  </span>
                  <button v-if="!current.isClosed" class="icon-btn text-red-300 hover:text-red-500 shrink-0" :class="{ 'ml-auto': !accountById(e.accountId) && !accountById(e.toAccountId) }" @click="removeEntry(e)">×</button>
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
                  <label class="checkbox"><input v-model="entryForm.isShared" type="checkbox" /><span>½</span></label>
                  <button class="btn-secondary" @click="submitEntry(line)">Ajouter</button>
                </div>
              </div>
            </div>
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
