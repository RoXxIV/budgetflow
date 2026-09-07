<script setup>
// Panneau de la visite guidée : il explique l'onglet affiché et mène au suivant.
// Ancré en bas plutôt que centré — la page dont on parle doit rester visible.
// Le voile bloque les clics ailleurs : pendant la visite, seul « Suivant » avance.
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { completeTour } from '@/api/settings.js'
import { refreshOnboarding } from '@/lib/onboarding.js'
import { TOUR_STEPS, TOUR_END, tourIndexOf } from '@/lib/tour.js'

const router = useRouter()
const route = useRoute()

// L'étape n'est pas stockée : la route affichée la donne. Un rafraîchissement au
// milieu de la visite reprend donc au bon endroit, sans état à resynchroniser.
const index = computed(() => tourIndexOf(route.path))
// null hors des routes de la visite : le panneau ne s'affiche alors pas
const step = computed(() => TOUR_STEPS[index.value] || null)
const isLast = computed(() => index.value === TOUR_STEPS.length - 1)

/**
 * Passe à l'onglet suivant, ou clôt la visite si c'était le dernier.
 *
 * Naviguer suffit à faire changer le panneau : il suit la route, il n'a pas de
 * compteur propre à incrémenter.
 */
async function next() {
  if (isLast.value) return finish()
  router.push(TOUR_STEPS[index.value + 1].path)
}

/**
 * Termine la visite — bouton « Terminer » comme lien « Passer la visite ».
 *
 * Pose le drapeau côté serveur, rafraîchit l'état partagé pour que la barre de
 * navigation redevienne cliquable, puis rend la main sur la page Mois. Le `finally`
 * garantit la sortie même si l'appel échoue : mieux vaut une visite rejouée au
 * prochain démarrage qu'un utilisateur enfermé dans le panneau.
 */
async function finish() {
  try { await completeTour() } finally {
    await refreshOnboarding()
    router.push(TOUR_END)
  }
}
</script>

<template>
  <div v-if="step" class="tour">
    <div class="tour-veil" />
    <div class="tour-panel" role="dialog" aria-modal="true" :aria-label="step.title">
      <div class="tour-progress">
        <span v-for="(s, i) in TOUR_STEPS" :key="s.path" class="tour-pip" :class="{ 'is-done': i < index, 'is-current': i === index }" />
        <span class="tour-count">{{ index + 1 }} / {{ TOUR_STEPS.length }}</span>
      </div>
      <h2 class="tour-title">{{ step.title }}</h2>
      <p class="tour-body">{{ step.body }}</p>
      <div class="tour-actions">
        <button class="tour-skip" @click="finish">Passer la visite</button>
        <button class="tour-next" @click="next">{{ isLast ? 'Terminer' : 'Suivant' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tour { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; justify-content: center; padding: var(--s-7); }
/* Voile discret : il bloque les clics sans masquer la page qu'on explique */
.tour-veil { position: absolute; inset: 0; background: color-mix(in srgb, var(--c-canvas) 55%, transparent); }
.tour-panel {
  position: relative;
  width: 100%;
  max-width: 520px;
  background: var(--c-surface);
  border: 1px solid var(--c-line-strong);
  border-radius: var(--r-container);
  padding: var(--s-6);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
  animation: tour-in var(--dur-base) var(--ease);
}
@keyframes tour-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: none; }
}

.tour-progress { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-4); }
.tour-pip {
  width: 18px; height: 3px;
  border-radius: var(--r-pill);
  background: var(--c-track);
  transition: background-color var(--dur-base) var(--ease), width var(--dur-base) var(--ease);
}
.tour-pip.is-done { background: var(--c-accent); }
.tour-pip.is-current { background: var(--c-accent); width: 28px; }
.tour-count { margin-left: auto; font-size: var(--t-meta); color: var(--c-ink-3); }

.tour-title { font-size: var(--t-section-n); font-weight: 600; color: var(--c-ink); margin-bottom: var(--s-3); }
.tour-body { font-size: var(--t-body); color: var(--c-ink-2); line-height: 1.55; }
.tour-actions { display: flex; align-items: center; gap: var(--s-3); margin-top: var(--s-5); }
.tour-skip {
  font-size: var(--t-small);
  color: var(--c-ink-3);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.tour-skip:hover { color: var(--c-ink-2); }
.tour-next {
  margin-left: auto;
  height: 34px;
  padding: 0 var(--s-6);
  background: var(--c-accent);
  color: var(--c-on-accent);
  border-radius: var(--r-control);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}
.tour-next:hover { background: var(--c-accent-hover); }
</style>
