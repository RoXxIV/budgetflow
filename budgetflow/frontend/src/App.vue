<script setup>
import { useRoute } from 'vue-router'
import DialogHost from '@/components/DialogHost.vue'

const route = useRoute()

const navLinks = [
  { name: 'Mois', to: '/mois' },
  { name: 'Comptes', to: '/comptes' },
  { name: 'Investissements', to: '/investissements' },
  { name: 'Template', to: '/template' },
  { name: 'Paramètres', to: '/parametres' },
]
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="bg-white border-b border-stone-200 px-6 py-3 flex items-center gap-6">
      <div class="flex items-center gap-2.5 font-semibold text-[15px]">
        <span class="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center text-white text-sm">B</span>
        BudgetFlow
      </div>
      <nav class="flex gap-1">
        <router-link
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="px-3.5 py-1.5 rounded-lg text-[13.5px] font-medium text-gray-500 hover:text-gray-900"
          :class="{ 'bg-violet-50 text-violet-700': route.path.startsWith(link.to) }"
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
