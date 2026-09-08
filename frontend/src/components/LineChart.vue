<script setup>
// Courbes multi-séries : grille hairline, traits 2px, crosshair + tooltip listant
// toutes les séries au mois survolé. Le parent passe uniquement les séries visibles
// (la légende et ses bascules vivent chez lui).
import { ref, computed } from 'vue'
import { eur } from '@/lib/format.js'

const props = defineProps({
  labels: { type: Array, required: true },  // libellés X (mois)
  series: { type: Array, required: true },  // [{ key, name, color, dash?, points: [Number|null] }]
  height: { type: Number, default: 280 },   // hauteur du viewBox (180-200 pour une courbe compacte)
  minimalAxis: { type: Boolean, default: false }, // deux repères Y (min/max) au lieu de la grille complète
})

// ─── Repère du dessin ─────────────────────────────────────
// Le SVG a une largeur fixe de 900 unités et s'étire à la largeur réelle via le
// viewBox : tout se calcule donc dans ce repère, jamais en pixels écran.
const W = 900
const PAD = { l: 58, r: 18, t: 14, b: 28 } // marges : la gauche loge les montants de l'axe Y
const plotW = W - PAD.l - PAD.r            // largeur utile, hors marges
const H = computed(() => props.height)
const plotH = computed(() => H.value - PAD.t - PAD.b) // hauteur utile, hors marges

// Toutes les valeurs de toutes les séries, trous exclus — la base de l'échelle Y
const allValues = computed(() => props.series.flatMap((s) => s.points.filter((v) => v !== null && v !== undefined)))
// Plafond brut ; le 1 évite une échelle plate quand tout vaut zéro
const rawMax = computed(() => Math.max(1, ...allValues.value))
// Plancher brut ; le 0 force l'axe à partir de zéro tant qu'aucune valeur n'est négative
const rawMin = computed(() => Math.min(0, ...allValues.value))

/**
 * Choisit un pas de graduation « rond » pour découper une amplitude en 4 environ.
 *
 * Une division brute donnerait des repères illisibles (1 237 €, 2 474 €…).
 * On cherche donc le plus petit pas de la forme 1, 2, 2,5, 5 ou 10 × une puissance
 * de dix qui couvre le quart de l'amplitude : 4 943 / 4 = 1 236 → pas de 2 000.
 *
 * @param {number} range Amplitude à couvrir (max − min), strictement positive.
 * @returns {number} Le pas rond immédiatement supérieur au quart de l'amplitude.
 */
const niceStep = (range) => {
  const raw = range / 4                                   // le pas idéal, sans contrainte de rondeur
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))    // sa puissance de dix (1, 10, 100, 1000…)
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow
  return 10 * pow                                          // filet : ne devrait jamais être atteint
}

// Le pas retenu ; le || 1 protège du cas où toutes les valeurs sont identiques
const step = computed(() => niceStep(rawMax.value - rawMin.value || 1))
// Bornes de l'axe, arrondies au pas : la dernière graduation tombe juste
const yMax = computed(() => Math.ceil(rawMax.value / step.value) * step.value)
const yMin = computed(() => Math.floor(rawMin.value / step.value) * step.value)

/**
 * Les valeurs auxquelles tracer une ligne de grille et écrire un montant.
 *
 * En mode « axe minimal » (courbe compacte), on ne garde que le plancher et le
 * plafond. Sinon on égrène le pas de l'un à l'autre. Le 1e-9 absorbe les erreurs
 * d'arrondi des flottants, sans quoi la dernière graduation sauterait parfois.
 *
 * @returns {number[]} Les hauteurs à graduer, du bas vers le haut.
 */
const ticks = computed(() => {
  if (props.minimalAxis) return yMin.value === yMax.value ? [yMin.value] : [yMin.value, yMax.value]
  const t = []
  for (let v = yMin.value; v <= yMax.value + 1e-9; v += step.value) t.push(Math.round(v * 100) / 100)
  return t
})

// ─── Des données vers les coordonnées du dessin ───────────

// Abscisse du i-ème point ; un point unique se pose au milieu plutôt qu'à gauche
const x = (i) => PAD.l + (props.labels.length <= 1 ? plotW / 2 : (i / (props.labels.length - 1)) * plotW)
// Ordonnée d'une valeur : l'axe SVG descend, d'où la soustraction à la hauteur
const y = (v) => PAD.t + plotH.value - ((v - yMin.value) / (yMax.value - yMin.value || 1)) * plotH.value

/**
 * Construit le tracé SVG d'une série.
 *
 * Un trou dans les données (null) coupe le trait au lieu de le faire plonger vers
 * zéro : on repart alors en « M » (déplacement sans tracé) au point suivant, ce que
 * porte le drapeau `started`. Les coordonnées sont arrondies au dixième pour ne pas
 * alourdir le SVG de décimales invisibles.
 *
 * @param {Array<number|null>} points Les valeurs de la série, dans l'ordre des libellés.
 * @returns {string} L'attribut `d` du <path>, éventuellement fait de plusieurs segments.
 */
const path = (points) => {
  let d = ''
  let started = false // false = le prochain point ouvre un nouveau segment
  points.forEach((v, i) => {
    if (v === null || v === undefined) { started = false; return }
    d += (started ? ' L ' : ' M ') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)
    started = true
  })
  return d
}

/**
 * Indice de la dernière valeur connue d'une série.
 *
 * Sert à poser la pastille de fin de courbe au bon endroit : la dernière valeur
 * n'est pas forcément le dernier mois, une série peut s'arrêter avant.
 *
 * @param {Array<number|null>} points Les valeurs de la série.
 * @returns {number} L'indice trouvé, ou -1 si la série est entièrement vide.
 */
const lastIdx = (points) => {
  for (let i = points.length - 1; i >= 0; i--) if (points[i] !== null && points[i] !== undefined) return i
  return -1
}

// ─── Survol : on vise un mois, jamais un trait ────────────
const hover = ref(null)  // indice du mois survolé, null hors du graphique
const svgEl = ref(null)

/**
 * Traduit la position du curseur en indice de mois, et arme le crosshair.
 *
 * Viser un trait à deux pixels serait pénible : on cherche donc le mois le plus
 * proche horizontalement, quelle que soit la hauteur du curseur. La position écran
 * est ramenée dans le repère du SVG (largeur 900) avant d'être convertie en indice,
 * puis bornée pour que les marges gauche et droite restent rattachées aux extrémités.
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

// ─── Mise en forme et placement de l'infobulle ────────────
const fmt = eur // même format que partout (espaces fines U+202F)
// Les graduations se lisent sans centimes : l'axe donne l'ordre de grandeur
const fmtTick = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
// L'infobulle bascule à gauche du curseur passé 60 % de largeur, pour ne pas déborder
const tipStyle = computed(() => {
  if (hover.value === null) return {}
  const left = (x(hover.value) / W) * 100
  return left > 60 ? { right: (100 - left + 2) + '%' } : { left: (left + 2) + '%' }
})
// Un seul libellé X sur ~12+ mois serré : on saute un mois sur deux au besoin
const xEvery = computed(() => (props.labels.length > 14 ? 2 : 1))
</script>

<template>
  <div class="relative">
    <svg ref="svgEl" :viewBox="`0 0 ${W} ${H}`" class="w-full block select-none" @pointermove="onMove" @pointerleave="hover = null">
      <g>
        <line v-for="t in ticks" :key="'g' + t" :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="var(--c-line)" stroke-width="1" />
        <text v-for="t in ticks" :key="'t' + t" class="num" :x="PAD.l - 8" :y="y(t) + 4" text-anchor="end" font-size="11" font-weight="400" fill="var(--c-ink-3)" style="font-variant-numeric: tabular-nums">{{ fmtTick(t) }}</text>
      </g>
      <g>
        <template v-for="(lab, i) in labels" :key="'x' + i">
          <text v-if="i % xEvery === 0" :x="x(i)" :y="H - 8" text-anchor="middle" font-size="11" fill="var(--c-ink-3)">{{ lab }}</text>
        </template>
      </g>
      <line v-if="hover !== null" :x1="x(hover)" :x2="x(hover)" :y1="PAD.t" :y2="PAD.t + plotH" stroke="var(--c-line-strong)" stroke-width="1" />
      <g v-for="s in series" :key="s.key">
        <path :d="path(s.points)" fill="none" :stroke="s.color" stroke-width="2" :stroke-dasharray="s.dash ? '6 5' : undefined" stroke-linejoin="round" stroke-linecap="round" />
        <template v-if="lastIdx(s.points) >= 0">
          <circle :cx="x(lastIdx(s.points))" :cy="y(s.points[lastIdx(s.points)])" r="6" fill="var(--c-surface)" />
          <circle :cx="x(lastIdx(s.points))" :cy="y(s.points[lastIdx(s.points)])" r="4" :fill="s.color" />
        </template>
        <template v-if="hover !== null && s.points[hover] !== null && s.points[hover] !== undefined">
          <circle :cx="x(hover)" :cy="y(s.points[hover])" r="6" fill="var(--c-surface)" />
          <circle :cx="x(hover)" :cy="y(s.points[hover])" r="4" :fill="s.color" />
        </template>
      </g>
    </svg>

    <div v-if="hover !== null && series.length" class="tip" :style="tipStyle">
      <p class="tip-title mb-1">{{ labels[hover] }}</p>
      <p v-for="s in series" :key="s.key" class="flex items-center gap-2 py-px">
        <span class="inline-block w-3 h-0.5 rounded shrink-0" :style="{ background: s.color }" />
        <span class="tip-val num">{{ s.points[hover] === null || s.points[hover] === undefined ? '—' : fmt(s.points[hover]) }}</span>
        <span class="tip-name">{{ s.name }}</span>
      </p>
    </div>
    <p v-if="!series.length" class="chart-empty">Aucune série sélectionnée.</p>
  </div>
</template>

<style scoped>
</style>
