<script setup>
// Sélecteur de séries des graphiques Stats (§5) : remplace les rangées de pastilles.
// « 5 thèmes sur 30 ⌄ » → menu avec recherche, cases, tri par montant décroissant.
import { ref, computed } from 'vue'
import { eur } from '@/lib/format.js'

const props = defineProps({
  items: { type: Array, required: true },     // [{ id, name, color, avg }] triés par montant décroissant
  selected: { type: Array, required: true },  // ids sélectionnés
  word: { type: String, default: 'séries' },  // « thèmes », « comptes », « enveloppes »…
})
const emit = defineEmits(['update:selected'])

const open = ref(false)   // menu déroulé
const search = ref('')

// Filtre sur le nom, insensible à la casse ; sans recherche, la liste complète
// (déjà triée par montant décroissant par le parent)
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? props.items.filter((i) => i.name.toLowerCase().includes(q)) : props.items
})

// La sélection appartient au parent : on la lit, on ne la stocke pas
const isOn = (id) => props.selected.includes(id)

/**
 * Ajoute ou retire une série de la sélection.
 *
 * Le composant ne détient aucun état de sélection : il émet la nouvelle liste
 * complète et le parent la répercute (v-model:selected). D'où la copie plutôt
 * qu'une mutation en place, que Vue ne verrait pas.
 *
 * @param {number|string} id Identifiant de la série cliquée.
 */
function toggle(id) {
  emit('update:selected', isOn(id) ? props.selected.filter((x) => x !== id) : [...props.selected, id])
}

// Raccourci : les cinq plus gros postes, la vue par défaut d'un graphique lisible
function top5() { emit('update:selected', props.items.slice(0, 5).map((i) => i.id)) }
// Repartir d'un graphique vide pour composer sa propre sélection
function none() { emit('update:selected', []) }
</script>

<template>
  <span class="picker-wrap">
    <button class="picker-btn" @click.stop="open = !open">
      {{ selected.length }} {{ word }} sur {{ items.length }}
      <PhCaretDown :size="12" class="picker-caret" :class="{ 'is-open': open }" />
    </button>
    <span v-if="open" class="picker-overlay" @click.stop="open = false" />
    <div v-if="open" class="picker-menu" @click.stop>
      <input v-model="search" type="text" class="picker-search" placeholder="Rechercher…" />
      <div class="picker-actions">
        <button class="picker-action" @click="top5">Top 5</button>
        <button class="picker-action" @click="none">Tout désélectionner</button>
      </div>
      <div class="picker-list">
        <label v-for="i in filtered" :key="i.id" class="picker-item">
          <input type="checkbox" :checked="isOn(i.id)" @change="toggle(i.id)" />
          <span class="picker-dot" :style="{ background: i.color }" />
          <span class="picker-name">{{ i.name }}</span>
          <span class="picker-avg num" :title="eur(i.avg) + ' par mois en moyenne'">{{ eur(i.avg) }}</span>
        </label>
        <p v-if="!filtered.length" class="picker-empty">Aucun résultat.</p>
      </div>
    </div>
  </span>
</template>

<style scoped>
.picker-wrap { position: relative; display: inline-flex; }
.picker-btn {
  display: inline-flex; align-items: center; gap: var(--s-2);
  font-size: var(--t-small); font-weight: 500; color: var(--c-ink-2);
  padding: var(--s-1) var(--s-3); border: 1px solid var(--c-line-strong);
  border-radius: var(--r-control); background: var(--c-surface); cursor: pointer;
}
.picker-btn:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.picker-caret { transition: transform var(--dur-fast) var(--ease); }
.picker-caret.is-open { transform: rotate(180deg); }
.picker-overlay { position: fixed; inset: 0; z-index: 30; }
.picker-menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 40;
  width: 320px;
  background: var(--c-surface); border: 1px solid var(--c-line);
  border-radius: var(--r-container); box-shadow: var(--shadow-overlay);
  padding: var(--s-3);
}
.picker-search {
  width: 100%; padding: 5px var(--s-3); margin-bottom: var(--s-2);
  border: 1px solid var(--c-line-strong); border-radius: var(--r-control);
  font-size: 13px; color: var(--c-ink); background: var(--c-surface); outline: none; font-family: var(--font-ui);
}
.picker-search:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.picker-actions { display: flex; gap: var(--s-4); margin-bottom: var(--s-2); }
.picker-action { font-size: var(--t-small); font-weight: 500; color: var(--c-accent); cursor: pointer; }
.picker-action:hover { color: var(--c-accent-hover); text-decoration: underline; }
.picker-list { max-height: 280px; overflow-y: auto; }
.picker-item {
  display: flex; align-items: center; gap: var(--s-2);
  padding: var(--s-1) var(--s-2); border-radius: var(--r-control);
  font-size: 13px; color: var(--c-ink); cursor: pointer;
}
.picker-item:hover { background: var(--c-surface-hover); }
.picker-dot { width: 8px; height: 8px; border-radius: var(--r-pill); flex-shrink: 0; }
.picker-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-avg { margin-left: auto; font-size: var(--t-small); color: var(--c-ink-3); flex-shrink: 0; }
.picker-empty { font-size: var(--t-small); color: var(--c-ink-3); padding: var(--s-2); }
</style>
