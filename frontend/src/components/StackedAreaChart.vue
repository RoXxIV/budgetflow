<script setup>
// Aire empilée (un stock se trace en aire) : composition du total par série, ligne fine
// du total par-dessus. Opacité 100 %, bandes séparées par un filet surface — pas de
// transparences superposées. Style commun des graphiques Stats (voir BarChart).
import { ref, computed } from 'vue'
import { eur } from '@/lib/format.js'

const props = defineProps({
  labels: { type: Array, required: true },  // libellés X (mois)
  series: { type: Array, required: true },  // [{ key, name, color, points: [Number] }] — empilées dans l'ordre donné
  height: { type: Number, default: 260 },
})

// ─── Repère du dessin ─────────────────────────────────────
// Largeur fixe de 900 unités, étirée par le viewBox : tout se calcule dans ce
// repère, jamais en pixels écran.
const W = 900
const PAD = { l: 58, r: 24, t: 14, b: 28 } // la marge gauche loge les montants de l'axe
const plotW = W - PAD.l - PAD.r            // largeur utile, hors marges
const H = computed(() => props.height)
const plotH = computed(() => H.value - PAD.t - PAD.b) // hauteur utile, hors marges

// Une aire ne descend jamais sous zéro : trous et négatifs sont ramenés à 0
const val = (v) => (v === null || v === undefined ? 0 : Math.max(0, v))

/**
 * Cumule les séries les unes sur les autres, dans l'ordre reçu.
 *
 * C'est le cœur de l'empilement : `cums[j][i]` vaut la somme des séries 0 à j au
 * mois i. La bande d'une série se dessine entre son cumul et celui d'en dessous,
 * et le dernier cumul donne le total — donc le contour supérieur.
 *
 * @returns {number[][]} Un tableau de cumuls par série, chacun long comme les libellés.
 */
const cums = computed(() => {
  let prev = props.labels.map(() => 0) // socle : le bas de la première bande
  return props.series.map((s) => {
    const c = props.labels.map((_, i) => prev[i] + val(s.points[i]))
    prev = c
    return c
  })
})

// Sommet de l'empilement, donc de l'échelle ; le 1 évite une division par zéro
const maxVal = computed(() => Math.max(1, ...(cums.value.at(-1) || [1])))

/**
 * Arrondit un pas de graduation à une valeur « ronde ».
 *
 * Sans cela les repères tomberaient sur des montants illisibles (1 237 €, 2 474 €…).
 * On prend le plus petit pas de la forme 1, 2, 2,5, 5 ou 10 × une puissance de dix
 * qui couvre la valeur demandée.
 *
 * @param {number} raw Le pas idéal, avant arrondi.
 * @returns {number} Le pas rond immédiatement supérieur.
 */
const niceStep = (raw) => {
  const pow = Math.pow(10, Math.floor(Math.log10(raw))) // puissance de dix (1, 10, 100…)
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow
  return 10 * pow // filet : ne devrait jamais être atteint
}

// Diviser par 3 vise 4 graduations en comptant le zéro
const step = computed(() => niceStep(maxVal.value / 3))
// Sommet de l'axe, arrondi au pas : la dernière graduation tombe juste
const yMax = computed(() => Math.ceil(maxVal.value / step.value) * step.value)
// Graduations de 0 au sommet ; le 1e-9 absorbe les arrondis des flottants
const ticks = computed(() => {
  const t = []
  for (let v = 0; v <= yMax.value + 1e-9; v += step.value) t.push(v)
  return t
})
// Abscisse du i-ème mois ; un mois unique se pose au milieu plutôt qu'à gauche
const x = (i) => PAD.l + (props.labels.length <= 1 ? plotW / 2 : (i / (props.labels.length - 1)) * plotW)
// Ordonnée d'une valeur : l'axe SVG descend, d'où la soustraction à la hauteur
const y = (v) => PAD.t + plotH.value - (v / yMax.value) * plotH.value

/**
 * Trace la bande fermée d'une série empilée.
 *
 * Une aire est un polygone : on longe son bord supérieur de gauche à droite (le
 * cumul de la série), puis on revient de droite à gauche par son bord inférieur
 * (le cumul de la série précédente, ou la ligne zéro pour la première), et on
 * ferme avec « Z ». Le retour en sens inverse est ce qui empêche le polygone de
 * se croiser en sablier.
 *
 * @param {number} j Rang de la série dans l'empilement, 0 pour celle du bas.
 * @returns {string} L'attribut `d` du <path>, fermé.
 */
const areaPath = (j) => {
  const top = cums.value[j]
  const bottom = j === 0 ? props.labels.map(() => 0) : cums.value[j - 1]
  let d = ''
  top.forEach((v, i) => { d += (i ? ' L ' : 'M ') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) })
  for (let i = bottom.length - 1; i >= 0; i--) d += ' L ' + x(i).toFixed(1) + ' ' + y(bottom[i]).toFixed(1)
  return d + ' Z'
}

// Contour du total : le dernier cumul, tracé en ligne ouverte par-dessus les bandes
const totalPath = computed(() => {
  const top = cums.value.at(-1) || []
  let d = ''
  top.forEach((v, i) => { d += (i ? ' L ' : 'M ') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) })
  return d
})
// Indice du dernier mois, où se pose la pastille de fin de courbe
const lastI = computed(() => props.labels.length - 1)

// ─── Survol : on vise un mois, jamais une bande ───────────
const hover = ref(null) // indice du mois survolé, null hors du graphique
const svgEl = ref(null)

/**
 * Traduit la position du curseur en indice de mois, et arme le crosshair.
 *
 * On cherche le mois le plus proche horizontalement, quelle que soit la hauteur du
 * curseur : viser une bande fine serait pénible. La position écran est ramenée dans
 * le repère du SVG, puis bornée pour que les marges restent rattachées aux extrémités.
 *
 * @param {PointerEvent} evt L'événement de déplacement du pointeur.
 */
function onMove(evt) {
  if (!svgEl.value || !props.labels.length) return
  const rect = svgEl.value.getBoundingClientRect()
  const px = ((evt.clientX - rect.left) / rect.width) * W // position écran → repère du SVG
  const i = Math.round(((px - PAD.l) / plotW) * (props.labels.length - 1))
  hover.value = Math.min(props.labels.length - 1, Math.max(0, i))
}

// ─── Infobulle ────────────────────────────────────────────
// Séries du mois survolé, sans les valeurs nulles, de la plus grosse à la plus petite
const tipRows = computed(() => {
  if (hover.value === null) return []
  return props.series
    .map((s) => ({ key: s.key, name: s.name, color: s.color, value: s.points[hover.value] ?? 0 }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => b.value - a.value)
})
// Total lu dans le dernier cumul plutôt que resommé : c'est la valeur qui est dessinée
const tipTotal = computed(() => (hover.value === null ? 0 : (cums.value.at(-1)?.[hover.value] ?? 0)))
// L'infobulle bascule à gauche du curseur passé 60 % de largeur, pour ne pas déborder
const tipStyle = computed(() => {
  if (hover.value === null) return {}
  const left = (x(hover.value) / W) * 100
  return left > 60 ? { right: (100 - left + 2) + '%' } : { left: (left + 2) + '%' }
})
// Graduations sans centimes ; seule celle du haut porte le symbole € (l'axe n'a pas de titre)
const fmtTick = (n, isTop) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + (isTop ? ' €' : '')
// Un seul libellé X sur ~12+ mois serré : on saute un mois sur deux au besoin
const xEvery = computed(() => (props.labels.length > 14 ? 2 : 1))
</script>

<template>
  <div class="relative">
    <svg ref="svgEl" :viewBox="`0 0 ${W} ${H}`" class="w-full block select-none" @pointermove="onMove" @pointerleave="hover = null">
      <g>
        <line v-for="t in ticks" :key="'g' + t" :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="var(--c-line)" stroke-width="1" />
        <text v-for="(t, ti) in ticks" :key="'t' + t" class="num" :x="PAD.l - 8" :y="y(t) + 4" text-anchor="end" font-size="11" font-weight="400" fill="var(--c-ink-3)" style="font-variant-numeric: tabular-nums">{{ fmtTick(t, ti === ticks.length - 1) }}</text>
      </g>
      <g>
        <template v-for="(lab, i) in labels" :key="'x' + i">
          <text v-if="i % xEvery === 0" :x="x(i)" :y="H - 8" text-anchor="middle" font-size="11" fill="var(--c-ink-3)">{{ lab }}</text>
        </template>
      </g>
      <g v-for="(s, j) in series" :key="s.key">
        <path :d="areaPath(j)" :fill="s.color" stroke="var(--c-surface)" stroke-width="1" />
      </g>
      <path :d="totalPath" fill="none" stroke="var(--c-ink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <line v-if="hover !== null" :x1="x(hover)" :x2="x(hover)" :y1="PAD.t" :y2="PAD.t + plotH" stroke="var(--c-line-strong)" stroke-width="1" />
      <template v-if="series.length && labels.length">
        <circle :cx="x(lastI)" :cy="y(cums.at(-1)[lastI])" r="6" fill="var(--c-surface)" />
        <circle :cx="x(lastI)" :cy="y(cums.at(-1)[lastI])" r="4" fill="var(--c-ink)" />
      </template>
      <template v-if="hover !== null && series.length">
        <circle :cx="x(hover)" :cy="y(cums.at(-1)[hover])" r="6" fill="var(--c-surface)" />
        <circle :cx="x(hover)" :cy="y(cums.at(-1)[hover])" r="4" fill="var(--c-ink)" />
      </template>
    </svg>

    <div v-if="hover !== null && tipRows.length" class="tip" :style="tipStyle">
      <p class="tip-title">{{ labels[hover] }}</p>
      <p v-for="r in tipRows" :key="r.key" class="tip-row">
        <span class="tip-dot" :style="{ background: r.color }" />
        <span class="tip-val num">{{ eur(r.value) }}</span>
        <span class="tip-name">{{ r.name }}</span>
      </p>
      <p class="tip-row tip-total">
        <span class="tip-dot" style="background: transparent" />
        <span class="tip-val num">{{ eur(tipTotal) }}</span>
        <span class="tip-name">total</span>
      </p>
    </div>
    <p v-if="!series.length" class="chart-empty">Aucune série sélectionnée.</p>
  </div>
</template>

<style scoped>
.tip {
  position: absolute; top: 8px; z-index: 10; pointer-events: none;
  background: var(--c-surface); border: 1px solid var(--c-line);
  border-radius: var(--r-control); box-shadow: var(--shadow-overlay);
  padding: var(--s-2) var(--s-3); font-size: 12px; white-space: nowrap;
}
.tip-title { font-weight: 600; color: var(--c-ink); margin-bottom: 2px; }
.tip-row { display: flex; align-items: center; gap: var(--s-2); padding-block: 1px; }
.tip-dot { width: 8px; height: 8px; border-radius: var(--r-pill); flex-shrink: 0; }
.tip-val { color: var(--c-ink); font-weight: 500; }
.tip-name { color: var(--c-ink-2); }
.tip-total { border-top: 1px solid var(--c-line); margin-top: 2px; padding-top: 3px; }
.chart-empty { font-size: 12px; color: var(--c-ink-3); text-align: center; padding: var(--s-8) 0; }
</style>
