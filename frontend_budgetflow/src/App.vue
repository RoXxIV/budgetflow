<script setup>
import { useRoute } from 'vue-router'
import { useDarkMode } from '@/composables/useDarkMode.js'

const route = useRoute()
const { isDark, toggleDark } = useDarkMode()

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
  <div class="flex h-screen overflow-hidden">

    <!-- ─── Sidebar ─────────────────────────────────────────── -->
    <aside class="w-[220px] min-w-[220px] bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col py-4 px-3">

      <!-- Logo -->
      <div class="flex items-center gap-2.5 px-2.5 pb-5 pt-2 font-semibold text-[15px] text-gray-950 dark:text-gray-100">
        <span class="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center text-white text-[13px]">
          <font-awesome-icon icon="wallet" />
        </span>
        <span>BudgetFlow</span>
      </div>

      <!-- Navigation principale -->
      <nav class="flex flex-col gap-0.5 flex-1">
        <router-link
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13.5px] transition-colors duration-150"
          :class="route.path === link.to
            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-medium'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-950 dark:hover:text-gray-100'"
        >
          <font-awesome-icon :icon="link.icon" class="w-[15px] text-center text-[13px]" />
          <span>{{ link.name }}</span>
        </router-link>
      </nav>

      <!-- Bas de sidebar : Paramètres + toggle dark mode -->
      <div class="border-t border-gray-200 dark:border-gray-700 pt-2.5 mt-2.5 flex flex-col gap-0.5">
        <router-link
          to="/parametres"
          class="flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13.5px] transition-colors duration-150"
          :class="route.path === '/parametres'
            ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-medium'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-950 dark:hover:text-gray-100'"
        >
          <font-awesome-icon icon="gear" class="w-[15px] text-center text-[13px]" />
          <span>Paramètres</span>
        </router-link>

        <!-- Toggle thème clair / sombre -->
        <button
          @click="toggleDark"
          class="flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13.5px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-950 dark:hover:text-gray-100 transition-colors duration-150 w-full cursor-pointer border-none bg-transparent"
        >
          <font-awesome-icon :icon="isDark ? 'sun' : 'moon'" class="w-[15px] text-center text-[13px]" />
          <span>{{ isDark ? 'Thème clair' : 'Thème sombre' }}</span>
        </button>
      </div>
    </aside>

    <!-- ─── Contenu principal ────────────────────────────────── -->
    <main class="flex-1 overflow-y-auto px-9 py-8 bg-[#f7f7f5] dark:bg-gray-950">
      <router-view />
    </main>

  </div>
</template>
