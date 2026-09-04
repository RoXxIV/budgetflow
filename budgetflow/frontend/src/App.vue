<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import DialogHost from '@/components/DialogHost.vue'
import { getPrivacy, setPrivacy } from '@/lib/privacy.js'

const route = useRoute()

// Mode discret : floute tous les chiffres, sur toutes les pages (voir lib/privacy.js)
const privacyOn = ref(getPrivacy())
function togglePrivacy() {
  privacyOn.value = !privacyOn.value
  setPrivacy(privacyOn.value)
}

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
      <span />
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
      <span class="topbar-right">
        <button
          class="topbar-icon"
          :class="{ 'is-active': privacyOn }"
          :title="privacyOn ? 'Mode discret actif — cliquez pour réafficher les chiffres' : 'Mode discret : flouter tous les chiffres (écran partagé, transports)'"
          @click="togglePrivacy"
        >
          <PhEyeSlash v-if="privacyOn" :size="18" />
          <PhEye v-else :size="18" />
        </button>
        <router-link to="/parametres" class="topbar-icon" title="Paramètres" :class="{ 'is-active': route.path.startsWith('/parametres') }">
          <PhGearSix :size="18" />
        </router-link>
      </span>
    </header>
    <main class="flex-1 px-6 py-6 w-full mx-auto" :style="{ maxWidth: 'var(--w-content)' }">
      <router-view />
    </main>
    <DialogHost />
  </div>
</template>

<style scoped>
/* Barre de navigation : app perso, sans marque — la nav centrée sur le fond de l'app,
   non sticky, actif souligné à l'accent */
.topbar {
  height: var(--h-topbar);
  padding: 0 var(--s-7);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}
.topnav {
  display: flex;
  gap: var(--s-6);
  align-self: stretch;
  justify-content: center;
}
.topnav-link {
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--c-ink-2);
  border-bottom: 2px solid transparent;
  transition: color var(--dur-fast) var(--ease);
}
.topnav-link:hover { color: var(--c-ink); }
.topnav-link.is-active {
  color: var(--c-ink);
  border-bottom-color: var(--c-accent);
}
.topbar-right { justify-self: end; display: flex; gap: var(--s-2); }
.topbar-icon {
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
