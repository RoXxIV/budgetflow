<script setup>
import { ref, computed, onMounted } from 'vue'
import { getInvestments, createInvestment, updateInvestment, deleteInvestment } from '@/api/investments.js'
import { getAccounts } from '@/api/accounts.js'

const investments = ref([])
const accounts = ref([])
const editingId = ref(null)
const editBuffer = ref({})
const showAddForm = ref(false)

// Valeur actuelle inline : { [id]: string }
const currentValueEdits = ref({})

const newInvestment = ref(defaultInv())
function defaultInv() {
  return { name: '', type: 'ETF', account: '', monthlyInvestment: 0 }
}

onMounted(async () => {
  await Promise.all([load(), loadAccounts()])
})

async function load() {
  investments.value = (await getInvestments()).data
  // init les inputs valeur actuelle
  investments.value.forEach((inv) => {
    currentValueEdits.value[inv._id] = inv.currentValue ?? ''
  })
}
async function loadAccounts() { accounts.value = (await getAccounts()).data }

async function add() {
  if (!newInvestment.value.name.trim() || !newInvestment.value.account) return
  await createInvestment(newInvestment.value)
  newInvestment.value = defaultInv()
  showAddForm.value = false
  await load()
}

function startEdit(inv) {
  editingId.value = inv._id
  editBuffer.value = {
    name: inv.name,
    type: inv.type,
    account: inv.account?._id || inv.account,
    monthlyInvestment: inv.monthlyInvestment,
  }
}

async function saveEdit(id) {
  await updateInvestment(id, editBuffer.value)
  editingId.value = null
  await load()
}

async function remove(id) {
  await deleteInvestment(id)
  await load()
}

// ─── Valeur actuelle inline ───────────────────────────────
async function saveCurrentValue(inv) {
  const val = parseFloat(currentValueEdits.value[inv._id])
  if (isNaN(val) || val === inv.currentValue) return
  await updateInvestment(inv._id, { currentValue: val })
  await load()
}

// ─── % gain/perte ─────────────────────────────────────────
function gainPct(inv) {
  if (!inv.totalInvested) return null
  return ((inv.currentValue - inv.totalInvested) / inv.totalInvested) * 100
}

// ─── Totaux ──────────────────────────────────────────────
const totalInvested = computed(() => investments.value.reduce((s, i) => s + (i.totalInvested || 0), 0))
const totalMonthly = computed(() => investments.value.reduce((s, i) => s + (i.monthlyInvestment || 0), 0))
const totalCurrentValue = computed(() => investments.value.reduce((s, i) => s + (i.currentValue || 0), 0))
const totalGainPct = computed(() => {
  if (!totalInvested.value) return null
  return ((totalCurrentValue.value - totalInvested.value) / totalInvested.value) * 100
})

const typeLabel = { ETF: 'ETF', CRYPTO: 'Crypto', STOCK: 'Action', OTHER: 'Autre' }
const typeColor = { ETF: '#2563eb', CRYPTO: '#f59e0b', STOCK: '#16a34a', OTHER: '#6b7280' }

function fmt(n) { return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtPct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%' }
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Investissements</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Suivi de tes placements et de leur valeur actuelle</p>
      </div>
      <button
        class="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-[7px] text-[13px] font-medium cursor-pointer border-none"
        @click="showAddForm = !showAddForm"
      >
        <font-awesome-icon icon="plus" /> Ajouter
      </button>
    </div>

    <!-- Totaux -->
    <div class="flex gap-3 mb-5">
      <div class="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-4.5 py-3.5 flex flex-col gap-1">
        <span class="text-[12px] text-gray-400 font-medium">Total investi</span>
        <span class="text-[20px] font-bold text-gray-950 dark:text-gray-50">{{ fmt(totalInvested) }} €</span>
      </div>
      <div class="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-4.5 py-3.5 flex flex-col gap-1">
        <span class="text-[12px] text-gray-400 font-medium">DCA mensuel</span>
        <span class="text-[20px] font-bold text-gray-950 dark:text-gray-50">{{ fmt(totalMonthly) }} €/mois</span>
      </div>
      <div class="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-4.5 py-3.5 flex flex-col gap-1">
        <span class="text-[12px] text-gray-400 font-medium">Valeur actuelle totale</span>
        <div class="flex items-baseline gap-2.5">
          <span class="text-[20px] font-bold text-gray-950 dark:text-gray-50">{{ fmt(totalCurrentValue) }} €</span>
          <span v-if="totalGainPct !== null" class="text-[15px] font-bold" :class="totalGainPct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'">
            {{ fmtPct(totalGainPct) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Formulaire ajout -->
    <div v-if="showAddForm" class="bg-white dark:bg-gray-800 border border-blue-500/25 rounded-[10px] px-5 py-4.5 mb-5">
      <h3 class="text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-3.5">Nouvel investissement</h3>
      <div class="grid gap-2.5 mb-3.5" style="grid-template-columns: 1fr 120px 160px 130px">
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Nom</label>
          <input v-model="newInvestment.name" class="px-2.5 py-1.75 border border-gray-200 dark:border-gray-700 rounded-md text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none" placeholder="Ex: MSCI World" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Type</label>
          <select v-model="newInvestment.type" class="px-2 py-1.75 border border-gray-200 dark:border-gray-700 rounded-md text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:outline-none cursor-pointer">
            <option v-for="(label, val) in typeLabel" :key="val" :value="val">{{ label }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Compte</label>
          <select v-model="newInvestment.account" class="px-2 py-1.75 border border-gray-200 dark:border-gray-700 rounded-md text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:outline-none cursor-pointer">
            <option value="">— Choisir —</option>
            <option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">DCA mensuel (€)</label>
          <input v-model.number="newInvestment.monthlyInvestment" type="number" class="px-2.5 py-1.75 border border-gray-200 dark:border-gray-700 rounded-md text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none" />
        </div>
      </div>
      <div class="flex gap-2">
        <button class="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-[7px] text-[13px] font-medium cursor-pointer border-none" @click="add">Créer</button>
        <button class="px-3 py-1.5 bg-transparent text-gray-500 border border-gray-200 dark:border-gray-700 rounded-md text-[12.5px] cursor-pointer" @click="showAddForm = false">Annuler</button>
      </div>
    </div>

    <!-- Liste -->
    <div class="flex flex-col gap-3">
      <div v-for="inv in investments" :key="inv._id" class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-4.5 py-4">

        <!-- Mode édition -->
        <template v-if="editingId === inv._id">
          <div class="grid gap-2.5 mb-3" style="grid-template-columns: 1fr 120px 160px 130px">
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Nom</label>
              <input v-model="editBuffer.name" class="px-2.5 py-1.75 border border-gray-200 dark:border-gray-700 rounded-md text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Type</label>
              <select v-model="editBuffer.type" class="px-2 py-1.75 border border-gray-200 dark:border-gray-700 rounded-md text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:outline-none cursor-pointer">
                <option v-for="(label, val) in typeLabel" :key="val" :value="val">{{ label }}</option>
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Compte</label>
              <select v-model="editBuffer.account" class="px-2 py-1.75 border border-gray-200 dark:border-gray-700 rounded-md text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:outline-none cursor-pointer">
                <option value="">—</option>
                <option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option>
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">DCA mensuel (€)</label>
              <input v-model.number="editBuffer.monthlyInvestment" type="number" class="px-2.5 py-1.75 border border-gray-200 dark:border-gray-700 rounded-md text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none" />
            </div>
          </div>
          <div class="flex gap-2">
            <button class="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md text-[12.5px] font-medium cursor-pointer border-none" @click="saveEdit(inv._id)">
              <font-awesome-icon icon="check" /> Sauver
            </button>
            <button class="px-3 py-1.5 bg-transparent text-gray-500 border border-gray-200 dark:border-gray-700 rounded-md text-[12.5px] cursor-pointer" @click="editingId = null">Annuler</button>
          </div>
        </template>

        <!-- Mode lecture -->
        <template v-else>
          <div class="flex items-center justify-between mb-3.5">
            <div class="flex items-center gap-2.5">
              <span
                class="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                :style="{ background: typeColor[inv.type] + '22', color: typeColor[inv.type] }"
              >
                {{ typeLabel[inv.type] || inv.type }}
              </span>
              <span class="text-[15px] font-semibold text-gray-950 dark:text-gray-50">{{ inv.name }}</span>
              <span class="text-[12.5px] text-gray-400">{{ inv.account?.name }}</span>
            </div>
            <div class="flex gap-1.5">
              <button
                class="w-7 h-7 flex items-center justify-center border-none rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer text-[12px] hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                @click="startEdit(inv)" title="Modifier"
              >
                <font-awesome-icon icon="pen" />
              </button>
              <button
                class="w-7 h-7 flex items-center justify-center border-none rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer text-[12px] hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500"
                @click="remove(inv._id)" title="Supprimer"
              >
                <font-awesome-icon icon="trash" />
              </button>
            </div>
          </div>

          <div class="flex gap-7 items-end">
            <!-- DCA mensuel -->
            <div class="flex flex-col gap-[3px]">
              <span class="text-[11.5px] text-gray-400">DCA mensuel</span>
              <span class="text-[15px] font-semibold text-gray-700 dark:text-gray-300">{{ fmt(inv.monthlyInvestment) }} €/mois</span>
            </div>
            <!-- Total investi -->
            <div class="flex flex-col gap-[3px]">
              <span class="text-[11.5px] text-gray-400">Total investi</span>
              <span class="text-[15px] font-semibold text-blue-600 dark:text-blue-400">{{ fmt(inv.totalInvested) }} €</span>
            </div>
            <!-- % gain/perte -->
            <div v-if="gainPct(inv) !== null" class="flex flex-col gap-[3px]">
              <span class="text-[11.5px] text-gray-400">Performance</span>
              <span class="text-[15px] font-semibold" :class="gainPct(inv) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'">
                {{ fmtPct(gainPct(inv)) }}
              </span>
            </div>
            <!-- Valeur actuelle (input inline) -->
            <div class="flex flex-col gap-[3px]">
              <span class="text-[11.5px] text-gray-400">Valeur actuelle</span>
              <div class="relative">
                <input
                  class="w-[120px] pr-7 pl-2.5 py-[5px] border border-gray-200 dark:border-gray-700 rounded-md text-[14px] font-semibold text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-blue-500 dark:focus:border-blue-400 focus:outline-none"
                  type="number"
                  step="0.01"
                  :value="currentValueEdits[inv._id]"
                  @input="currentValueEdits[inv._id] = $event.target.value"
                  @blur="saveCurrentValue(inv)"
                  @keyup.enter="saveCurrentValue(inv)"
                />
                <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 pointer-events-none">€</span>
              </div>
            </div>
          </div>
        </template>
      </div>
      <p v-if="investments.length === 0" class="text-center text-gray-300 dark:text-gray-600 text-[13px] py-8">Aucun investissement — clique sur Ajouter pour commencer</p>
    </div>
  </div>
</template>
