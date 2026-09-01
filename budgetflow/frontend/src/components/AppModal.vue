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
    <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center bg-gray-900/40 px-4 py-10 overflow-y-auto" @mousedown.self="emit('close')">
      <div class="bg-white rounded-2xl shadow-xl w-full flex flex-col max-h-[calc(100vh-5rem)]" :class="wide ? 'max-w-3xl' : 'max-w-xl'">
        <div class="flex items-center gap-3 px-5 py-3.5 border-b border-stone-100">
          <h3 class="text-[15px] font-semibold">{{ title }}</h3>
          <button class="ml-auto w-7 h-7 rounded-md hover:bg-stone-100 text-gray-400 cursor-pointer text-[15px]" title="Fermer (Échap)" @click="emit('close')">×</button>
        </div>
        <div class="px-5 py-4 overflow-y-auto">
          <slot />
        </div>
        <div v-if="$slots.footer" class="flex gap-2 px-5 py-3 border-t border-stone-100 bg-stone-50 rounded-b-2xl">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
