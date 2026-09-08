<script setup>
// Indicateur d'attente, à deux usages.
//
//  - En ligne, dans un bouton : une petite roue qui prend la couleur du texte autour
//    d'elle (currentColor), et se pose donc dans n'importe quel bouton sans réglage.
//  - En voile plein écran, quand l'opération en cours va emporter toute la page —
//    un import ou une remise à zéro. Le voile est opaque à dessein : ce qui est
//    affiché derrière n'est déjà plus vrai, autant ne pas le laisser voir.
const props = defineProps({
  // Diamètre en pixels. Une roue de bouton fait 14 ; celle d'un voile, plutôt 30.
  size: { type: Number, default: 14 },
  overlay: { type: Boolean, default: false },
  // Ce qu'on attend, dit à l'utilisateur. Voile seulement.
  label: { type: String, default: '' },
})

// La roue est carrée : une seule mesure suffit
const dimensions = () => ({ width: props.size + 'px', height: props.size + 'px' })
</script>

<template>
  <Teleport v-if="overlay" to="body">
    <div class="sp-veil">
      <span class="sp" :style="dimensions()" role="status" aria-label="Opération en cours" />
      <p v-if="label" class="sp-label">{{ label }}</p>
    </div>
  </Teleport>
  <span v-else class="sp" :style="dimensions()" role="status" aria-label="Chargement" />
</template>

<style scoped>
.sp {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: -2px;
  border: 2px solid currentColor;
  /* Le quart transparent est ce qui rend la rotation visible */
  border-top-color: transparent;
  border-radius: 50%;
  animation: sp-turn 0.7s linear infinite;
}
@keyframes sp-turn { to { transform: rotate(360deg); } }

.sp-veil {
  position: fixed;
  inset: 0;
  z-index: 200; /* au-dessus des modales, qui plafonnent bien plus bas */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-4);
  background: var(--c-canvas);
  color: var(--c-ink-2);
}
.sp-label { font-size: var(--t-small); color: var(--c-ink-2); }

/* Une rotation rapide en plein écran gêne certaines personnes : on la ralentit */
@media (prefers-reduced-motion: reduce) {
  .sp { animation-duration: 2.4s; }
}
</style>
