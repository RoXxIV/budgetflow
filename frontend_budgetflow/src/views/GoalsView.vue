<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  getSavingGoals, createSavingGoal, updateSavingGoal, deleteSavingGoal,
  getContributions,
} from '@/api/savingGoals.js'
import { getAccounts } from '@/api/accounts.js'
import { getSheets, getSheetSnapshots, getSheetLines, getSheetContributions, getSheetInvestmentTransactions } from '@/api/sheets.js'
import { getSettings } from '@/api/settings.js'
import { getInvestments } from '@/api/investments.js'
import { fmt, fmtDate } from '@/utils/formatters.js'
import { buildSnapshotMap, computeAccountDeltaMap, resolveBalance } from '@/utils/liveBalances.js'

const goals = ref([])
const accounts = ref([])
const showAddForm = ref(false)
const editingId = ref(null)
const editBuffer = ref({})
const openContribId = ref(null)
const contributions = ref([])

// Sheet actif — pour les soldes temps réel par compte
const snapshots = ref([])
const sheetLines = ref([])
const sheetContribs = ref([])
const sheetInvestTxs = ref([])
const investments = ref([])
const settings = ref(null)

const newGoal = ref(defaultGoal())
function defaultGoal() {
  return { name: '', account: '', targetAmount: 0, initialAmount: 0, deadline: '' }
}

onMounted(async () => {
  await Promise.all([load(), loadAccounts(), loadActiveSheetData()])
})
async function load() { goals.value = (await getSavingGoals()).data }
async function loadAccounts() { accounts.value = (await getAccounts()).data }

async function loadActiveSheetData() {
  const [sheetsRes, settingsRes, investRes] = await Promise.all([
    getSheets(), getSettings(), getInvestments(),
  ])
  settings.value = settingsRes.data
  investments.value = investRes.data
  const active = sheetsRes.data.find((s) => s.status === 'active')
  if (!active) return
  const [sRes, lRes, cRes, iRes] = await Promise.all([
    getSheetSnapshots(active._id),
    getSheetLines(active._id),
    getSheetContributions(active._id),
    getSheetInvestmentTransactions(active._id),
  ])
  snapshots.value = sRes.data
  sheetLines.value = lRes.data
  sheetContribs.value = cRes.data
  sheetInvestTxs.value = iRes.data
}

// Solde temps réel par compte (snapshot + mouvements réels du sheet actif)
const liveBalanceByAccount = computed(() => {
  const snapshotMap = buildSnapshotMap(snapshots.value)
  const mainAccountId = settings.value?.mainAccount?._id || settings.value?.mainAccount || null
  const deltaMap = computeAccountDeltaMap({
    lines: sheetLines.value,
    contributions: sheetContribs.value,
    investmentTxs: sheetInvestTxs.value,
    goals: goals.value,
    mainAccountId,
  })
  const result = {}
  accounts.value.forEach((a) => {
    result[a._id] = resolveBalance(snapshotMap, deltaMap, a._id)
  })
  return result
})

function goalCurrentAmount(goal) {
  const accountId = goal.account?._id || goal.account
  const live = liveBalanceByAccount.value[accountId]
  return live !== null && live !== undefined ? live : (goal.currentAmount || 0)
}

async function add() {
  if (!newGoal.value.name.trim() || !newGoal.value.account || !newGoal.value.deadline) return
  await createSavingGoal(newGoal.value)
  newGoal.value = defaultGoal()
  showAddForm.value = false
  await load()
}

function startEdit(goal) {
  editingId.value = goal._id
  editBuffer.value = {
    name: goal.name,
    account: goal.account?._id || goal.account,
    targetAmount: goal.targetAmount,
    initialAmount: goal.initialAmount,
    deadline: goal.deadline ? goal.deadline.substring(0, 10) : '',
    isCompleted: goal.isCompleted,
  }
}

async function saveEdit(id) {
  await updateSavingGoal(id, editBuffer.value)
  editingId.value = null
  await load()
}

async function toggleComplete(goal) {
  await updateSavingGoal(goal._id, { isCompleted: !goal.isCompleted })
  await load()
}

async function remove(id) {
  await deleteSavingGoal(id)
  if (openContribId.value === id) openContribId.value = null
  await load()
}

// ─── Contributions (lecture seule — gestion depuis le sheet) ──
async function openContribs(goalId) {
  if (openContribId.value === goalId) { openContribId.value = null; return }
  openContribId.value = goalId
  contributions.value = (await getContributions(goalId)).data
}

// ─── Helpers ─────────────────────────────────────────────
function progressPct(goal) {
  if (!goal.targetAmount) return 0
  return Math.min(100, Math.round((goalCurrentAmount(goal) / goal.targetAmount) * 100))
}

function progressColor(pct) {
  if (pct >= 100) return '#16a34a'
  if (pct >= 60) return '#7c3aed'
  return '#f59e0b'
}

// fmt() et fmtDate() viennent de @/utils/formatters.js

function monthsUntil(deadline) {
  if (!deadline) return null
  const now = new Date()
  const end = new Date(deadline)
  const months = (end.getFullYear() - now.getFullYear()) * 12 + (end.getMonth() - now.getMonth())
  return months > 0 ? months : 0
}

function monthlyInstallment(goal) {
  const months = monthsUntil(goal.deadline)
  if (months === null || months === 0) return null
  const remaining = (goal.targetAmount || 0) - goalCurrentAmount(goal)
  if (remaining <= 0) return 0
  return Math.ceil((remaining / months) * 100) / 100
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Objectifs d'épargne</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Suis tes projets et la progression de tes économies</p>
      </div>
      <button
        class="flex items-center gap-1.5 px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-[7px] text-[13px] font-medium cursor-pointer border-none"
        @click="showAddForm = !showAddForm"
      >
        <font-awesome-icon icon="plus" /> Ajouter
      </button>
    </div>

    <!-- Formulaire ajout -->
    <div v-if="showAddForm" class="glass-card px-5 py-[18px] mb-5">
      <h3 class="text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-3.5">Nouvel objectif</h3>
      <div class="grid gap-2.5" style="grid-template-columns: 1fr 160px 130px 150px 140px">
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Nom</label>
          <input v-model="newGoal.name" class="px-2.5 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none" placeholder="Ex: Voyage au Japon" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Compte</label>
          <select v-model="newGoal.account" class="px-2 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:outline-none cursor-pointer">
            <option value="">— Choisir —</option>
            <option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option>
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Objectif (€)</label>
          <input v-model.number="newGoal.targetAmount" type="number" class="px-2.5 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Déjà disponible (€)</label>
          <input v-model.number="newGoal.initialAmount" type="number" class="px-2.5 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Date cible</label>
          <input v-model="newGoal.deadline" type="date" class="px-2.5 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none" />
        </div>
      </div>
      <div class="flex gap-2 mt-3">
        <button class="flex items-center gap-1.5 px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-[7px] text-[13px] font-medium cursor-pointer border-none" @click="add">Créer</button>
        <button class="px-3 py-1.5 bg-transparent text-gray-500 border border-gray-200 dark:border-gray-700 rounded-[6px] text-[12.5px] cursor-pointer" @click="showAddForm = false">Annuler</button>
      </div>
    </div>

    <!-- Liste des objectifs -->
    <div class="flex flex-col gap-3.5">
      <div
        v-for="goal in goals"
        :key="goal._id"
        class="glass-card px-[18px] py-4"
        :class="{ 'opacity-70': goal.isCompleted }"
      >

        <!-- Mode édition -->
        <template v-if="editingId === goal._id">
          <div class="grid gap-2.5" style="grid-template-columns: 1fr 160px 130px 150px 140px">
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Nom</label>
              <input v-model="editBuffer.name" class="px-2.5 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Compte</label>
              <select v-model="editBuffer.account" class="px-2 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:outline-none cursor-pointer">
                <option value="">—</option>
                <option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option>
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Objectif (€)</label>
              <input v-model.number="editBuffer.targetAmount" type="number" class="px-2.5 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Déjà disponible (€)</label>
              <input v-model.number="editBuffer.initialAmount" type="number" class="px-2.5 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-gray-500 dark:text-gray-400">Date cible</label>
              <input v-model="editBuffer.deadline" type="date" class="px-2.5 py-[7px] border border-gray-200 dark:border-gray-700 rounded-[6px] text-[13px] text-gray-950 dark:text-gray-50 bg-gray-50 dark:bg-gray-700/50 focus:border-violet-500 dark:focus:border-violet-400 focus:outline-none" />
            </div>
          </div>
          <div class="flex gap-2 mt-2.5">
            <button class="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-[6px] text-[12.5px] font-medium cursor-pointer border-none" @click="saveEdit(goal._id)"><font-awesome-icon icon="check" /> Sauver</button>
            <button class="px-3 py-1.5 bg-transparent text-gray-500 border border-gray-200 dark:border-gray-700 rounded-[6px] text-[12.5px] cursor-pointer" @click="editingId = null">Annuler</button>
          </div>
        </template>

        <!-- Mode lecture -->
        <template v-else>
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2.5 flex-wrap">
              <span v-if="goal.isCompleted" class="text-[11px] font-semibold bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">✓ Atteint</span>
              <span class="text-[15px] font-semibold text-gray-950 dark:text-gray-50">{{ goal.name }}</span>
              <span class="text-[12px] text-gray-400">{{ goal.account?.name }}</span>
              <span class="text-[12px] text-gray-400">🗓 {{ fmtDate(goal.deadline) }}</span>
              <span v-if="monthlyInstallment(goal) !== null && !goal.isCompleted" class="text-[12.5px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 px-2 py-0.5 rounded-full">
                <template v-if="monthlyInstallment(goal) === 0">Objectif atteint</template>
                <template v-else-if="monthsUntil(goal.deadline) === 0">Délai dépassé</template>
                <template v-else>
                  {{ fmt(monthlyInstallment(goal)) }} €/mois
                  <span class="font-normal text-gray-500 dark:text-gray-400">({{ monthsUntil(goal.deadline) }} mois restants)</span>
                </template>
              </span>
            </div>
            <div class="flex gap-1.5">
              <button
                class="w-7 h-7 flex items-center justify-center border-none rounded-[6px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer text-[12px] hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                :title="goal.isCompleted ? 'Marquer non atteint' : 'Marquer atteint'"
                @click="toggleComplete(goal)"
              >
                <font-awesome-icon :icon="goal.isCompleted ? 'xmark' : 'check'" />
              </button>
              <button
                class="w-7 h-7 flex items-center justify-center border-none rounded-[6px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer text-[12px] hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                @click="startEdit(goal)" title="Modifier"
              >
                <font-awesome-icon icon="pen" />
              </button>
              <button
                class="w-7 h-7 flex items-center justify-center border-none rounded-[6px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-pointer text-[12px] hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500"
                @click="remove(goal._id)" title="Supprimer"
              >
                <font-awesome-icon icon="trash" />
              </button>
            </div>
          </div>

          <!-- Barre de progression -->
          <div class="mb-2.5">
            <div class="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-1">
              <div
                class="h-full rounded-full transition-[width] duration-400"
                :style="{ width: progressPct(goal) + '%', background: progressColor(progressPct(goal)) }"
              ></div>
            </div>
            <div class="flex justify-between text-[12px] text-gray-500 dark:text-gray-400">
              <span>{{ fmt(goalCurrentAmount(goal)) }} €</span>
              <span class="font-semibold" :style="{ color: progressColor(progressPct(goal)) }">{{ progressPct(goal) }}%</span>
              <span>{{ fmt(goal.targetAmount) }} €</span>
            </div>
          </div>

          <!-- Toggle contributions -->
          <button
            class="flex items-center gap-2 bg-transparent border-none text-[12.5px] text-gray-500 dark:text-gray-400 cursor-pointer py-1 px-0 hover:text-gray-700 dark:hover:text-gray-200"
            @click="openContribs(goal._id)"
          >
            {{ openContribId === goal._id ? '▲ Masquer' : '▼ Contributions' }}
            <span class="text-[11.5px] text-gray-400">{{ fmt(goal.totalContributed) }} € versés</span>
          </button>

          <!-- Panneau contributions (lecture seule) -->
          <div v-if="openContribId === goal._id" class="mt-2.5 border-t border-gray-100 dark:border-gray-700 pt-3">
            <p class="text-[12px] text-gray-400 mb-2.5">Les versements se gèrent depuis le <strong>Sheet du mois</strong>.</p>
            <div v-if="contributions.length" class="flex flex-col gap-1">
              <div v-for="c in contributions" :key="c._id" class="flex items-center gap-3 px-2 py-[5px] bg-gray-50 dark:bg-gray-700/50 rounded-[6px] text-[12.5px]">
                <span class="text-gray-400 min-w-[80px]">{{ fmtDate(c.date) }}</span>
                <span class="font-semibold text-green-600 dark:text-green-400 min-w-[80px]">+{{ fmt(c.amount) }} €</span>
                <span class="flex-1 text-gray-500 dark:text-gray-400">{{ c.notes }}</span>
              </div>
            </div>
            <p v-else class="text-[12px] text-gray-300 dark:text-gray-600 text-center py-2">Aucun versement</p>
          </div>
        </template>

      </div>
      <p v-if="goals.length === 0" class="text-center text-gray-300 dark:text-gray-600 text-[13px] py-8">Aucun objectif — clique sur Ajouter pour commencer</p>
    </div>
  </div>
</template>
