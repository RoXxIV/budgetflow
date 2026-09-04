<script setup>
import { onMounted, onUnmounted } from 'vue'

// Modal générique : props open/title, slot par défaut (corps) et slot footer (boutons).
// Échap et clic sur le fond ferment (émet 'close').
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape' && props.open) emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-scrim fixed inset-0 z-50 flex items-center justify-center px-4 py-6" @mousedown.self="emit('close')">
      <div class="modal-panel w-full flex flex-col max-h-[calc(100vh-3rem)]" :class="wide ? 'max-w-3xl' : 'max-w-xl'">
        <div class="modal-head flex items-center gap-3 px-5 py-3.5">
          <h3 class="text-[15px] font-semibold">{{ title }}</h3>
          <button class="modal-x ml-auto" title="Fermer (Échap)" @click="emit('close')">×</button>
        </div>
        <div class="px-5 py-4 overflow-y-auto">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-foot flex gap-2 px-5 py-3">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-scrim { background: rgba(10, 16, 14, 0.45); }
.modal-panel {
  background: var(--c-surface);
  color: var(--c-ink);
  border: 1px solid var(--c-line);
  border-radius: var(--r-container);
  box-shadow: var(--shadow-overlay);
}
.modal-head { border-bottom: 1px solid var(--c-line); }
.modal-x {
  width: 28px; height: 28px; border-radius: var(--r-control);
  color: var(--c-ink-3); font-size: 15px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.modal-x:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.modal-foot {
  border-top: 1px solid var(--c-line);
  background: var(--c-surface-sunken);
  border-radius: 0 0 var(--r-container) var(--r-container);
}
</style>
