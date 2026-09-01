<script setup>
// Aide contextuelle discrète : un ⓘ qui révèle une courte explication au survol ou au clic.
// Le texte est passé en prop ; pas de logique, pas de dépendance.
import { ref } from 'vue'
defineProps({ text: { type: String, required: true }, wide: { type: Boolean, default: false } })
const open = ref(false)
</script>

<template>
  <span class="relative inline-flex items-center align-middle" @mouseenter="open = true" @mouseleave="open = false">
    <button
      type="button"
      class="w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] leading-none flex items-center justify-center cursor-help hover:border-violet-400 hover:text-violet-600"
      aria-label="Aide"
      @click.stop.prevent="open = !open"
    >?</button>
    <span
      v-if="open"
      class="absolute left-0 top-5 z-40 rounded-lg bg-gray-900 text-white text-[12px] leading-snug px-3 py-2 shadow-xl font-normal normal-case tracking-normal"
      :class="wide ? 'w-80' : 'w-64'"
    >{{ text }}</span>
  </span>
</template>
