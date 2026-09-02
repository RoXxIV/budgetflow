<script setup>
// Donut double anneau : extérieur = réel, intérieur = prévu (délavé).
// Espaceurs de surface entre segments, tooltip par segment, total au centre.
import { ref, computed } from 'vue'

const props = defineProps({
  outer: { type: Array, required: true },  // [{ label, value, color }] — réel
  inner: { type: Array, default: () => [] }, // prévu (mêmes libellés / couleurs)
  center: { type: Object, default: null },   // { value: String, label: String }
})

const CX = 120, CY = 120
const hover = ref(null) // { ring: 'reel'|'prevu', slice }

function arcs(slices, r0, r1) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0)
  if (total <= 0) return []
  const GAP = 0.025 // ~2px d'écart de surface entre segments
  let a = -Math.PI / 2
  const out = []
  slices.forEach((s, i) => {
    const frac = Math.max(0, s.value) / total
    const a0 = a + GAP / 2
    const a1 = a + frac * 2 * Math.PI - GAP / 2
    a += frac * 2 * Math.PI
    if (frac <= 0 || a1 <= a0) return
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (ang, r) => `${(CX + r * Math.cos(ang)).toFixed(2)} ${(CY + r * Math.sin(ang)).toFixed(2)}`
    out.push({
      ...s, i, frac,
      d: `M ${p(a0, r1)} A ${r1} ${r1} 0 ${large} 1 ${p(a1, r1)} L ${p(a1, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(a0, r0)} Z`,
    })
  })
  return out
}

const outerArcs = computed(() => arcs(props.outer, 80, 112))
const innerArcs = computed(() => arcs(props.inner, 50, 74))
const fmt = (n) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const pct = (f) => Math.round(f * 100) + ' %'
</script>

<template>
  <div class="relative flex items-center justify-center">
    <svg viewBox="0 0 240 240" class="w-64 h-64">
      <path
        v-for="s in outerArcs" :key="'o' + s.i" :d="s.d" :fill="s.color"
        :opacity="hover && !(hover.ring === 'reel' && hover.slice.i === s.i) ? 0.45 : 1"
        class="cursor-pointer"
        @pointerenter="hover = { ring: 'reel', slice: s }" @pointerleave="hover = null"
      />
      <path
        v-for="s in innerArcs" :key="'i' + s.i" :d="s.d" :fill="s.color"
        :opacity="hover && hover.ring === 'prevu' && hover.slice.i === s.i ? 0.8 : 0.35"
        class="cursor-pointer"
        @pointerenter="hover = { ring: 'prevu', slice: s }" @pointerleave="hover = null"
      />
      <template v-if="center">
        <text :x="CX" :y="CY - 2" text-anchor="middle" font-size="19" font-weight="600" fill="#0b0b0b">{{ center.value }}</text>
        <text :x="CX" :y="CY + 16" text-anchor="middle" font-size="10.5" fill="#898781">{{ center.label }}</text>
      </template>
    </svg>

    <div v-if="hover" class="absolute left-1/2 top-0 -translate-x-1/2 pointer-events-none bg-white border border-stone-200 rounded-lg shadow-sm px-3 py-1.5 text-[12px] whitespace-nowrap z-10">
      <span class="font-semibold text-gray-900">{{ fmt(hover.slice.value) }}</span>
      <span class="text-gray-400"> · {{ hover.slice.label }} ({{ hover.ring === 'reel' ? 'réel' : 'prévu' }}, {{ pct(hover.slice.frac) }})</span>
    </div>
  </div>
</template>
