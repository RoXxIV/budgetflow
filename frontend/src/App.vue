<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import DialogHost from '@/components/DialogHost.vue'
import { getPrivacy, setPrivacy } from '@/lib/privacy.js'
import { onboarding, stepNumber } from '@/lib/onboarding.js'

const route = useRoute()

// Première utilisation : plein écran, sans barre de navigation ni raccourcis
const bare = computed(() => route.path === '/bienvenue')

// Page ouverte au milieu du flux (le Template) : elle prend une barre à elle.
// La navigation habituelle n'aurait aucun sens — toutes ses destinations sont
// fermées tant que la configuration n'est pas terminée.
const configStep = computed(() => (bare.value || !onboarding.value?.needsOnboarding ? null : stepNumber(onboarding.value)))
const configLabel = computed(() => (route.path === '/template' ? 'Budget type' : null))
// Repartir sur l'étape dont vient l'utilisateur, pas sur celle que la base déduit :
// une fois ses lignes saisies, l'état dirait « mois » et il ne les reverrait pas.
const configBackTo = computed(() =>
  route.path === '/template' ? { path: '/bienvenue', query: { etape: 'template' } } : { path: '/bienvenue' }
)

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
    <!-- Barre de configuration : ni navigation ni réglages, seulement où l'on en est
         et de quoi revenir au guide -->
    <header v-if="configStep" class="topbar config-topbar">
      <span class="config-title">
        Configuration · étape {{ configStep.current }} sur {{ configStep.total }}<span v-if="configLabel" class="config-sub"> — {{ configLabel }}</span>
      </span>
      <span />
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
        <router-link :to="configBackTo" class="btn-finish">Terminer</router-link>
      </span>
    </header>
    <header v-else-if="!bare" class="topbar">
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
    <main v-if="bare" class="flex-1">
      <router-view />
    </main>
    <main v-else class="flex-1 px-6 py-6 w-full mx-auto" :style="{ maxWidth: 'var(--w-content)' }">
      <router-view />
    </main>
    <DialogHost />
  </div>
</template>

<style scoped>
/* Barre de configuration : elle remplace la navigation, fermée à ce stade */
.config-topbar { background: var(--c-accent-soft); }
.config-title { font-size: var(--t-small); font-weight: 600; color: var(--c-accent); white-space: nowrap; }
.config-sub { font-weight: 400; color: var(--c-ink-2); }
.btn-finish {
  height: 30px;
  padding: 0 var(--s-5);
  display: inline-flex;
  align-items: center;
  background: var(--c-accent);
  color: var(--c-on-accent);
  border-radius: var(--r-control);
  font-size: 13px;
  font-weight: 500;
  transition: background-color var(--dur-fast) var(--ease);
}
.btn-finish:hover { background: var(--c-accent-hover); }

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
