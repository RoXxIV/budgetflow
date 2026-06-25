<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { getSheets, getSheetLines } from '@/api/sheets.js'
import { getThemes } from '@/api/themes.js'

// ─── Data ─────────────────────────────────────────────────
const sheets = ref([])     // sorted asc by periodMonth
const themes = ref([])
const allLines = ref([])   // { sheetId, sheetName, lines[] }
const loading = ref(true)

onMounted(async () => {
  const [sheetsRes, themesRes] = await Promise.all([getSheets(), getThemes()])
  themes.value = themesRes.data

  // Trier les sheets par periodMonth asc
  sheets.value = [...sheetsRes.data]
    .filter((s) => !s.isTemplate)
    .sort((a, b) => new Date(a.periodMonth) - new Date(b.periodMonth))

  // Charger toutes les lignes de tous les sheets en parallèle
  const results = await Promise.all(
    sheets.value.map((s) =>
      getSheetLines(s._id).then((r) => ({
        sheetId: s._id,
        sheetName: s.name || s._id,
        lines: r.data,
      }))
    )
  )
  allLines.value = results
  loading.value = false
})

// ─── Agrégation par thème / sheet ─────────────────────────
// series = [{ theme, color, data: [{ sheetId, sheetName, amount }] }]
const series = computed(() => {
  if (!themes.value.length || !allLines.value.length) return []

  return themes.value.map((theme) => {
    const data = allLines.value.map(({ sheetId, sheetName, lines }) => {
      const amount = lines
        .filter((l) => {
          const tId = l.theme?._id || l.theme
          return l.flow === 'expense' && tId && String(tId) === String(theme._id)
        })
        .reduce((s, l) => s + (l.actualAmount || l.plannedAmount || 0), 0)
      return { sheetId, sheetName, amount }
    })
    const hasData = data.some((d) => d.amount > 0)
    return { theme, color: theme.color || null, data, hasData }
  }).filter((s) => s.hasData)
})

// ─── Visibilité des lignes ─────────────────────────────────
const hidden = ref(new Set())

function toggle(themeId) {
  const s = new Set(hidden.value)
  if (s.has(themeId)) s.delete(themeId)
  else s.add(themeId)
  hidden.value = s
}
function showAll() { hidden.value = new Set() }
function hideAll() { hidden.value = new Set(series.value.map((s) => s.theme._id)) }
const allHidden = computed(() => hidden.value.size === series.value.length)

// ─── Palette de fallback ───────────────────────────────────
const FALLBACK_COLORS = [
  '#2563eb','#16a34a','#dc2626','#d97706','#7c3aed',
  '#0891b2','#db2777','#65a30d','#ea580c','#4f46e5',
  '#0d9488','#b45309','#9333ea','#059669','#e11d48',
]
function themeColor(serie, idx) {
  return serie.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
}

// ─── D3 chart ─────────────────────────────────────────────
const chartEl = ref(null)
const tooltip = ref({ visible: false, x: 0, y: 0, theme: '', date: '', amount: 0 })

function drawChart() {
  if (!chartEl.value || !series.value.length) return

  const el = chartEl.value
  d3.select(el).selectAll('*').remove()

  const margin = { top: 16, right: 24, bottom: 52, left: 60 }
  const totalW = el.clientWidth || 900
  const totalH = 380
  const W = totalW - margin.left - margin.right
  const H = totalH - margin.top - margin.bottom

  const svg = d3.select(el)
    .append('svg')
    .attr('width', totalW)
    .attr('height', totalH)

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const visibleSeries = series.value.filter((s) => !hidden.value.has(s.theme._id))

  // X : scale ordinale — un slot par sheet, dans l'ordre de création
  const sheetIds = sheets.value.map((s) => s._id)
  const xScale = d3.scaleBand()
    .domain(sheetIds)
    .range([0, W])
    .padding(0.3)

  const xMid = (sheetId) => xScale(sheetId) + xScale.bandwidth() / 2

  const maxAmount = d3.max(visibleSeries.flatMap((s) => s.data.map((d) => d.amount))) || 100
  const yScale = d3.scaleLinear()
    .domain([0, maxAmount * 1.1])
    .nice()
    .range([H, 0])

  // Grille horizontale
  g.append('g')
    .call(d3.axisLeft(yScale).tickSize(-W).tickFormat(''))
    .call((g) => g.select('.domain').remove())
    .call((g) => g.selectAll('line').attr('stroke', '#f3f4f6').attr('stroke-dasharray', '3,3'))

  // Axe X — label = nom du sheet
  const sheetNameById = Object.fromEntries(sheets.value.map((s) => [s._id, s.name || s._id]))
  g.append('g')
    .attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xScale).tickFormat((id) => sheetNameById[id] || id))
    .call((g) => g.select('.domain').attr('stroke', '#e5e7eb'))
    .call((g) => g.selectAll('text')
      .attr('font-size', '11px')
      .attr('fill', '#6b7280')
      .attr('transform', 'rotate(-30)')
      .style('text-anchor', 'end')
    )

  // Axe Y
  g.append('g')
    .call(d3.axisLeft(yScale).ticks(6).tickFormat((d) => d + ' €'))
    .call((g) => g.select('.domain').remove())
    .call((g) => g.selectAll('text').attr('font-size', '11px').attr('fill', '#6b7280'))

  const multiSheet = sheetIds.length > 1

  visibleSeries.forEach((serie, idx) => {
    const color = themeColor(serie, series.value.indexOf(serie))

    // Ligne (seulement si plusieurs sheets)
    if (multiSheet) {
      const lineGen = d3.line()
        .x((d) => xMid(d.sheetId))
        .y((d) => yScale(d.amount))
        .curve(d3.curveMonotoneX)

      g.append('path')
        .datum(serie.data)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2)
        .attr('d', lineGen)
    }

    // Points
    g.selectAll(`.dot-${idx}`)
      .data(serie.data)
      .join('circle')
      .attr('class', `dot-${idx}`)
      .attr('cx', (d) => xMid(d.sheetId))
      .attr('cy', (d) => yScale(d.amount))
      .attr('r', multiSheet ? 4 : 6)
      .attr('fill', color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mouseenter', (event, d) => {
        tooltip.value = {
          visible: true,
          x: event.pageX + 12,
          y: event.pageY - 28,
          theme: serie.theme.name,
          sheetName: d.sheetName,
          amount: d.amount,
          color,
        }
      })
      .on('mouseleave', () => { tooltip.value.visible = false })
  })
}

// Redessiner quand les données ou la visibilité changent
watch([series, hidden], () => { nextTick(drawChart) }, { deep: true })
watch(loading, (v) => { if (!v) nextTick(drawChart) })

function fmt(n) {
  return (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Statistiques</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Évolution des dépenses par thème sur tous les sheets</p>
      </div>
    </div>

    <div v-if="loading" class="text-center text-gray-400 text-[13px] py-15">Chargement des données…</div>

    <div v-else-if="!series.length" class="text-center text-gray-400 text-[13px] py-15">
      Aucune donnée à afficher. Assignez des thèmes à vos lignes budgétaires.
    </div>

    <div v-else class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-6 py-5">

      <!-- Légende + contrôles -->
      <div class="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div class="flex flex-wrap gap-2 flex-1">
          <button
            v-for="(serie, idx) in series"
            :key="serie.theme._id"
            class="flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 dark:border-gray-700 rounded-full bg-white dark:bg-gray-800 text-[12px] font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-opacity"
            :class="{ 'opacity-35 bg-gray-50 dark:bg-gray-700/50': hidden.has(serie.theme._id) }"
            @click="toggle(serie.theme._id)"
          >
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: themeColor(serie, idx) }"></span>
            {{ serie.theme.name }}
          </button>
        </div>
        <div class="flex gap-1.5 shrink-0">
          <button
            class="px-3 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700/50 text-[12px] text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
            @click="showAll"
            :disabled="hidden.size === 0"
          >Tout afficher</button>
          <button
            class="px-3 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700/50 text-[12px] text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
            @click="hideAll"
            :disabled="allHidden"
          >Tout masquer</button>
        </div>
      </div>

      <!-- Chart D3 -->
      <div ref="chartEl" class="w-full min-h-95"></div>

      <!-- Tooltip -->
      <div
        v-if="tooltip.visible"
        class="fixed bg-gray-900 text-white rounded-lg px-3.5 py-2.5 text-[12.5px] pointer-events-none z-9999 flex flex-col gap-1 shadow-[0_4px_16px_rgba(0,0,0,0.2)]"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >
        <div class="flex items-center gap-1.5 font-semibold">
          <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: tooltip.color }"></span>
          {{ tooltip.theme }}
        </div>
        <div class="text-gray-400 text-[11.5px]">{{ tooltip.sheetName }}</div>
        <div class="font-bold text-[14px] text-white">{{ fmt(tooltip.amount) }} €</div>
      </div>

    </div>
  </div>
</template>
