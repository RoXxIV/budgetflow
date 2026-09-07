<script setup>
import { onMounted, onUnmounted, watch } from 'vue'

// Modal générique : props open/title, slot par défaut (corps) et slot footer (boutons).
// Échap et clic sur le fond ferment (émet 'close'). `z` permet d'empiler (une confirmation
// par-dessus une modale d'édition) ; la pile garantit qu'Échap ne ferme que celle du dessus.
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  wide: { type: Boolean, default: false },
  z: { type: Number, default: 50 },
})
const emit = defineEmits(['close'])

// ─── Pile des modales ouvertes ────────────────────────────
// Chaque instance s'identifie par un symbole unique et s'inscrit dans une pile
// partagée par toute l'application (portée à window : les composants ne se
// connaissent pas entre eux). Sans elle, une confirmation posée par-dessus une
// modale d'édition fermerait les deux d'un seul Échap.
const uid = Symbol('modal')
const stack = (window.__bfModalStack ||= [])

// Entrée dans la pile à l'ouverture, sortie à la fermeture. `immediate` couvre
// le cas d'une modale montée déjà ouverte.
watch(() => props.open, (o) => {
  const i = stack.indexOf(uid)
  if (o && i === -1) stack.push(uid)
  else if (!o && i !== -1) stack.splice(i, 1)
}, { immediate: true })

/**
 * Ferme la modale sur Échap — mais seulement si c'est celle du dessus.
 *
 * L'écouteur est posé sur window par chaque modale ouverte : toutes reçoivent la
 * touche. Seule la dernière de la pile réagit, les autres ignorent l'événement.
 *
 * @param {KeyboardEvent} e L'événement clavier venant de window.
 */
function onKey(e) {
  if (e.key === 'Escape' && props.open && stack[stack.length - 1] === uid) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))

// Démontage : on retire l'écouteur et on se dépile, y compris si le composant
// disparaît alors qu'il était encore ouvert (sinon la pile garderait un fantôme
// qui empêcherait les modales suivantes de répondre à Échap).
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  const i = stack.indexOf(uid)
  if (i !== -1) stack.splice(i, 1)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-scrim fixed inset-0 flex items-center justify-center px-4 py-6" :style="{ zIndex: z }" @mousedown.self="emit('close')">
      <div class="modal-panel w-full flex flex-col max-h-[calc(100vh-3rem)]" :class="wide ? 'max-w-3xl' : 'max-w-xl'">
        <div class="modal-head flex items-center gap-3 px-5 py-3.5">
          <h3 class="text-[15px] font-semibold">{{ title }}</h3>
          <button class="modal-x ml-auto" title="Fermer (Échap)" @click="emit('close')">×</button>
        </div>
        <div class="px-5 py-4 overflow-y-auto">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-foot flex gap-2 px-5 py-3">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-scrim { background: rgba(10, 16, 14, 0.45); }
.modal-panel {
  background: var(--c-surface);
  color: var(--c-ink);
  border: 1px solid var(--c-line);
  border-radius: var(--r-container);
  box-shadow: var(--shadow-overlay);
}
.modal-head { border-bottom: 1px solid var(--c-line); }
.modal-x {
  width: 28px; height: 28px; border-radius: var(--r-control);
  color: var(--c-ink-3); font-size: 15px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.modal-x:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.modal-foot {
  border-top: 1px solid var(--c-line);
  background: var(--c-surface-sunken);
  border-radius: 0 0 var(--r-container) var(--r-container);
}
</style>
