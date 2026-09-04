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
  <!-- Confirmation : toujours au-dessus des modales d'édition (z 50) -->
  <AppModal :open="!!state.confirm" :title="state.confirm?.title || ''" :z="70" @close="closeConfirm(false)">
    <p class="dlg-message whitespace-pre-line">{{ state.confirm?.message }}</p>
    <template #footer>
      <button class="dlg-btn" :class="state.confirm?.danger ? 'dlg-btn--danger' : 'dlg-btn--primary'" @click="closeConfirm(true)">{{ state.confirm?.confirmLabel }}</button>
      <button class="dlg-btn dlg-btn--secondary" @click="closeConfirm(false)">{{ state.confirm?.cancelLabel }}</button>
    </template>
  </AppModal>

  <!-- Saisie -->
  <AppModal :open="!!state.prompt" :title="state.prompt?.title || ''" :z="70" @close="closePrompt(null)">
    <div v-if="state.prompt" class="flex flex-col gap-3">
      <p v-if="state.prompt.message" class="dlg-message whitespace-pre-line">{{ state.prompt.message }}</p>
      <label class="dlg-field">
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
        class="dlg-toast"
        :class="t.type === 'error' ? 'is-error' : t.type === 'success' ? 'is-success' : ''"
      >{{ t.message }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
.dlg-message { font-size: 13.5px; color: var(--c-ink-2); }
.dlg-field { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); }
.dlg-btn { height: 32px; padding: 0 var(--s-4); border-radius: var(--r-control); font-size: 13px; font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.dlg-btn--primary { background: var(--c-accent); color: var(--c-on-accent); }
.dlg-btn--primary:hover { background: var(--c-accent-hover); }
.dlg-btn--danger { background: var(--c-over); color: var(--c-on-accent); }
.dlg-btn--danger:hover { filter: brightness(0.92); }
.dlg-btn--secondary { background: var(--c-surface); border: 1px solid var(--c-line-strong); color: var(--c-ink); }
.dlg-btn--secondary:hover { background: var(--c-surface-hover); }
.dlg-input { padding: 6px var(--s-3); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); font-size: 13px; color: var(--c-ink); background: var(--c-surface); outline: none; font-family: var(--font-ui); }
.dlg-input:focus { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.dlg-toast {
  border-radius: var(--r-container); box-shadow: var(--shadow-overlay);
  padding: var(--s-3) var(--s-4); font-size: 13px;
  background: var(--c-surface); border: 1px solid var(--c-line); color: var(--c-ink-2);
}
.dlg-toast.is-error { background: var(--c-over-soft); border-color: var(--c-over); color: var(--c-over); }
.dlg-toast.is-success { background: var(--c-credit-soft); border-color: var(--c-credit); color: var(--c-credit); }
</style>
