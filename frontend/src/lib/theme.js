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

export function getThemePref() {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function apply(pref) {
  const dark = pref === 'dark' || (pref === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function setThemePref(pref) {
  localStorage.setItem(KEY, pref)
  apply(pref)
}

export function initTheme() {
  apply(getThemePref())
  media.addEventListener('change', () => { if (getThemePref() === 'system') apply('system') })
}
