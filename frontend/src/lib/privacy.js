// Mode discret : floute tous les chiffres (classe .num, portée par chaque montant du
// registre). L'état vit sur <html data-privacy> + localStorage — il survit au
// rechargement, ce qui est le sens même d'un mode « écran partagé / transport ».
const KEY = 'budgetflow.privacy'

/**
 * Le mode discret est-il actif ?
 *
 * @returns {boolean} true si les montants doivent être floutés.
 */
export function getPrivacy() {
  return localStorage.getItem(KEY) === 'on'
}

/**
 * Active ou coupe le mode discret, et le retient.
 *
 * L'attribut sur <html> suffit à tout flouter d'un coup : le floutage est une règle
 * CSS unique (`[data-privacy='on'] .num`), aucune vue n'a à s'en préoccuper. C'est
 * aussi pourquoi tout nouveau montant affiché doit porter la classe .num.
 *
 * @param {boolean} on true pour flouter, false pour réafficher.
 */
export function setPrivacy(on) {
  localStorage.setItem(KEY, on ? 'on' : 'off')
  document.documentElement.dataset.privacy = on ? 'on' : 'off'
}

/**
 * Rétablit le mode discret au démarrage (appelé par main.js).
 *
 * Sans cet appel, l'app rouvrirait tous les montants en clair après un rechargement
 * — l'inverse de ce qu'on attend d'un mode « écran partagé ».
 */
export function initPrivacy() {
  document.documentElement.dataset.privacy = getPrivacy() ? 'on' : 'off'
}
