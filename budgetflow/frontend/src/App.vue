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
]
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">B</span>
        BudgetFlow
      </div>
      <nav class="topnav">
        <router-link
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="topnav-link"
          :class="{ 'is-active': route.path.startsWith(link.to) }"
        >
          {{ link.name }}
        </router-link>
      </nav>
      <router-link to="/parametres" class="topbar-icon" title="Paramètres" :class="{ 'is-active': route.path.startsWith('/parametres') }">
        <PhGearSix :size="18" />
      </router-link>
    </header>
    <main class="flex-1 px-6 py-6 w-full mx-auto" :style="{ maxWidth: 'var(--w-content)' }">
      <router-view />
    </main>
    <DialogHost />
  </div>
</template>

<style scoped>
/* Barre de navigation §5.2 : non sticky, filet bas, actif souligné à l'accent */
.topbar {
  height: var(--h-topbar);
  background: var(--c-surface);
  border-bottom: 1px solid var(--c-line);
  padding: 0 var(--s-7);
  display: flex;
  align-items: center;
  gap: var(--s-8);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--c-ink);
}
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: var(--r-control);
  background: var(--c-accent);
  color: var(--c-on-accent);
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.topnav {
  display: flex;
  gap: var(--s-6);
  align-self: stretch;
}
.topnav-link {
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-ink-2);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color var(--dur-fast) var(--ease);
}
.topnav-link:hover { color: var(--c-ink); }
.topnav-link.is-active {
  color: var(--c-ink);
  border-bottom-color: var(--c-accent);
}
.topbar-icon {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border-radius: var(--r-control);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--c-ink-2);
  transition: background-color var(--dur-fast) var(--ease);
}
.topbar-icon:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.topbar-icon.is-active { color: var(--c-accent); background: var(--c-accent-soft); }
</style>
