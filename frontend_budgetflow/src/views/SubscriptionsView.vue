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

// Équivalent mensuel d'un abonnement selon sa périodicité
function monthlyCost(sub) {
  const p = sub.price || 0
  if (sub.period === 'weekly') return (p * 52) / 12
  if (sub.period === 'yearly') return p / 12
  return p
}

// ─── Totaux ──────────────────────────────────────────────
const totalMonthly = computed(() => subscriptions.value.reduce((s, sub) => s + monthlyCost(sub), 0))
const totalYearly = computed(() => totalMonthly.value * 12)

// ─── Prochaine échéance (roulée depuis la date ancre) ────
function nextRenewal(sub) {
  const d = new Date(sub.renewalDate)
  if (isNaN(d)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let guard = 0
  while (d < today && guard++ < 2000) {
    if (sub.period === 'weekly') d.setDate(d.getDate() + 7)
    else if (sub.period === 'yearly') d.setFullYear(d.getFullYear() + 1)
    else d.setMonth(d.getMonth() + 1)
  }
  return d
}

function daysUntil(date) {
  if (!date) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date - today) / 86400000)
}

// Liste triée par échéance la plus proche
const sortedSubscriptions = computed(() =>
  [...subscriptions.value].sort((a, b) => (nextRenewal(a) || 0) - (nextRenewal(b) || 0))
)

// ─── Formulaire ajout ────────────────────────────────────
const showAddForm = ref(false)
const newSub = ref(defaultSub())
function defaultSub() {
  return { name: '', theme: '', renewalDate: '', period: 'monthly', price: null }
}

async function add() {
  if (!newSub.value.name.trim() || !newSub.value.renewalDate || !(newSub.value.price > 0)) return
  const data = { ...newSub.value }
  if (!data.theme) delete data.theme
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
    renewalDate: sub.renewalDate ? sub.renewalDate.slice(0, 10) : '',
    period: sub.period,
    price: sub.price,
  }
}

function cancelEdit() {
  editingId.value = null
  editBuffer.value = {}
}

async function saveEdit(id) {
  const data = { ...editBuffer.value }
  if (!data.theme) data.theme = null
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
      <div class="flex-1 glass-card px-4.5 py-3.5 flex flex-col gap-1">
        <span class="text-[12px] text-gray-400 font-medium">Abonnements actifs</span>
        <span class="text-[20px] font-bold text-gray-950 dark:text-gray-50">{{ subscriptions.length }}</span>
      </div>
    </div>

    <!-- Formulaire ajout -->
    <div v-if="showAddForm" class="glass-card px-5 py-4.5 mb-5">
      <h3 class="text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-3.5">Nouvel abonnement</h3>
      <div class="grid gap-2.5 mb-3.5" style="grid-template-columns: 1fr 160px 150px 140px 110px">
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
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Date de prélèvement</label>
          <input v-model="newSub.renewalDate" type="date" class="input-sub" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Temporalité</label>
          <select v-model="newSub.period" class="input-sub cursor-pointer">
            <option v-for="p in PERIODS" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Prix ({{ currencySymbol }})</label>
          <input v-model.number="newSub.price" type="number" step="0.01" min="0" class="input-sub" @keyup.enter="add" />
        </div>
      </div>
      <div class="flex gap-2">
        <button
          class="px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-[7px] text-[13px] font-medium cursor-pointer border-none disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!newSub.name.trim() || !newSub.renewalDate || !(newSub.price > 0)"
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
          <div class="grid gap-2.5 mb-3" style="grid-template-columns: 1fr 160px 150px 140px 110px">
            <input v-model="editBuffer.name" class="input-sub" />
            <select v-model="editBuffer.theme" class="input-sub cursor-pointer">
              <option value="">— Aucun —</option>
              <option v-for="t in themes" :key="t._id" :value="t._id">{{ t.name }}</option>
            </select>
            <input v-model="editBuffer.renewalDate" type="date" class="input-sub" />
            <select v-model="editBuffer.period" class="input-sub cursor-pointer">
              <option v-for="p in PERIODS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
            <input v-model.number="editBuffer.price" type="number" step="0.01" min="0" class="input-sub" />
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

            <div class="flex flex-col items-end shrink-0 w-40">
              <span class="text-[12px] text-gray-400">Prochain prélèvement</span>
              <span class="text-[13px] font-medium text-gray-700 dark:text-gray-200">
                {{ fmtDate(nextRenewal(sub)) }}
                <span
                  class="text-[11.5px] font-semibold"
                  :class="daysUntil(nextRenewal(sub)) <= 3 ? 'text-orange-500' : 'text-gray-400'"
                >
                  ({{ daysUntil(nextRenewal(sub)) === 0 ? "aujourd'hui" : 'J-' + daysUntil(nextRenewal(sub)) }})
                </span>
              </span>
            </div>

            <div class="flex flex-col items-end shrink-0 w-32">
              <span class="text-[15px] font-bold text-gray-950 dark:text-gray-50">{{ fmt(sub.price) }} {{ currencySymbol }}</span>
              <span v-if="sub.period !== 'monthly'" class="text-[11.5px] text-gray-400">≈ {{ fmt(monthlyCost(sub)) }} {{ currencySymbol }}/mois</span>
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
