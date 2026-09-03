<script setup>
import { useRoute } from 'vue-router'
import DialogHost from '@/components/DialogHost.vue'

const route = useRoute()

const navLinks = [
  { name: 'Mois', to: '/mois' },
  { name: 'Comptes', to: '/comptes' },
  { name: 'Investissements', to: '/investissements' },
  { name: 'Stats', to: '/stats' },
  { name: 'Template', to: '/template' },
  { name: 'Paramètres', to: '/parametres' },
]
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-stone-200/80 px-6 py-2.5 flex items-center gap-7">
      <div class="flex items-center gap-2.5 font-bold text-[15px] tracking-tight">
        <span class="w-8 h-8 bg-violet-600 rounded-xl flex items-center justify-center text-white text-sm shadow-sm">B</span>
        BudgetFlow
      </div>
      <nav class="flex gap-1">
        <router-link
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="px-3.5 py-1.5 rounded-lg text-[13px] font-medium text-gray-500 hover:text-gray-900 hover:bg-stone-100 transition-colors"
          :class="{ 'bg-violet-100/70 text-violet-700 font-semibold': route.path.startsWith(link.to) }"
        >
          {{ link.name }}
        </router-link>
      </nav>
    </header>
    <main class="flex-1 px-8 py-6 max-w-5xl w-full mx-auto">
      <router-view />
    </main>
    <DialogHost />
  </div>
</template>
