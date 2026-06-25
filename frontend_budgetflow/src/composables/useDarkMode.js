import { ref, watchEffect } from 'vue'

// État partagé en dehors du composable — une seule instance pour toute l'app
const isDark = ref(localStorage.getItem('theme') === 'dark')

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark)
  localStorage.setItem('theme', dark ? 'dark' : 'light')
}

// Applique le thème au démarrage
applyTheme(isDark.value)

/**
 * Composable pour gérer le thème clair/sombre.
 * L'état est partagé entre tous les composants qui l'utilisent.
 *
 * Usage :
 *   const { isDark, toggleDark } = useDarkMode()
 */
export function useDarkMode() {
  watchEffect(() => applyTheme(isDark.value))

  function toggleDark() {
    isDark.value = !isDark.value
  }

  return { isDark, toggleDark }
}
