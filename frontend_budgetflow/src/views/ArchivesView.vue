<script setup>
import { ref, computed, onMounted } from 'vue'
import { getSheets, deleteSheet } from '@/api/sheets.js'

const sheets = ref([])
const confirmDeleteId = ref(null)
const deleting = ref(false)

onMounted(async () => { await load() })

async function load() {
  sheets.value = (await getSheets()).data
}

const sortedSheets = computed(() =>
  [...sheets.value].sort((a, b) => new Date(b.periodMonth) - new Date(a.periodMonth))
)

function askDelete(id) {
  confirmDeleteId.value = id
}

function cancelDelete() {
  confirmDeleteId.value = null
}

async function confirmDelete() {
  if (!confirmDeleteId.value || deleting.value) return
  deleting.value = true
  try {
    await deleteSheet(confirmDeleteId.value)
    confirmDeleteId.value = null
    await load()
  } finally {
    deleting.value = false
  }
}

const statusLabel = { active: 'Actif', draft: 'Brouillon', archived: 'Archivé' }

function fmtPeriod(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const sheetToDelete = computed(() =>
  sheets.value.find((s) => s._id === confirmDeleteId.value)
)
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Archives</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Historique de tous vos sheets mensuels</p>
      </div>
    </div>

    <!-- Modale confirmation suppression -->
    <div
      v-if="confirmDeleteId"
      class="fixed inset-0 bg-black/40 flex items-center justify-center z-1000"
      @click.self="cancelDelete"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl px-8 py-7 max-w-110 w-[90%] flex flex-col items-center gap-3.5 text-center shadow-[0_8px_32px_rgba(0,0,0,0.18)]">
        <div class="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/30 text-red-500 flex items-center justify-center text-[20px]">
          <font-awesome-icon icon="triangle-exclamation" />
        </div>
        <h3 class="text-[16px] font-bold text-gray-950 dark:text-gray-50 m-0">Supprimer ce sheet ?</h3>
        <p class="text-[13.5px] text-gray-500 dark:text-gray-400 leading-relaxed m-0">
          <strong>{{ sheetToDelete?.name || fmtPeriod(sheetToDelete?.periodMonth) }}</strong><br />
          Cette action est <strong>irréversible</strong>. Toutes les données associées seront supprimées définitivement :
          lignes budgétaires, snapshots, versements objectifs, transactions investissement, relevés compteurs.
        </p>
        <div class="flex gap-2.5 w-full justify-center mt-1">
          <button
            class="px-4.5 py-2 border border-gray-200 dark:border-gray-700 rounded-[7px] bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[13px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="cancelDelete"
            :disabled="deleting"
          >Annuler</button>
          <button
            class="flex items-center gap-1.75 px-4.5 py-2 border-none rounded-[7px] bg-red-500 hover:bg-red-600 text-white text-[13px] font-medium cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            @click="confirmDelete"
            :disabled="deleting"
          >
            <font-awesome-icon icon="trash" />
            {{ deleting ? 'Suppression…' : 'Supprimer définitivement' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Liste des sheets -->
    <div v-if="sortedSheets.length" class="flex flex-col gap-2">
      <div
        v-for="sheet in sortedSheets"
        :key="sheet._id"
        class="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-4.5 py-3.5 gap-4"
      >
        <div class="flex flex-col gap-1 flex-1">
          <div class="text-[14.5px] font-semibold text-gray-950 dark:text-gray-50">{{ sheet.name || fmtPeriod(sheet.periodMonth) }}</div>
          <div class="flex gap-3 text-[12px] text-gray-400">
            <span>{{ fmtPeriod(sheet.periodMonth) }}</span>
            <span>Créé le {{ fmtDate(sheet.createdAt) }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2.5">
          <!-- Badge statut -->
          <span
            class="text-[11px] font-semibold px-2.25 py-0.5 rounded-full"
            :class="{
              'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400': sheet.status === 'active',
              'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400': sheet.status === 'draft',
              'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400': sheet.status === 'archived',
            }"
          >
            {{ statusLabel[sheet.status] || sheet.status }}
          </span>
          <!-- Bouton voir -->
          <router-link
            :to="'/sheet?id=' + sheet._id"
            class="flex items-center gap-1.25 px-3 py-1.25 border border-gray-200 dark:border-gray-700 rounded-[7px] bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 text-[12.5px] font-medium cursor-pointer no-underline hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Voir ce sheet"
          >
            <font-awesome-icon icon="eye" /> Voir
          </router-link>
          <!-- Bouton supprimer -->
          <button
            class="w-7.5 h-7.5 flex items-center justify-center border border-red-200 dark:border-red-900/50 rounded-[7px] bg-red-50 dark:bg-red-900/20 text-red-500 cursor-pointer text-[12px] hover:bg-red-100 dark:hover:bg-red-900/30"
            title="Supprimer ce sheet"
            @click="askDelete(sheet._id)"
          >
            <font-awesome-icon icon="trash" />
          </button>
        </div>
      </div>
    </div>

    <p v-else class="text-center text-gray-300 dark:text-gray-600 text-[13px] py-12">Aucun sheet trouvé.</p>
  </div>
</template>
