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

const W = 900
const PAD = { l: 58, r: 24, t: 14, b: 28 }
const plotW = W - PAD.l - PAD.r
const H = computed(() => props.height)
const plotH = computed(() => H.value - PAD.t - PAD.b)

const val = (v) => (v === null || v === undefined ? 0 : Math.max(0, v))
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
// Échelle « propre », 4 graduations maximum (0 compris)
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
const y = (v) => PAD.t + plotH.value - (v / yMax.value) * plotH.value

const groupW = computed(() => plotW / Math.max(1, props.labels.length))
const x0 = (i) => PAD.l + i * groupW.value

// Rectangles à dessiner, groupe par groupe
const bars = computed(() => props.labels.map((_, i) => {
  if (props.stacked) {
    const bw = Math.min(34, groupW.value * 0.55)
    const x = x0(i) + (groupW.value - bw) / 2
    let acc = 0
    const rects = []
    props.series.forEach((sr) => {
      const v = val(sr.points[i])
      if (v <= 0) return
      const y1 = y(acc + v), y2 = y(acc)
      rects.push({ key: sr.key, color: sr.color, x, y: y1, w: bw, h: Math.max(1, y2 - y1) })
      acc += v
    })
    return rects
  }
  const k = Math.max(1, props.series.length)
  const bw = Math.min(20, (groupW.value * 0.7) / k)
  const total = k * bw + (k - 1) * 2
  return props.series.flatMap((sr, j) => {
    const v = val(sr.points[i])
    if (v <= 0) return []
    const x = x0(i) + (groupW.value - total) / 2 + j * (bw + 2)
    return [{ key: sr.key, color: sr.color, x, y: y(v), w: bw, h: Math.max(1, y(0) - y(v)) }]
  })
}))

// Survol : on vise un mois entier
const hover = ref(null)
const svgEl = ref(null)
function onMove(evt) {
  if (!svgEl.value || !props.labels.length) return
  const rect = svgEl.value.getBoundingClientRect()
  const px = ((evt.clientX - rect.left) / rect.width) * W
  const i = Math.floor((px - PAD.l) / groupW.value)
  hover.value = i >= 0 && i < props.labels.length ? i : null
}

const tipRows = computed(() => {
  if (hover.value === null) return []
  return props.series
    .map((s) => ({ key: s.key, name: s.name, color: s.color, value: s.points[hover.value] ?? 0 }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => b.value - a.value)
})
const tipTotal = computed(() => tipRows.value.reduce((s, r) => s + r.value, 0))
const tipStyle = computed(() => {
  if (hover.value === null) return {}
  const left = ((x0(hover.value) + groupW.value / 2) / W) * 100
  return left > 60 ? { right: (100 - left + 2) + '%' } : { left: (left + 2) + '%' }
})
const fmtTick = (n, isTop) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + (isTop ? ' €' : '')
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
