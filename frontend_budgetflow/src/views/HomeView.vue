<script setup>
import { ref, computed, onMounted } from 'vue'
import { getAccounts } from '@/api/accounts.js'
import { getSheets, getSheetSnapshots, getSheetLines, getSheetContributions, getSheetInvestmentTransactions } from '@/api/sheets.js'
import { getSettings } from '@/api/settings.js'
import { getSavingGoals } from '@/api/savingGoals.js'
import { formatCurrency } from '@/utils/formatters.js'
import { buildSnapshotMap, computeAccountDeltaMap, resolveBalance } from '@/utils/liveBalances.js'

// ─── État ────────────────────────────────────────────────────
const accounts = ref([])
const snapshots = ref([])
const lines = ref([])
const contributions = ref([])
const investmentTxs = ref([])
const goals = ref([])
const settings = ref(null)

// Labels et icônes par type de compte
const typeLabel = { bank: 'Courant', savings: 'Épargne', cash: 'Espèces' }
const typeIcon = { bank: 'building-columns', savings: 'piggy-bank', cash: 'money-bill' }

// ─── Chargement ──────────────────────────────────────────────
onMounted(async () => {
  const [accRes, sheetsRes, settingsRes, goalsRes] = await Promise.all([
    getAccounts(), getSheets(), getSettings(), getSavingGoals(),
  ])
  accounts.value = accRes.data
  settings.value = settingsRes.data
  goals.value = goalsRes.data

  // Charger les données du sheet actif pour les soldes temps réel
  const active = sheetsRes.data.find((s) => s.status === 'active')
  if (active) {
    const [sRes, lRes, cRes, iRes] = await Promise.all([
      getSheetSnapshots(active._id),
      getSheetLines(active._id),
      getSheetContributions(active._id),
      getSheetInvestmentTransactions(active._id),
    ])
    snapshots.value = sRes.data
    lines.value = lRes.data
    contributions.value = cRes.data
    investmentTxs.value = iRes.data
  }
})

// ─── Soldes temps réel ───────────────────────────────────────
const snapshotMap = computed(() => buildSnapshotMap(snapshots.value))

const liveAccounts = computed(() => {
  const mainAccountId = settings.value?.mainAccount?._id || settings.value?.mainAccount || null
  const deltaMap = computeAccountDeltaMap({
    lines: lines.value,
    contributions: contributions.value,
    investmentTxs: investmentTxs.value,
    goals: goals.value,
    mainAccountId,
  })
  return accounts.value.map((account) => ({
    ...account,
    balance: resolveBalance(snapshotMap.value, deltaMap, account._id),
  }))
})

// Patrimoine total : somme des comptes inclus dans le bilan net
const totalPatrimoine = computed(() =>
  liveAccounts.value
    .filter((a) => a.includeInNetWorth)
    .reduce((sum, a) => sum + (a.balance ?? 0), 0)
)

// ─── Navigation rapide ───────────────────────────────────────
const quickLinks = [
  { label: 'Éditer le template', description: 'Gérer les lignes budgétaires par défaut', icon: 'table-list', to: '/template', color: '#7c3aed', bg: '#f5f3ff', darkBg: 'rgba(124,58,237,0.15)' },
  { label: 'Objectifs', description: "Suivre vos objectifs d'épargne", icon: 'bullseye', to: '/objectifs', color: '#16a34a', bg: '#f0fdf4', darkBg: 'rgba(22,163,74,0.15)' },
  { label: 'Investissements', description: 'ETF, crypto, actions — suivi DCA', icon: 'arrow-trend-up', to: '/investissements', color: '#7c3aed', bg: '#f5f3ff', darkBg: 'rgba(124,58,237,0.15)' },
  { label: 'Statistiques', description: 'Analyse de vos dépenses et revenus', icon: 'chart-bar', to: '/statistiques', color: '#ea580c', bg: '#fff7ed', darkBg: 'rgba(234,88,12,0.15)' },
  { label: 'Archives', description: 'Consulter les mois précédents', icon: 'box-archive', to: '/archives', color: '#6b7280', bg: '#f9fafb', darkBg: 'rgba(107,114,128,0.15)' },
  { label: 'Paramètres', description: 'Comptes, arrondi, devise...', icon: 'gear', to: '/parametres', color: '#0891b2', bg: '#ecfeff', darkBg: 'rgba(8,145,178,0.15)' },
]
// formatCurrency() vient de @/utils/formatters.js
</script>

<template>
  <div>

    <!-- ─── En-tête ─────────────────────────────────────────── -->
    <div class="flex items-start justify-between mb-7">
      <div>
        <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Tableau de bord</h1>
        <p class="text-[13px] text-gray-400 mt-0.75">Vue d'ensemble de votre activité</p>
      </div>
      <router-link
        to="/sheet/nouveau"
        class="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2.25 text-[13.5px] font-medium transition-colors whitespace-nowrap"
      >
        <font-awesome-icon icon="plus" />
        Nouveau sheet
      </router-link>
    </div>

    <!-- ─── Carte patrimoine + comptes ──────────────────────── -->
    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-5.5 py-5 mb-6">

      <!-- Patrimoine total -->
      <div class="flex items-baseline justify-between mb-4">
        <div class="flex items-center gap-2">
          <font-awesome-icon icon="wallet" class="text-gray-400 text-[13px]" />
          <span class="text-xs font-medium text-gray-400 uppercase tracking-[0.05em]">Patrimoine total</span>
        </div>
        <div class="text-[32px] font-bold text-gray-950 dark:text-gray-50 tracking-[-0.5px]">
          {{ formatCurrency(totalPatrimoine) }}
        </div>
      </div>

      <div class="h-px bg-gray-100 dark:bg-gray-700 mb-4" />

      <!-- Grille des comptes -->
      <div class="grid grid-cols-2 gap-2">
        <div
          v-for="account in liveAccounts"
          :key="account._id"
          class="flex justify-between items-center px-2.5 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
        >
          <div class="flex items-center gap-2.25">
            <font-awesome-icon
              :icon="typeIcon[account.type] || 'building-columns'"
              class="text-gray-400 text-xs w-3.5"
            />
            <span class="text-[13.5px] text-gray-700 dark:text-gray-200 font-medium">{{ account.name }}</span>
            <span class="text-[11px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded px-1.5 py-px">
              {{ typeLabel[account.type] || account.type }}
            </span>
          </div>
          <span
            class="text-[13.5px] font-semibold"
            :class="account.balance !== null ? 'text-gray-950 dark:text-gray-100' : 'text-gray-300'"
          >
            {{ account.balance !== null ? formatCurrency(account.balance) : '—' }}
          </span>
        </div>
      </div>
    </div>

    <!-- ─── Accès rapide ─────────────────────────────────────── -->
    <p class="text-xs font-semibold text-gray-400 uppercase tracking-[0.06em] mb-3">Accès rapide</p>
    <div class="grid grid-cols-3 gap-3">
      <router-link
        v-for="link in quickLinks"
        :key="link.to"
        :to="link.to"
        class="flex items-center gap-3.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4.5 py-4 transition-[border-color,box-shadow] hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm"
      >
        <div
          class="w-9.5 h-9.5 rounded-[9px] flex items-center justify-center text-[15px] shrink-0"
          :style="{ background: link.bg, color: link.color }"
        >
          <font-awesome-icon :icon="link.icon" />
        </div>
        <div class="flex flex-col gap-0.75 flex-1">
          <span class="text-[13.5px] font-semibold text-gray-950 dark:text-gray-100">{{ link.label }}</span>
          <span class="text-xs text-gray-400">{{ link.description }}</span>
        </div>
        <font-awesome-icon icon="chevron-right" class="text-gray-300 text-[11px]" />
      </router-link>
    </div>

  </div>
</template>
