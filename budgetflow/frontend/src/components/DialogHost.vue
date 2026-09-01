<script setup>
import { ref, watch, nextTick } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { useDialogState } from '@/composables/useDialog.js'

const state = useDialogState()
const promptInput = ref(null)

function closeConfirm(result) {
  const c = state.confirm
  state.confirm = null
  c?.resolve(result)
}
function closePrompt(result) {
  const p = state.prompt
  state.prompt = null
  p?.resolve(result)
}
watch(() => state.prompt, async (p) => {
  if (p) { await nextTick(); promptInput.value?.focus(); promptInput.value?.select() }
})
</script>

<template>
  <!-- Confirmation -->
  <AppModal :open="!!state.confirm" :title="state.confirm?.title || ''" @close="closeConfirm(false)">
    <p class="text-[13.5px] text-gray-700 whitespace-pre-line">{{ state.confirm?.message }}</p>
    <template #footer>
      <button class="dlg-btn" :class="state.confirm?.danger ? 'dlg-btn--danger' : 'dlg-btn--primary'" @click="closeConfirm(true)">{{ state.confirm?.confirmLabel }}</button>
      <button class="dlg-btn dlg-btn--secondary" @click="closeConfirm(false)">{{ state.confirm?.cancelLabel }}</button>
    </template>
  </AppModal>

  <!-- Saisie -->
  <AppModal :open="!!state.prompt" :title="state.prompt?.title || ''" @close="closePrompt(null)">
    <div v-if="state.prompt" class="flex flex-col gap-3">
      <p v-if="state.prompt.message" class="text-[13.5px] text-gray-700 whitespace-pre-line">{{ state.prompt.message }}</p>
      <label class="flex flex-col gap-1 text-xs font-medium text-gray-500">
        <span v-if="state.prompt.label">{{ state.prompt.label }}</span>
        <input ref="promptInput" v-model="state.prompt.value" type="text" class="dlg-input" :placeholder="state.prompt.placeholder" @keyup.enter="closePrompt(state.prompt.value)" />
      </label>
    </div>
    <template #footer>
      <button class="dlg-btn dlg-btn--primary" @click="closePrompt(state.prompt?.value ?? '')">{{ state.prompt?.confirmLabel }}</button>
      <button class="dlg-btn dlg-btn--secondary" @click="closePrompt(null)">Annuler</button>
    </template>
  </AppModal>

  <!-- Toasts -->
  <Teleport to="body">
    <div class="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 max-w-sm">
      <div
        v-for="t in state.toasts"
        :key="t.id"
        class="rounded-xl shadow-lg px-4 py-3 text-[13px] border"
        :class="t.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : t.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-stone-200 text-gray-700'"
      >{{ t.message }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
@reference "@/style.css";

.dlg-btn { @apply py-1.5 px-3.5 rounded-md text-[13px] font-medium cursor-pointer; }
.dlg-btn--primary { @apply bg-violet-600 hover:bg-violet-700 text-white; }
.dlg-btn--danger { @apply bg-red-500 hover:bg-red-600 text-white; }
.dlg-btn--secondary { @apply bg-white border border-stone-200 hover:bg-stone-100 text-gray-600; }
.dlg-input { @apply py-1.5 px-2.5 border border-stone-200 rounded-md text-[13px] text-gray-900 bg-stone-50 outline-none focus:border-violet-400; }
</style>
