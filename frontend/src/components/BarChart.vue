<script setup>
// Barres mensuelles (un flux se trace en barres, jamais en courbe) — empilées ou groupées.
// Style commun des graphiques Stats : 4 graduations max, pas d'axe vertical, € sur la
// graduation du haut, infobulle triée par valeur décroissante avec total.
import { ref, computed } from 'vue'
import { eur } from '@/lib/format.js'

const props = defineProps({
  labels: { type: Array, required: true },  // libellés X (mois)
  series: { type: Array, required: true },  // [{ key, name, color, points: [Number] }]
  stacked: { type: Boolean, default: false },
  height: { type: Number, default: 260 },
})

// ─── Repère du dessin ─────────────────────────────────────
// Largeur fixe de 900 unités, étirée à la largeur réelle par le viewBox : tout se
// calcule dans ce repère, jamais en pixels écran.
const W = 900
const PAD = { l: 58, r: 24, t: 14, b: 28 } // la marge gauche loge les montants de l'axe
const plotW = W - PAD.l - PAD.r            // largeur utile, hors marges
const H = computed(() => props.height)
const plotH = computed(() => H.value - PAD.t - PAD.b) // hauteur utile, hors marges

// Une barre ne descend jamais sous zéro : trous et négatifs sont ramenés à 0
const val = (v) => (v === null || v === undefined ? 0 : Math.max(0, v))

/**
 * Plus haute barre à représenter, qui fixe le sommet de l'échelle.
 *
 * En empilé, c'est la plus grosse SOMME d'un mois ; en groupé, la plus grosse
 * valeur isolée. Le plancher à 1 évite une division par zéro quand tout est vide.
 *
 * @returns {number} La valeur maximale à faire tenir dans la hauteur du graphique.
 */
const maxVal = computed(() => {
  let max = 1
  props.labels.forEach((_, i) => {
    if (props.stacked) {
      max = Math.max(max, props.series.reduce((s, sr) => s + val(sr.points[i]), 0))
    } else {
      props.series.forEach((sr) => { max = Math.max(max, val(sr.points[i])) })
    }
  })
  return max
})

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
// Graduations de 0 au sommet ; le 1e-9 absorbe les arrondis des flottants,
// sans quoi la dernière sauterait parfois
const ticks = computed(() => {
  const t = []
  for (let v = 0; v <= yMax.value + 1e-9; v += step.value) t.push(v)
  return t
})
// Ordonnée d'une valeur : l'axe SVG descend, d'où la soustraction à la hauteur
const y = (v) => PAD.t + plotH.value - (v / yMax.value) * plotH.value

// Largeur d'une colonne de mois, barres et espaces compris
const groupW = computed(() => plotW / Math.max(1, props.labels.length))
// Bord gauche de la colonne du i-ème mois
const x0 = (i) => PAD.l + i * groupW.value

/**
 * Calcule tous les rectangles à dessiner, mois par mois.
 *
 * Deux dispositions selon le mode :
 *  - empilé : une seule barre centrée, les séries s'entassent du bas vers le haut,
 *    chacune posée sur le cumul des précédentes (`acc`) ;
 *  - groupé : une barre par série, côte à côte, l'ensemble centré dans la colonne.
 *
 * Les valeurs nulles sont omises plutôt que dessinées à zéro : un rectangle de
 * hauteur nulle laisserait un artefact d'un pixel. La hauteur minimale de 1 garde
 * visible une valeur très petite mais réelle.
 *
 * @returns {Array<Array<{key: string, color: string, x: number, y: number, w: number, h: number}>>}
 *   Un tableau de rectangles par mois, prêt à passer au <rect> du template.
 */
const bars = computed(() => props.labels.map((_, i) => {
  if (props.stacked) {
    const bw = Math.min(34, groupW.value * 0.55)   // barre unique, plafonnée à 34 unités
    const x = x0(i) + (groupW.value - bw) / 2       // centrée dans la colonne
    let acc = 0                                    // hauteur déjà occupée par les séries du dessous
    const rects = []
    props.series.forEach((sr) => {
      const v = val(sr.points[i])
      if (v <= 0) return
      const y1 = y(acc + v), y2 = y(acc)            // haut et bas de la tranche
      rects.push({ key: sr.key, color: sr.color, x, y: y1, w: bw, h: Math.max(1, y2 - y1) })
      acc += v
    })
    return rects
  }
  const k = Math.max(1, props.series.length)
  const bw = Math.min(20, (groupW.value * 0.7) / k) // barres plus fines, elles se partagent la place
  const total = k * bw + (k - 1) * 2                // largeur du groupe, 2 unités d'écart entre barres
  return props.series.flatMap((sr, j) => {
    const v = val(sr.points[i])
    if (v <= 0) return []
    const x = x0(i) + (groupW.value - total) / 2 + j * (bw + 2)
    return [{ key: sr.key, color: sr.color, x, y: y(v), w: bw, h: Math.max(1, y(0) - y(v)) }]
  })
}))

// ─── Survol : on vise un mois entier ──────────────────────
const hover = ref(null) // indice du mois survolé, null hors du graphique
const svgEl = ref(null)

/**
 * Traduit la position du curseur en indice de mois.
 *
 * On cherche la colonne sous le curseur, quelle que soit sa hauteur : viser une
 * barre de vingt unités serait pénible. Contrairement aux courbes, on tronque au
 * lieu d'arrondir — une colonne occupe un intervalle, pas un point. Hors des
 * colonnes, le survol retombe à null.
 *
 * @param {PointerEvent} evt L'événement de déplacement du pointeur.
 */
function onMove(evt) {
  if (!svgEl.value || !props.labels.length) return
  const rect = svgEl.value.getBoundingClientRect()
  const px = ((evt.clientX - rect.left) / rect.width) * W // position écran → repère du SVG
  const i = Math.floor((px - PAD.l) / groupW.value)
  hover.value = i >= 0 && i < props.labels.length ? i : null
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
// Total du mois, affiché en pied d'infobulle dès qu'il y a plusieurs séries
const tipTotal = computed(() => tipRows.value.reduce((s, r) => s + r.value, 0))
// L'infobulle bascule à gauche du curseur passé 60 % de largeur, pour ne pas déborder
const tipStyle = computed(() => {
  if (hover.value === null) return {}
  const left = ((x0(hover.value) + groupW.value / 2) / W) * 100
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
      <rect v-if="hover !== null" :x="x0(hover)" :y="PAD.t" :width="groupW" :height="plotH" fill="var(--c-surface-hover)" />
      <g>
        <line v-for="t in ticks" :key="'g' + t" :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="var(--c-line)" stroke-width="1" />
        <text v-for="(t, ti) in ticks" :key="'t' + t" class="num" :x="PAD.l - 8" :y="y(t) + 4" text-anchor="end" font-size="11" font-weight="400" fill="var(--c-ink-3)" style="font-variant-numeric: tabular-nums">{{ fmtTick(t, ti === ticks.length - 1) }}</text>
      </g>
      <g>
        <template v-for="(lab, i) in labels" :key="'x' + i">
          <text v-if="i % xEvery === 0" :x="x0(i) + groupW / 2" :y="H - 8" text-anchor="middle" font-size="11" fill="var(--c-ink-3)">{{ lab }}</text>
        </template>
      </g>
      <g v-for="(rects, i) in bars" :key="'b' + i">
        <rect v-for="(r, j) in rects" :key="r.key + j" :x="r.x" :y="r.y" :width="r.w" :height="r.h"
          :fill="r.color" :stroke="stacked ? 'var(--c-surface)' : 'none'" stroke-width="1" rx="1.5" />
      </g>
    </svg>

    <div v-if="hover !== null && tipRows.length" class="tip" :style="tipStyle">
      <p class="tip-title">{{ labels[hover] }}</p>
      <p v-for="r in tipRows" :key="r.key" class="tip-row">
        <span class="tip-dot" :style="{ background: r.color }" />
        <span class="tip-val num">{{ eur(r.value) }}</span>
        <span class="tip-name">{{ r.name }}</span>
      </p>
      <p v-if="tipRows.length > 1" class="tip-row tip-total">
        <span class="tip-dot" style="background: transparent" />
        <span class="tip-val num">{{ eur(tipTotal) }}</span>
        <span class="tip-name">total</span>
      </p>
    </div>
    <p v-if="!series.length" class="chart-empty">Aucune série sélectionnée.</p>
  </div>
</template>

<style scoped>
</style>
