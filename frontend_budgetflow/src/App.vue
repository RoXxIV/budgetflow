<script setup>
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useDarkMode } from '@/composables/useDarkMode.js'
import { setCurrency } from '@/composables/useCurrency.js'
import { getSettings } from '@/api/settings.js'

const route = useRoute()
const { isDark, toggleDark } = useDarkMode()

// Charge la devise configurée au démarrage
onMounted(async () => {
  try {
    setCurrency((await getSettings()).data?.currency)
  } catch {
    // backend indisponible : on garde EUR par défaut
  }
})

const navLinks = [
  { name: 'Accueil', icon: 'house', to: '/' },
  { name: 'Sheet du mois', icon: 'calendar-days', to: '/sheet' },
  { name: 'Template', icon: 'table-list', to: '/template' },
  { name: 'Objectifs', icon: 'bullseye', to: '/objectifs' },
  { name: 'Investissements', icon: 'chart-line', to: '/investissements' },
  { name: 'Statistiques', icon: 'chart-bar', to: '/statistiques' },
  { name: 'Archives', icon: 'box-archive', to: '/archives' },
]
</script>

<template>
  <div class="app-shell flex flex-col h-screen overflow-hidden">

    <!-- ─── Header ─────────────────────────────────────────── -->
    <header class="glass-card app-header">
      <!-- Logo -->
      <div class="flex items-center gap-2.5 font-semibold text-[15px] text-gray-950 dark:text-gray-100 shrink-0">
        <span class="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center text-white text-[13px]">
          <font-awesome-icon icon="wallet" />
        </span>
        <span class="hidden lg:inline">BudgetFlow</span>
      </div>

      <!-- Onglets (barre en pilule) -->
      <nav class="nav-pills">
        <router-link
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="nav-pill"
          :class="{ 'nav-pill--active': route.path === link.to }"
        >
          <font-awesome-icon :icon="link.icon" class="nav-pill-icon" />
          <span>{{ link.name }}</span>
        </router-link>
      </nav>

      <!-- Actions à droite -->
      <div class="flex items-center gap-2 shrink-0">
        <router-link
          to="/parametres"
          class="icon-btn"
          :class="{ 'icon-btn--active': route.path === '/parametres' }"
          title="Paramètres"
        >
          <font-awesome-icon icon="gear" />
        </router-link>
        <button
          class="icon-btn"
          @click="toggleDark"
          :title="isDark ? 'Thème clair' : 'Thème sombre'"
        >
          <font-awesome-icon :icon="isDark ? 'sun' : 'moon'" />
        </button>
      </div>
    </header>

    <!-- ─── Contenu principal ────────────────────────────────── -->
    <main class="flex-1 overflow-y-auto px-8 pb-8 pt-4">
      <router-view />
    </main>

  </div>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin: 16px 16px 6px;
  padding: 10px 16px;
  border-radius: 18px;
  flex-shrink: 0;
}

/* Barre d'onglets en pilule */
.nav-pills {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(120, 120, 145, 0.10);
  border-radius: 14px;
  padding: 4px;
  overflow-x: auto;
  scrollbar-width: none;
}
.nav-pills::-webkit-scrollbar {
  display: none;
}
:global(.dark) .nav-pills {
  background: rgba(255, 255, 255, 0.06);
}
.nav-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: 11px;
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
  white-space: nowrap;
  transition: color 0.15s, background 0.15s, box-shadow 0.15s;
}
.nav-pill:hover {
  color: #111827;
}
:global(.dark) .nav-pill {
  color: #9ca3af;
}
:global(.dark) .nav-pill:hover {
  color: #f3f4f6;
}
.nav-pill--active {
  background: #fff;
  color: #111827;
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.10);
}
:global(.dark) .nav-pill--active {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.nav-pill-icon {
  font-size: 12px;
}

/* Boutons icônes ronds à droite */
.icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.7);
  color: #475569;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.icon-btn:hover {
  background: #fff;
  color: #7c3aed;
}
.icon-btn--active {
  color: #7c3aed;
}
:global(.dark) .icon-btn {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.10);
  color: #cbd5e1;
}
:global(.dark) .icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #c4b5fd;
}
:global(.dark) .icon-btn--active {
  color: #c4b5fd;
}
</style>
