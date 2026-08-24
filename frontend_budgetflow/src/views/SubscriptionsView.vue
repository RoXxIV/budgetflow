<script setup>
import { ref, computed, onMounted } from 'vue'
import { getSubscriptions, createSubscription, updateSubscription, deleteSubscription } from '@/api/subscriptions.js'
import { getThemes } from '@/api/themes.js'
import { fmt, fmtDate } from '@/utils/formatters.js'
import { useCurrency } from '@/composables/useCurrency.js'
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.vue'

const { currencySymbol } = useCurrency()

// ─── Data ────────────────────────────────────────────────
const subscriptions = ref([])
const themes = ref([])

onMounted(async () => {
  const [subsRes, themesRes] = await Promise.all([getSubscriptions(), getThemes()])
  subscriptions.value = subsRes.data
  themes.value = themesRes.data
})

async function load() {
  subscriptions.value = (await getSubscriptions()).data
}

// ─── Périodicités ────────────────────────────────────────
const PERIODS = [
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'monthly', label: 'Mensuel' },
  { value: 'yearly', label: 'Annuel' },
]
const periodLabel = { weekly: 'Hebdo', monthly: 'Mensuel', yearly: 'Annuel' }

// Valeurs possibles du "jour de prélèvement" selon la périodicité
// (renewalDay : hebdo = jour de semaine JS 0-6, mensuel = 1-31, annuel = mois 0-11)
const WEEKDAYS = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 0, label: 'Dimanche' },
]
const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
].map((label, value) => ({ value, label }))

function dayOptions(period) {
  if (period === 'weekly') return WEEKDAYS
  if (period === 'yearly') return MONTHS
  return Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: `Le ${i + 1}` }))
}

function dayFieldLabel(period) {
  if (period === 'weekly') return 'Jour de la semaine'
  if (period === 'yearly') return 'Mois de prélèvement'
  return 'Jour du mois'
}

function validDay(period, day) {
  if (day == null || day === '') return false
  if (period === 'weekly') return day >= 0 && day <= 6
  if (period === 'yearly') return day >= 0 && day <= 11
  return day >= 1 && day <= 31
}

// Ramène un montant au mois selon la périodicité
function toMonthly(period, amount) {
  const p = amount || 0
  if (period === 'weekly') return (p * 52) / 12
  if (period === 'yearly') return p / 12
  return p
}

// Équivalent mensuel d'un abonnement
function monthlyCost(sub) {
  return toMonthly(sub.period, sub.price)
}

// Coût sur une année pleine
function yearlyCost(sub) {
  return toMonthly(sub.period, sub.price) * 12
}

// Prix retenu pour le scénario "effort" : le prix effort s'il est saisi, sinon le prix actuel
function effortAmount(sub) {
  return sub.effortPrice > 0 ? sub.effortPrice : sub.price
}

const hasEffort = computed(() => subscriptions.value.some((s) => s.effortPrice > 0))

// ─── Totaux ──────────────────────────────────────────────
const totalMonthly = computed(() => subscriptions.value.reduce((s, sub) => s + monthlyCost(sub), 0))
const totalYearly = computed(() => totalMonthly.value * 12)
const totalMonthlyEffort = computed(() =>
  subscriptions.value.reduce((s, sub) => s + toMonthly(sub.period, effortAmount(sub)), 0)
)
const monthlySavings = computed(() => totalMonthly.value - totalMonthlyEffort.value)

// ─── Prochaine échéance (déduite du jour de prélèvement) ─
function nextRenewal(sub) {
  const day = sub.renewalDay
  if (day == null) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (sub.period === 'weekly') {
    const diff = (day - today.getDay() + 7) % 7
    const r = new Date(today)
    r.setDate(r.getDate() + diff)
    return r
  }

  if (sub.period === 'yearly') {
    // Précision au mois : on pointe le 1er du mois de prélèvement
    const y = today.getFullYear() + (day < today.getMonth() ? 1 : 0)
    return new Date(y, day, 1)
  }

  // Mensuel : jour demandé, borné au dernier jour du mois (ex: le 31 en février)
  const clamped = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()))
  let r = clamped(today.getFullYear(), today.getMonth())
  if (r < today) r = clamped(today.getFullYear(), today.getMonth() + 1)
  return r
}

function daysUntil(date) {
  if (!date) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date - today) / 86400000)
}

// Affichage de l'échéance : date précise (hebdo/mensuel) ou mois (annuel)
function renewalDisplay(sub) {
  const d = nextRenewal(sub)
  if (!d) return '—'
  if (sub.period === 'yearly') {
    const isCurrentMonth = d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear()
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    return isCurrentMonth ? `${label} (ce mois-ci)` : label
  }
  const days = daysUntil(d)
  return `${fmtDate(d)} (${days === 0 ? "aujourd'hui" : 'J-' + days})`
}

function renewalIsSoon(sub) {
  if (sub.period === 'yearly') return false
  const days = daysUntil(nextRenewal(sub))
  return days != null && days <= 3
}

// Liste triée par échéance la plus proche
const sortedSubscriptions = computed(() =>
  [...subscriptions.value].sort((a, b) => (nextRenewal(a) || 0) - (nextRenewal(b) || 0))
)

// ─── Formulaire ajout ────────────────────────────────────
const showAddForm = ref(false)
const newSub = ref(defaultSub())
function defaultSub() {
  return { name: '', theme: '', period: 'monthly', renewalDay: null, price: null, effortPrice: null }
}

// Changer de périodicité invalide le jour choisi (échelles différentes)
function onPeriodChange(form) {
  form.renewalDay = null
}

async function add() {
  if (!newSub.value.name.trim() || !validDay(newSub.value.period, newSub.value.renewalDay) || !(newSub.value.price > 0)) return
  const data = { ...newSub.value }
  if (!data.theme) delete data.theme
  if (!(data.effortPrice > 0)) data.effortPrice = null
  await createSubscription(data)
  newSub.value = defaultSub()
  showAddForm.value = false
  await load()
}

// ─── Édition inline ──────────────────────────────────────
const editingId = ref(null)
const editBuffer = ref({})

function startEdit(sub) {
  editingId.value = sub._id
  editBuffer.value = {
    name: sub.name,
    theme: sub.theme?._id || sub.theme || '',
    period: sub.period,
    renewalDay: sub.renewalDay ?? null,
    price: sub.price,
    effortPrice: sub.effortPrice ?? null,
  }
}

function cancelEdit() {
  editingId.value = null
  editBuffer.value = {}
}

async function saveEdit(id) {
  if (!validDay(editBuffer.value.period, editBuffer.value.renewalDay)) return
  const data = { ...editBuffer.value }
  if (!data.theme) data.theme = null
  if (!(data.effortPrice > 0)) data.effortPrice = null
  await updateSubscription(id, data)
  cancelEdit()
  await load()
}

// ─── Suppression ─────────────────────────────────────────
const subToDelete = ref(null)

async function doConfirmedRemove() {
  if (!subToDelete.value) return
  await deleteSubscription(subToDelete.value._id)
  subToDelete.value = null
  await load()
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Abonnements</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Suivi de tes abonnements et de leurs échéances</p>
      </div>
      <button
        class="flex items-center gap-1.5 px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-[7px] text-[13px] font-medium cursor-pointer border-none"
        @click="showAddForm = !showAddForm"
      >
        <font-awesome-icon icon="plus" /> Ajouter
      </button>
    </div>

    <!-- Totaux -->
    <div class="flex gap-3 mb-5">
      <div class="flex-1 glass-card px-4.5 py-3.5 flex flex-col gap-1">
        <span class="text-[12px] text-gray-400 font-medium">Total mensuel</span>
        <span class="text-[20px] font-bold text-gray-950 dark:text-gray-50">{{ fmt(totalMonthly) }} {{ currencySymbol }}/mois</span>
      </div>
      <div class="flex-1 glass-card px-4.5 py-3.5 flex flex-col gap-1">
        <span class="text-[12px] text-gray-400 font-medium">Total annuel</span>
        <span class="text-[20px] font-bold text-gray-950 dark:text-gray-50">{{ fmt(totalYearly) }} {{ currencySymbol }}/an</span>
      </div>
      <div v-if="hasEffort" class="flex-1 glass-card px-4.5 py-3.5 flex flex-col gap-1">
        <span class="text-[12px] text-gray-400 font-medium">Avec efforts appliqués</span>
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="text-[20px] font-bold text-gray-950 dark:text-gray-50">{{ fmt(totalMonthlyEffort) }} {{ currencySymbol }}/mois</span>
          <span class="text-[12.5px] text-gray-400">{{ fmt(totalMonthlyEffort * 12) }} {{ currencySymbol }}/an</span>
        </div>
        <span v-if="monthlySavings > 0.005" class="text-[12px] font-semibold text-green-600 dark:text-green-400">
          −{{ fmt(monthlySavings) }} {{ currencySymbol }}/mois ({{ fmt(monthlySavings * 12) }} {{ currencySymbol }}/an d'économie)
        </span>
      </div>
      <div class="flex-1 glass-card px-4.5 py-3.5 flex flex-col gap-1">
        <span class="text-[12px] text-gray-400 font-medium">Abonnements actifs</span>
        <span class="text-[20px] font-bold text-gray-950 dark:text-gray-50">{{ subscriptions.length }}</span>
      </div>
    </div>

    <!-- Formulaire ajout -->
    <div v-if="showAddForm" class="glass-card px-5 py-4.5 mb-5">
      <h3 class="text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-3.5">Nouvel abonnement</h3>
      <div class="grid gap-2.5 mb-3.5" style="grid-template-columns: 1fr 150px 140px 135px 100px 100px">
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Nom</label>
          <input v-model="newSub.name" class="input-sub" placeholder="Ex: Netflix" @keyup.enter="add" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Type</label>
          <select v-model="newSub.theme" class="input-sub cursor-pointer">
            <option value="">— Aucun —</option>
            <option v-for="t in themes" :key="t._id" :value="t._id">{{ t.name }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Temporalité</label>
          <select v-model="newSub.period" class="input-sub cursor-pointer" @change="onPeriodChange(newSub)">
            <option v-for="p in PERIODS" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">{{ dayFieldLabel(newSub.period) }}</label>
          <select v-model.number="newSub.renewalDay" class="input-sub cursor-pointer">
            <option :value="null" disabled>— Choisir —</option>
            <option v-for="o in dayOptions(newSub.period)" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Prix ({{ currencySymbol }})</label>
          <input v-model.number="newSub.price" type="number" step="0.01" min="0" class="input-sub" @keyup.enter="add" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400" title="Prix d'une offre moins chère envisagée — utilisé pour le total « avec effort »">Prix effort ({{ currencySymbol }})</label>
          <input v-model.number="newSub.effortPrice" type="number" step="0.01" min="0" class="input-sub" placeholder="optionnel" @keyup.enter="add" />
        </div>
      </div>
      <div class="flex gap-2">
        <button
          class="px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-[7px] text-[13px] font-medium cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!newSub.name.trim() || !validDay(newSub.period, newSub.renewalDay) || !(newSub.price > 0)"
          @click="add"
        >Ajouter</button>
        <button class="px-3 py-2 bg-transparent text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-[7px] text-[13px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700" @click="showAddForm = false">Annuler</button>
      </div>
    </div>

    <!-- Liste -->
    <div class="flex flex-col gap-2">
      <div
        v-for="sub in sortedSubscriptions"
        :key="sub._id"
        class="glass-card px-4.5 py-3.5"
      >
        <!-- Mode édition -->
        <template v-if="editingId === sub._id">
          <div class="grid gap-2.5 mb-3" style="grid-template-columns: 1fr 150px 140px 135px 100px 100px">
            <input v-model="editBuffer.name" class="input-sub" />
            <select v-model="editBuffer.theme" class="input-sub cursor-pointer">
              <option value="">— Aucun —</option>
              <option v-for="t in themes" :key="t._id" :value="t._id">{{ t.name }}</option>
            </select>
            <select v-model="editBuffer.period" class="input-sub cursor-pointer" @change="onPeriodChange(editBuffer)">
              <option v-for="p in PERIODS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
            <select v-model.number="editBuffer.renewalDay" class="input-sub cursor-pointer">
              <option :value="null" disabled>— {{ dayFieldLabel(editBuffer.period) }} —</option>
              <option v-for="o in dayOptions(editBuffer.period)" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input v-model.number="editBuffer.price" type="number" step="0.01" min="0" class="input-sub" />
            <input v-model.number="editBuffer.effortPrice" type="number" step="0.01" min="0" class="input-sub" placeholder="effort (opt.)" title="Prix d'une offre moins chère envisagée" />
          </div>
          <div class="flex gap-2">
            <button class="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-[7px] text-[12.5px] font-medium cursor-pointer border-none" @click="saveEdit(sub._id)">Sauver</button>
            <button class="px-3 py-1.5 bg-transparent text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-[7px] text-[12.5px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700" @click="cancelEdit">Annuler</button>
          </div>
        </template>

        <!-- Mode affichage -->
        <template v-else>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
              <span class="text-[14.5px] font-semibold text-gray-950 dark:text-gray-50">{{ sub.name }}</span>
              <span
                v-if="sub.theme"
                class="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                :style="{ background: (sub.theme.color || '#6b7280') + '22', color: sub.theme.color || '#6b7280' }"
              >{{ sub.theme.name }}</span>
              <span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{{ periodLabel[sub.period] }}</span>
            </div>

            <div class="flex flex-col items-end shrink-0 w-44">
              <span class="text-[12px] text-gray-400">Prochain prélèvement</span>
              <span
                class="text-[13px] font-medium"
                :class="renewalIsSoon(sub) ? 'text-orange-500' : 'text-gray-700 dark:text-gray-200'"
              >{{ renewalDisplay(sub) }}</span>
            </div>

            <div class="flex flex-col items-end shrink-0 w-32">
              <span class="text-[15px] font-bold text-gray-950 dark:text-gray-50">{{ fmt(sub.price) }} {{ currencySymbol }}</span>
              <span v-if="sub.period !== 'monthly'" class="text-[11.5px] text-gray-400">≈ {{ fmt(monthlyCost(sub)) }} {{ currencySymbol }}/mois</span>
              <span v-if="sub.effortPrice > 0" class="text-[11.5px] font-semibold text-green-600 dark:text-green-400" title="Prix effort envisagé">
                → {{ fmt(sub.effortPrice) }} {{ currencySymbol }}
              </span>
            </div>

            <div class="flex flex-col items-end shrink-0 w-28">
              <span class="text-[12px] text-gray-400">Par an</span>
              <span class="text-[13.5px] font-semibold text-gray-700 dark:text-gray-200">{{ fmt(yearlyCost(sub)) }} {{ currencySymbol }}</span>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <button
                class="w-7 h-7 flex items-center justify-center border-none rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer text-[12px] hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                @click="startEdit(sub)" title="Modifier"
              >
                <font-awesome-icon icon="pen" />
              </button>
              <button
                class="w-7 h-7 flex items-center justify-center border-none rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer text-[12px] hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500"
                @click="subToDelete = sub" title="Supprimer"
              >
                <font-awesome-icon icon="trash" />
              </button>
            </div>
          </div>
        </template>
      </div>

      <p v-if="subscriptions.length === 0" class="text-center text-gray-300 dark:text-gray-600 text-[13px] py-8">
        Aucun abonnement — clique sur Ajouter pour commencer
      </p>
    </div>

    <!-- Modale confirmation suppression -->
    <ConfirmDeleteModal
      v-if="subToDelete"
      title="Supprimer cet abonnement ?"
      :label="subToDelete.name"
      warning="Son suivi et ses échéances disparaîtront. Tes budgets et entrées ne sont pas touchés."
      @confirm="doConfirmedRemove"
      @cancel="subToDelete = null"
    />
  </div>
</template>

<style scoped>
.input-sub {
  padding: 7px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  color: #0f172a;
  background: #f9fafb;
  outline: none;
}
.input-sub:focus { border-color: #8b5cf6; }
:global(.dark) .input-sub {
  border-color: #374151;
  background: rgba(55, 65, 81, 0.5);
  color: #f9fafb;
}
</style>
