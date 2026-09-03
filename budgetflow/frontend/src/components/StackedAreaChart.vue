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

const W = 900
const PAD = { l: 58, r: 24, t: 14, b: 28 }
const plotW = W - PAD.l - PAD.r
const H = computed(() => props.height)
const plotH = computed(() => H.value - PAD.t - PAD.b)

const val = (v) => (v === null || v === undefined ? 0 : Math.max(0, v))
// Cumuls : cum[j][i] = somme des séries 0..j au mois i
const cums = computed(() => {
  let prev = props.labels.map(() => 0)
  return props.series.map((s) => {
    const c = props.labels.map((_, i) => prev[i] + val(s.points[i]))
    prev = c
    return c
  })
})
const maxVal = computed(() => Math.max(1, ...(cums.value.at(-1) || [1])))
const niceStep = (raw) => {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow
  return 10 * pow
}
const step = computed(() => niceStep(maxVal.value / 3))
const yMax = computed(() => Math.ceil(maxVal.value / step.value) * step.value)
const ticks = computed(() => {
  const t = []
  for (let v = 0; v <= yMax.value + 1e-9; v += step.value) t.push(v)
  return t
})
const x = (i) => PAD.l + (props.labels.length <= 1 ? plotW / 2 : (i / (props.labels.length - 1)) * plotW)
const y = (v) => PAD.t + plotH.value - (v / yMax.value) * plotH.value

// Bande j : bord haut = cum j, bord bas = cum j-1 (parcouru à l'envers)
const areaPath = (j) => {
  const top = cums.value[j]
  const bottom = j === 0 ? props.labels.map(() => 0) : cums.value[j - 1]
  let d = ''
  top.forEach((v, i) => { d += (i ? ' L ' : 'M ') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) })
  for (let i = bottom.length - 1; i >= 0; i--) d += ' L ' + x(i).toFixed(1) + ' ' + y(bottom[i]).toFixed(1)
  return d + ' Z'
}
const totalPath = computed(() => {
  const top = cums.value.at(-1) || []
  let d = ''
  top.forEach((v, i) => { d += (i ? ' L ' : 'M ') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) })
  return d
})
const lastI = computed(() => props.labels.length - 1)

const hover = ref(null)
const svgEl = ref(null)
function onMove(evt) {
  if (!svgEl.value || !props.labels.length) return
  const rect = svgEl.value.getBoundingClientRect()
  const px = ((evt.clientX - rect.left) / rect.width) * W
  const i = Math.round(((px - PAD.l) / plotW) * (props.labels.length - 1))
  hover.value = Math.min(props.labels.length - 1, Math.max(0, i))
}
const tipRows = computed(() => {
  if (hover.value === null) return []
  return props.series
    .map((s) => ({ key: s.key, name: s.name, color: s.color, value: s.points[hover.value] ?? 0 }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => b.value - a.value)
})
const tipTotal = computed(() => (hover.value === null ? 0 : (cums.value.at(-1)?.[hover.value] ?? 0)))
const tipStyle = computed(() => {
  if (hover.value === null) return {}
  const left = (x(hover.value) / W) * 100
  return left > 60 ? { right: (100 - left + 2) + '%' } : { left: (left + 2) + '%' }
})
const fmtTick = (n, isTop) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + (isTop ? ' €' : '')
const xEvery = computed(() => (props.labels.length > 14 ? 2 : 1))
</script>

<template>
  <div class="relative">
    <svg ref="svgEl" :viewBox="`0 0 ${W} ${H}`" class="w-full block select-none" @pointermove="onMove" @pointerleave="hover = null">
      <g>
        <line v-for="t in ticks" :key="'g' + t" :x1="PAD.l" :x2="W - PAD.r" :y1="y(t)" :y2="y(t)" stroke="var(--c-line)" stroke-width="1" />
        <text v-for="(t, ti) in ticks" :key="'t' + t" :x="PAD.l - 8" :y="y(t) + 4" text-anchor="end" font-size="11" fill="var(--c-ink-3)" style="font-variant-numeric: tabular-nums">{{ fmtTick(t, ti === ticks.length - 1) }}</text>
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
