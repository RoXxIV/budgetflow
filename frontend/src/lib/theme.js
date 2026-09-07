// Thème clair / sombre / système — data-theme="dark" sur <html> déclenche le bloc
// sombre de tokens.css. La préférence vit dans localStorage (un pré-script dans
// index.html l'applique avant la première peinture pour éviter le flash blanc).
const KEY = 'budgetflow.theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export const THEME_OPTIONS = [
  { value: 'system', label: 'Système' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
]

/**
 * Lit la préférence enregistrée.
 *
 * Toute valeur inattendue (absente, corrompue, d'une ancienne version) retombe sur
 * « système » plutôt que d'imposer un thème arbitraire.
 *
 * @returns {'system'|'light'|'dark'} La préférence courante.
 */
export function getThemePref() {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

/**
 * Applique un thème au document.
 *
 * Le mode « système » est résolu ici, à partir de la requête média : l'attribut posé
 * sur <html> ne vaut jamais « system », toujours « dark » ou « light », puisque
 * tokens.css n'attend que ces deux-là.
 *
 * @param {'system'|'light'|'dark'} pref La préférence à traduire en thème effectif.
 */
function apply(pref) {
  const dark = pref === 'dark' || (pref === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

/**
 * Enregistre une préférence et l'applique aussitôt.
 *
 * @param {'system'|'light'|'dark'} pref Le choix de l'utilisateur.
 */
export function setThemePref(pref) {
  localStorage.setItem(KEY, pref)
  apply(pref)
}

/**
 * Met en place le thème au démarrage de l'application (appelé par main.js).
 *
 * Applique la préférence, puis suit les changements du système : passer son OS en
 * sombre le soir bascule l'app en direct, mais seulement si l'utilisateur n'a pas
 * choisi un thème fixe.
 */
export function initTheme() {
  apply(getThemePref())
  media.addEventListener('change', () => { if (getThemePref() === 'system') apply('system') })
}
