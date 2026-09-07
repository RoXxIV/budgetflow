import { reactive } from 'vue'

// Dialogues globaux (rendus par <DialogHost /> dans App.vue) : confirmation, saisie, toasts.
// Remplacent alert() / confirm() / prompt() par des modals propres et des notifications non bloquantes.
const state = reactive({
  confirm: null, // { title, message, confirmLabel, cancelLabel, danger, resolve }
  prompt: null,  // { title, message, label, placeholder, value, confirmLabel, resolve }
  toasts: [],    // [{ id, type, message }]
})

let toastId = 0

/**
 * Demande une confirmation et attend la réponse de l'utilisateur.
 *
 * Le `resolve` de la promesse est rangé dans l'état partagé : DialogHost affiche la
 * modale, puis l'appelle au clic. On écrit donc du code linéaire — `if (!await
 * confirmDialog(…)) return` — là où il faudrait autrement des rappels imbriqués.
 *
 * @param {object} [options]
 * @param {string} [options.title] Titre de la modale.
 * @param {string} [options.message] Corps du message ; les retours à la ligne sont conservés.
 * @param {string} [options.confirmLabel] Libellé du bouton de validation.
 * @param {string} [options.cancelLabel] Libellé du bouton d'annulation.
 * @param {boolean} [options.danger] Bouton rouge, pour une action irréversible.
 * @returns {Promise<boolean>} true si confirmé, false si annulé ou fermé.
 */
export function confirmDialog({ title = 'Confirmer', message = '', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false } = {}) {
  return new Promise((resolve) => {
    state.confirm = { title, message, confirmLabel, cancelLabel, danger, resolve }
  })
}

/**
 * Demande une saisie libre et attend le texte de l'utilisateur.
 *
 * Même principe que confirmDialog. `defaultValue` devient `value` : DialogHost lie
 * ce champ au <input> et présélectionne son contenu, pour taper par-dessus sans effacer.
 *
 * @param {object} [options]
 * @param {string} [options.title] Titre de la modale.
 * @param {string} [options.message] Explication au-dessus du champ.
 * @param {string} [options.label] Libellé du champ.
 * @param {string} [options.placeholder] Texte grisé du champ vide.
 * @param {string} [options.defaultValue] Valeur proposée, présélectionnée.
 * @param {string} [options.confirmLabel] Libellé du bouton de validation.
 * @returns {Promise<string|null>} Le texte saisi, ou null si annulé.
 */
export function promptDialog({ title = 'Saisie', message = '', label = '', placeholder = '', defaultValue = '', confirmLabel = 'Valider' } = {}) {
  return new Promise((resolve) => {
    state.prompt = { title, message, label, placeholder, value: defaultValue, confirmLabel, resolve }
  })
}

/**
 * Affiche une notification passagère, sans bloquer l'utilisateur.
 *
 * Chaque toast reçoit un identifiant croissant : c'est lui qui permet de retirer le
 * bon au bout du délai, même si plusieurs se sont empilés entre-temps.
 *
 * @param {string} message Le texte à afficher.
 * @param {'info'|'success'|'error'} [type] Habillage de la notification.
 * @param {number} [duration] Durée d'affichage en millisecondes.
 */
export function toast(message, type = 'info', duration = 4500) {
  const id = ++toastId
  state.toasts.push({ id, type, message })
  setTimeout(() => { state.toasts = state.toasts.filter((t) => t.id !== id) }, duration)
}

/**
 * Signale une erreur d'API à l'utilisateur, en toast rouge.
 *
 * Le message du backend passe en premier : il est écrit pour être lu (« Créez d'abord
 * un compte… », « Cette catégorie est utilisée par 3 lignes… ») et vaut mieux qu'un
 * « Request failed with status code 409 ». Les deux replis couvrent une panne réseau
 * puis l'imprévu total.
 *
 * @param {unknown} e L'erreur attrapée, typiquement une erreur axios.
 */
export function apiError(e) {
  toast(e?.response?.data?.message || e?.message || 'Erreur inattendue', 'error', 6000)
}

// Accès direct à l'état, réservé à DialogHost — les vues passent par les fonctions ci-dessus
export function useDialogState() {
  return state
}
