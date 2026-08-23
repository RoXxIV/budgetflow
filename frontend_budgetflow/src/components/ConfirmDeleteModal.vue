<script setup>
import AppModal from './AppModal.vue'

defineProps({
  title: { type: String, default: 'Confirmer la suppression ?' },
  label: { type: String, default: '' }, // nom de l'élément supprimé
  color: { type: String, default: '' }, // pastille de couleur optionnelle
  warning: { type: String, default: '' }, // conséquences spécifiques
})
const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <AppModal :title="title" @close="emit('cancel')">
    <div class="flex flex-col items-center gap-3 text-center">
      <div class="w-11 h-11 rounded-full bg-red-50 dark:bg-red-900/30 text-red-500 flex items-center justify-center text-[18px]">
        <font-awesome-icon icon="triangle-exclamation" />
      </div>
      <p v-if="label" class="text-[14px] font-semibold text-gray-950 dark:text-gray-50 m-0 flex items-center gap-2 justify-center">
        <span v-if="color" class="w-3 h-3 rounded-full inline-block" :style="{ background: color }"></span>
        {{ label }}
      </p>
      <p class="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed m-0">
        <template v-if="warning">{{ warning }} </template>Cette action est irréversible.
      </p>
    </div>
    <template #footer>
      <button
        class="px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-[7px] bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[13px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30"
        @click="emit('cancel')"
      >Annuler</button>
      <button
        class="flex items-center gap-1.5 px-4 py-2 border-none rounded-[7px] bg-red-500 hover:bg-red-600 text-white text-[13px] font-medium cursor-pointer"
        @click="emit('confirm')"
      >
        <font-awesome-icon icon="trash" /> Supprimer
      </button>
    </template>
  </AppModal>
</template>
