import { reactive } from 'vue'

// Dialogues globaux (rendus par <DialogHost /> dans App.vue) : confirmation, saisie, toasts.
// Remplacent alert() / confirm() / prompt() par des modals propres et des notifications non bloquantes.
const state = reactive({
  confirm: null, // { title, message, confirmLabel, cancelLabel, danger, resolve }
  prompt: null,  // { title, message, label, placeholder, value, confirmLabel, resolve }
  toasts: [],    // [{ id, type, message }]
})

let toastId = 0

export function confirmDialog({ title = 'Confirmer', message = '', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false } = {}) {
  return new Promise((resolve) => {
    state.confirm = { title, message, confirmLabel, cancelLabel, danger, resolve }
  })
}

export function promptDialog({ title = 'Saisie', message = '', label = '', placeholder = '', defaultValue = '', confirmLabel = 'Valider' } = {}) {
  return new Promise((resolve) => {
    state.prompt = { title, message, label, placeholder, value: defaultValue, confirmLabel, resolve }
  })
}

export function toast(message, type = 'info', duration = 4500) {
  const id = ++toastId
  state.toasts.push({ id, type, message })
  setTimeout(() => { state.toasts = state.toasts.filter((t) => t.id !== id) }, duration)
}

// Erreur d'API → toast rouge avec le message du backend
export function apiError(e) {
  toast(e?.response?.data?.message || e?.message || 'Erreur inattendue', 'error', 6000)
}

export function useDialogState() {
  return state
}
