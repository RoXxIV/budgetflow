<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { getSheets, getSheetLines, getSheetContributions, getSheetInvestmentTransactions } from '@/api/sheets.js'
import { getThemes } from '@/api/themes.js'
import { useDarkMode } from '@/composables/useDarkMode.js'

const { isDark } = useDarkMode()

// ─── Data ─────────────────────────────────────────────────
const sheets = ref([])     // sorted asc by periodMonth
const themes = ref([])
const allLines = ref([])   // { sheetId, sheetName, lines[] }
const investByMonth = ref([]) // { sheetId, sheetName, epargne, btc, etf }
const loading = ref(true)

const isBTC = (inv) => /btc|bitcoin|crypto/i.test(inv?.name || '') || inv?.type === 'CRYPTO'

onMounted(async () => {
  const [sheetsRes, themesRes] = await Promise.all([getSheets(), getThemes()])
  themes.value = themesRes.data

  // Trier les sheets par periodMonth asc
  sheets.value = [...sheetsRes.data]
    .filter((s) => !s.isTemplate)
    .sort((a, b) => new Date(a.periodMonth) - new Date(b.periodMonth))

  // Charger lignes + contributions + transactions d'invest de tous les sheets en parallèle
  const results = await Promise.all(
    sheets.value.map(async (s) => {
      const [lRes, cRes, iRes] = await Promise.all([
        getSheetLines(s._id),
        getSheetContributions(s._id),
        getSheetInvestmentTransactions(s._id),
      ])
      const epargne = cRes.data.reduce((a, c) => a + (c.amount || 0), 0)
      const btc = iRes.data.filter((t) => isBTC(t.investment)).reduce((a, t) => a + (t.amount || 0), 0)
      const etf = iRes.data.filter((t) => !isBTC(t.investment)).reduce((a, t) => a + (t.amount || 0), 0)
      return {
        sheetId: s._id,
        sheetName: s.name || s._id,
        lines: lRes.data,
        epargne,
        btc,
        etf,
      }
    })
  )
  allLines.value = results.map(({ sheetId, sheetName, lines }) => ({ sheetId, sheetName, lines }))
  investByMonth.value = results.map(({ sheetId, sheetName, epargne, btc, etf }) => ({ sheetId, sheetName, epargne, btc, etf }))
  loading.value = false
})

// ─── Épargne & Investissements (3 séries) ─────────────────
const investMode = ref('cumul') // 'cumul' | 'month'
const INVEST_DEFS = [
  { key: 'epargne', label: 'Épargne', light: '#2a78d6', dark: '#3987e5' },
  { key: 'btc', label: 'BTC', light: '#eb6834', dark: '#d95926' },
  { key: 'etf', label: 'ETF', light: '#4a3aa7', dark: '#9085e9' },
]
const investHidden = ref(new Set())
function toggleInvest(key) {
  const s = new Set(investHidden.value)
  s.has(key) ? s.delete(key) : s.add(key)
  investHidden.value = s
}

const investSeries = computed(() =>
  INVEST_DEFS.map((def) => {
    let cum = 0
    const data = investByMonth.value.map((r) => {
      cum += r[def.key] || 0
      return {
        sheetId: r.sheetId,
        sheetName: r.sheetName,
        value: investMode.value === 'cumul' ? cum : r[def.key] || 0,
      }
    })
    return { ...def, data }
  })
)
const hasInvestData = computed(() =>
  investByMonth.value.some((r) => (r.epargne || 0) + (r.btc || 0) + (r.etf || 0) > 0)
)
function investColor(def) {
  return isDark.value ? def.dark : def.light
}

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
  '#7c3aed','#16a34a','#dc2626','#d97706','#7c3aed',
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

// ─── Graphique Épargne & Investissements (D3) ─────────────
const investEl = ref(null)
const investTip = ref({ visible: false, x: 0, y: 0, sheetName: '', rows: [] })

function drawInvestChart() {
  if (!investEl.value || !investByMonth.value.length) return
  const el = investEl.value
  d3.select(el).selectAll('*').remove()

  const dark = isDark.value
  const ink = { grid: dark ? '#2c2c2a' : '#e1e0d9', axis: '#898781', base: dark ? '#383835' : '#c3c2b7' }

  const margin = { top: 16, right: 56, bottom: 52, left: 62 }
  const totalW = el.clientWidth || 900
  const totalH = 360
  const W = totalW - margin.left - margin.right
  const H = totalH - margin.top - margin.bottom

  const svg = d3.select(el).append('svg').attr('width', totalW).attr('height', totalH)
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const rows = investByMonth.value
  const sheetIds = rows.map((r) => r.sheetId)
  const nameById = Object.fromEntries(rows.map((r) => [r.sheetId, r.sheetName]))

  const visible = investSeries.value.filter((s) => !investHidden.value.has(s.key))

  const xScale = d3.scalePoint().domain(sheetIds).range([0, W]).padding(0.5)
  const maxVal = d3.max(visible.flatMap((s) => s.data.map((d) => d.value))) || 100
  const yScale = d3.scaleLinear().domain([0, maxVal * 1.12]).nice().range([H, 0])

  // Grille horizontale (discrète)
  g.append('g')
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-W).tickFormat(''))
    .call((s) => s.select('.domain').remove())
    .call((s) => s.selectAll('line').attr('stroke', ink.grid))

  // Axe X (noms de mois)
  g.append('g')
    .attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(xScale).tickFormat((id) => nameById[id] || id))
    .call((s) => s.select('.domain').attr('stroke', ink.base))
    .call((s) => s.selectAll('line').attr('stroke', ink.base))
    .call((s) => s.selectAll('text')
      .attr('font-size', '11px').attr('fill', ink.axis)
      .attr('transform', 'rotate(-28)').style('text-anchor', 'end'))

  // Axe Y (€)
  g.append('g')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat((d) => d3.format('~s')(d) + ' €'))
    .call((s) => s.select('.domain').remove())
    .call((s) => s.selectAll('line').remove())
    .call((s) => s.selectAll('text').attr('font-size', '11px').attr('fill', ink.axis))

  const lineGen = d3.line().x((d) => xScale(d.sheetId)).y((d) => yScale(d.value)).curve(d3.curveMonotoneX)
  const surface = dark ? '#12101a' : '#ffffff'

  visible.forEach((serie) => {
    const color = investColor(serie)
    g.append('path')
      .datum(serie.data)
      .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', lineGen)

    g.selectAll(`.dot-${serie.key}`)
      .data(serie.data).join('circle')
      .attr('cx', (d) => xScale(d.sheetId)).attr('cy', (d) => yScale(d.value))
      .attr('r', 4).attr('fill', color).attr('stroke', surface).attr('stroke-width', 2)

    // Label direct en bout de ligne
    const last = serie.data[serie.data.length - 1]
    if (last) {
      g.append('text')
        .attr('x', xScale(last.sheetId) + 8).attr('y', yScale(last.value))
        .attr('dy', '0.32em').attr('font-size', '11.5px').attr('font-weight', 600)
        .attr('fill', color).text(serie.label)
    }
  })

  // Crosshair + tooltip
  const overlay = g.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent')
  const cross = g.append('line').attr('y1', 0).attr('y2', H).attr('stroke', ink.base).attr('stroke-dasharray', '3,3').style('opacity', 0)
  overlay
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event)
      let nearest = sheetIds[0], best = Infinity
      sheetIds.forEach((id) => { const dx = Math.abs(xScale(id) - mx); if (dx < best) { best = dx; nearest = id } })
      cross.attr('x1', xScale(nearest)).attr('x2', xScale(nearest)).style('opacity', 1)
      investTip.value = {
        visible: true,
        x: event.pageX + 14,
        y: event.pageY - 20,
        sheetName: nameById[nearest],
        rows: investSeries.value
          .filter((s) => !investHidden.value.has(s.key))
          .map((s) => ({ label: s.label, color: investColor(s), value: s.data.find((d) => d.sheetId === nearest)?.value || 0 })),
      }
    })
    .on('mouseleave', () => { cross.style('opacity', 0); investTip.value.visible = false })
}

watch([investSeries, investHidden, investMode, isDark], () => { nextTick(drawInvestChart) }, { deep: true })
watch(loading, (v) => { if (!v) nextTick(drawInvestChart) })
// L'ancien graphique de dépenses ne gère pas encore le sombre — on le redessine aussi au toggle
watch(isDark, () => { nextTick(drawChart) })

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

    <template v-else>
    <!-- ─── Épargne & Investissements ─────────────────────── -->
    <div v-if="hasInvestData" class="glass-card px-6 py-5 mb-6">
      <div class="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h3 class="text-[15px] font-semibold text-gray-950 dark:text-gray-50">Épargne &amp; Investissements</h3>
        <div class="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-[12px]">
          <button class="px-3 py-1 cursor-pointer" :class="investMode === 'cumul' ? 'bg-violet-600 text-white' : 'bg-transparent text-gray-500 dark:text-gray-400'" @click="investMode = 'cumul'">Cumulé</button>
          <button class="px-3 py-1 cursor-pointer border-l border-gray-200 dark:border-gray-700" :class="investMode === 'month' ? 'bg-violet-600 text-white' : 'bg-transparent text-gray-500 dark:text-gray-400'" @click="investMode = 'month'">Par mois</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mb-4">
        <button
          v-for="def in INVEST_DEFS"
          :key="def.key"
          class="flex items-center gap-1.5 px-2.5 py-1 border border-gray-200 dark:border-gray-700 rounded-full text-[12px] font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
          :class="{ 'opacity-35': investHidden.has(def.key) }"
          @click="toggleInvest(def.key)"
        >
          <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: investColor(def) }"></span>
          {{ def.label }}
        </button>
      </div>
      <div ref="investEl" class="w-full min-h-90"></div>
    </div>

    <!-- ─── Dépenses par thème ────────────────────────────── -->
    <div v-if="!series.length" class="text-center text-gray-400 text-[13px] py-15">
      Aucune donnée à afficher. Assignez des thèmes à vos lignes budgétaires.
    </div>

    <div v-else class="glass-card px-6 py-5">

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
    </template>

    <!-- Tooltip Épargne & Investissements -->
    <div
      v-if="investTip.visible"
      class="fixed bg-gray-900 text-white rounded-lg px-3.5 py-2.5 text-[12.5px] pointer-events-none z-9999 flex flex-col gap-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.2)] min-w-40"
      :style="{ left: investTip.x + 'px', top: investTip.y + 'px' }"
    >
      <div class="text-gray-300 text-[11.5px] font-medium">{{ investTip.sheetName }}</div>
      <div v-for="r in investTip.rows" :key="r.label" class="flex items-center justify-between gap-4">
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full shrink-0" :style="{ background: r.color }"></span>{{ r.label }}</span>
        <span class="font-bold">{{ fmt(r.value) }} €</span>
      </div>
    </div>
  </div>
</template>
