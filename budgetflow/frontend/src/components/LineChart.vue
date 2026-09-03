<script setup>
// Courbes multi-séries : grille hairline, traits 2px, crosshair + tooltip listant
// toutes les séries au mois survolé. Le parent passe uniquement les séries visibles
// (la légende et ses bascules vivent chez lui).
import { ref, computed } from 'vue'

const props = defineProps({
  labels: { type: Array, required: true },  // libellés X (mois)
  series: { type: Array, required: true },  // [{ key, name, color, dash?, points: [Number|null] }]
  height: { type: Number, default: 280 },   // hauteur du viewBox (180-200 pour une courbe compacte)
  minimalAxis: { type: Boolean, default: false }, // deux repères Y (min/max) au lieu de la grille complète
})

const W = 900
const PAD = { l: 58, r: 18, t: 14, b: 28 }
const plotW = W - PAD.l - PAD.r
const H = computed(() => props.height)
const plotH = computed(() => H.value - PAD.t - PAD.b)

const allValues = computed(() => props.series.flatMap((s) => s.points.filter((v) => v !== null && v !== undefined)))
const rawMax = computed(() => Math.max(1, ...allValues.value))
const rawMin = computed(() => Math.min(0, ...allValues.value))

// Échelle « propre » : 4-5 graduations rondes
const niceStep = (range) => {
  const raw = range / 4
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow
  return 10 * pow
}
const step = computed(() => niceStep(rawMax.value - rawMin.value || 1))
const yMax = computed(() => Math.ceil(rawMax.value / step.value) * step.value)
const yMin = computed(() => Math.floor(rawMin.value / step.value) * step.value)
const ticks = computed(() => {
  if (props.minimalAxis) return yMin.value === yMax.value ? [yMin.value] : [yMin.value, yMax.value]
  const t = []
  for (let v = yMin.value; v <= yMax.value + 1e-9; v += step.value) t.push(Math.round(v * 100) / 100)
  return t
})

const x = (i) => PAD.l + (props.labels.length <= 1 ? plotW / 2 : (i / (props.labels.length - 1)) * plotW)
const y = (v) => PAD.t + plotH.value - ((v - yMin.value) / (yMax.value - yMin.value || 1)) * plotH.value
const path = (points) => {
  let d = ''
  let started = false
  points.forEach((v, i) => {
    if (v === null || v === undefined) { started = false; return }
    d += (started ? ' L ' : ' M ') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)
    started = true
  })
  return d
}
const lastIdx = (points) => {
  for (let i = points.length - 1; i >= 0; i--) if (points[i] !== null && points[i] !== undefined) return i
  return -1
}

// Crosshair : on vise un mois, jamais un trait
const hover = ref(null)
const svgEl = ref(null)
function onMove(evt) {
  if (!svgEl.value || !props.labels.length) return
  const rect = svgEl.value.getBoundingClientRect()
  const px = ((evt.clientX - rect.left) / rect.width) * W
  const i = Math.round(((px - PAD.l) / plotW) * (props.labels.length - 1))
  hover.value = Math.min(props.labels.length - 1, Math.max(0, i))
}

const fmt = (n) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtTick = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })
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
        <line v-for="t in ticks" :key="'g' + t" :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="#e1e0d9" stroke-width="1" />
        <text v-for="t in ticks" :key="'t' + t" :x="PAD.l - 8" :y="y(t) + 4" text-anchor="end" font-size="11" fill="#898781" style="font-variant-numeric: tabular-nums">{{ fmtTick(t) }}</text>
      </g>
      <g>
        <template v-for="(lab, i) in labels" :key="'x' + i">
          <text v-if="i % xEvery === 0" :x="x(i)" :y="H - 8" text-anchor="middle" font-size="11" fill="#898781">{{ lab }}</text>
        </template>
      </g>
      <line v-if="hover !== null" :x1="x(hover)" :x2="x(hover)" :y1="PAD.t" :y2="PAD.t + plotH" stroke="#c3c2b7" stroke-width="1" />
      <g v-for="s in series" :key="s.key">
        <path :d="path(s.points)" fill="none" :stroke="s.color" stroke-width="2" :stroke-dasharray="s.dash ? '6 5' : undefined" stroke-linejoin="round" stroke-linecap="round" />
        <template v-if="lastIdx(s.points) >= 0">
          <circle :cx="x(lastIdx(s.points))" :cy="y(s.points[lastIdx(s.points)])" r="6" fill="#fcfcfb" />
          <circle :cx="x(lastIdx(s.points))" :cy="y(s.points[lastIdx(s.points)])" r="4" :fill="s.color" />
        </template>
        <template v-if="hover !== null && s.points[hover] !== null && s.points[hover] !== undefined">
          <circle :cx="x(hover)" :cy="y(s.points[hover])" r="6" fill="#fcfcfb" />
          <circle :cx="x(hover)" :cy="y(s.points[hover])" r="4" :fill="s.color" />
        </template>
      </g>
    </svg>

    <div v-if="hover !== null && series.length" class="absolute top-2 pointer-events-none bg-white border border-stone-200 rounded-lg shadow-sm px-3 py-2 text-[12px] z-10 whitespace-nowrap" :style="tipStyle">
      <p class="font-semibold text-gray-700 mb-1">{{ labels[hover] }}</p>
      <p v-for="s in series" :key="s.key" class="flex items-center gap-2 py-px">
        <span class="inline-block w-3 h-0.5 rounded shrink-0" :style="{ background: s.color }" />
        <span class="font-semibold text-gray-900">{{ s.points[hover] === null || s.points[hover] === undefined ? '—' : fmt(s.points[hover]) }}</span>
        <span class="text-gray-400">{{ s.name }}</span>
      </p>
    </div>
    <p v-if="!series.length" class="text-xs text-gray-400 text-center py-10">Aucune série sélectionnée.</p>
  </div>
</template>
