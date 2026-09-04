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
      class="tip-btn w-4 h-4 rounded-full text-[10px] leading-none flex items-center justify-center cursor-help"
      aria-label="Aide"
      @click.stop.prevent="open = !open"
    >?</button>
    <span
      v-if="open"
      class="tip-bubble absolute left-0 top-5 z-40 text-[12px] leading-snug px-3 py-2 font-normal normal-case tracking-normal"
      :class="wide ? 'w-80' : 'w-64'"
    >{{ text }}</span>
  </span>
</template>

<style scoped>
.tip-btn { border: 1px solid var(--c-line-strong); color: var(--c-ink-3); }
.tip-btn:hover { border-color: var(--c-accent); color: var(--c-accent); }
/* Infobulle inversée : encre sur toile, lisible dans les deux thèmes */
.tip-bubble {
  background: var(--c-ink);
  color: var(--c-canvas);
  border-radius: var(--r-control);
  box-shadow: var(--shadow-overlay);
}
</style>
