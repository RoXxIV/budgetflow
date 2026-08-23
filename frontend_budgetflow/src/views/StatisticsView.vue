<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { getSheets, getSheetLines, getSheetContributions, getSheetInvestmentTransactions, getSheetTransactions, getSheetSnapshots } from '@/api/sheets.js'
import { getThemes } from '@/api/themes.js'
import { getAccounts } from '@/api/accounts.js'
import { getSavingGoals } from '@/api/savingGoals.js'
import { getSettings } from '@/api/settings.js'
import { buildSnapshotMap, computeAccountDeltaMap, resolveBalance } from '@/utils/liveBalances.js'
import { useDarkMode } from '@/composables/useDarkMode.js'
import { useCurrency } from '@/composables/useCurrency.js'

const { isDark } = useDarkMode()
const { currencySymbol } = useCurrency()

// ─── Data ─────────────────────────────────────────────────
const sheets = ref([])     // sorted asc by periodMonth
const themes = ref([])
const accounts = ref([])
const spendByMonth = ref([]) // { sheetId, sheetName, byTheme: { [themeId]: montant réel } }
const investRows = ref([])   // { sheetId, sheetName, balances: { [accountId]: solde | null } }
const loading = ref(true)

onMounted(async () => {
  const [sheetsRes, themesRes, accountsRes, goalsRes, settingsRes] = await Promise.all([
    getSheets(), getThemes(), getAccounts(), getSavingGoals(), getSettings(),
  ])
  themes.value = themesRes.data
  accounts.value = accountsRes.data
  const goals = goalsRes.data
  const mainAccountId = settingsRes.data.mainAccount?._id || settingsRes.data.mainAccount || null

  // Trier les sheets par periodMonth asc
  sheets.value = [...sheetsRes.data]
    .filter((s) => !s.isTemplate)
    .sort((a, b) => new Date(a.periodMonth) - new Date(b.periodMonth))

  // Charger lignes + entrées + contributions + invest + snapshots de tous les sheets en parallèle
  const results = await Promise.all(
    sheets.value.map(async (s) => {
      const [lRes, cRes, iRes, tRes, snapRes] = await Promise.all([
        getSheetLines(s._id),
        getSheetContributions(s._id),
        getSheetInvestmentTransactions(s._id),
        getSheetTransactions(s._id),
        getSheetSnapshots(s._id),
      ])

      // Dépenses réelles par thème, au niveau des entrées :
      // thème de l'entrée prioritaire, sinon thème de la ligne, sinon "Sans thème"
      const lineTheme = Object.fromEntries(
        lRes.data.map((l) => [l._id, l.theme?._id || l.theme || null])
      )
      const byTheme = {}
      for (const t of tRes.data) {
        if (t.flow !== 'expense') continue
        if (t.source === 'cancellation' || t.source === 'rounding') continue
        const lid = t.budgetLine?._id || t.budgetLine
        const themeId = t.theme?._id || t.theme || (lid && lineTheme[lid]) || 'none'
        byTheme[themeId] = (byTheme[themeId] || 0) + (t.amount || 0)
      }

      // Soldes par compte : snapshot de début de mois,
      // sauf pour le sheet actif où on calcule le solde live (snapshot + mouvements)
      const snapshotMap = buildSnapshotMap(snapRes.data)
      let balances = { ...snapshotMap }
      if (s.status === 'active') {
        const deltaMap = computeAccountDeltaMap({
          lines: lRes.data,
          contributions: cRes.data,
          investmentTxs: iRes.data,
          goals,
          mainAccountId,
        })
        balances = {}
        accountsRes.data.forEach((a) => {
          balances[a._id] = resolveBalance(snapshotMap, deltaMap, a._id)
        })
      }

      return { sheetId: s._id, sheetName: s.name || s._id, byTheme, balances }
    })
  )
  spendByMonth.value = results.map(({ sheetId, sheetName, byTheme }) => ({ sheetId, sheetName, byTheme }))
  investRows.value = results.map(({ sheetId, sheetName, balances }) => ({ sheetId, sheetName, balances }))
  loading.value = false
})

// ─── Épargne & Investissements (une courbe par compte suivi) ──
const investMode = ref('cumul') // 'cumul' (soldes) | 'month' (variation mensuelle)
const ACCOUNT_COLORS = [
  { light: '#2a78d6', dark: '#3987e5' },
  { light: '#eb6834', dark: '#d95926' },
  { light: '#4a3aa7', dark: '#9085e9' },
  { light: '#0d9488', dark: '#2dd4bf' },
  { light: '#d97706', dark: '#fbbf24' },
  { light: '#db2777', dark: '#f472b6' },
]

// Comptes épargne cochés "Graphe épargne" dans les Paramètres
const trackedAccounts = computed(() =>
  accounts.value.filter((a) => a.type === 'savings' && a.trackInSavingsChart !== false)
)

const investHidden = ref(new Set())
function toggleInvest(key) {
  const s = new Set(investHidden.value)
  s.has(key) ? s.delete(key) : s.add(key)
  investHidden.value = s
}

const investSeries = computed(() =>
  trackedAccounts.value.map((acc, i) => {
    const palette = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]
    let prev = null
    const data = investRows.value.map((r) => {
      const balance = r.balances[acc._id] ?? null
      let value = balance
      if (investMode.value === 'month') {
        value = balance != null && prev != null ? Math.round((balance - prev) * 100) / 100 : null
      }
      if (balance != null) prev = balance
      return { sheetId: r.sheetId, sheetName: r.sheetName, value }
    })
    return { key: acc._id, label: acc.name, ...palette, data }
  })
)
const hasInvestData = computed(() =>
  investRows.value.some((r) => trackedAccounts.value.some((a) => r.balances[a._id] != null))
)
function investColor(def) {
  return isDark.value ? def.dark : def.light
}

// ─── Agrégation par thème / sheet ─────────────────────────
// series = [{ theme, color, data: [{ sheetId, sheetName, amount }] }]
// Montants réels uniquement (entrées), agrégés dans spendByMonth
const NO_THEME = { _id: 'none', name: 'Sans thème', color: '#9ca3af' }

const series = computed(() => {
  if (!spendByMonth.value.length) return []

  return [...themes.value, NO_THEME].map((theme) => {
    const data = spendByMonth.value.map(({ sheetId, sheetName, byTheme }) => ({
      sheetId,
      sheetName,
      amount: Math.round((byTheme[theme._id] || 0) * 100) / 100,
    }))
    const hasData = data.some((d) => d.amount > 0)
    return { theme, color: theme.color || null, data, hasData }
  }).filter((s) => s.hasData)
})

// ─── Comparatif 3 mois vs 3 mois précédents ───────────────
// Fenêtres calendaires glissantes basées sur le mois courant :
// A = M-6..M-4, B = M-3..M-1 (mois révolus uniquement, le mois en cours est exclu)
const monthIndexOf = (d) => {
  const dt = new Date(d)
  return dt.getUTCFullYear() * 12 + dt.getUTCMonth()
}
const MONTH_SHORT = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']
function windowLabel(win) {
  const first = win[0], last = win[win.length - 1]
  const m = (k) => MONTH_SHORT[((k % 12) + 12) % 12]
  const y = (k) => Math.floor(k / 12)
  return y(first) === y(last)
    ? `${m(first)} – ${m(last)} ${y(last)}`
    : `${m(first)} ${y(first)} – ${m(last)} ${y(last)}`
}

const comparison = computed(() => {
  if (!spendByMonth.value.length) return null

  // byTheme de chaque sheet, indexé par mois calendaire
  const periodBySheet = Object.fromEntries(sheets.value.map((s) => [s._id, s.periodMonth]))
  const byMonth = {}
  spendByMonth.value.forEach((r) => {
    const pm = periodBySheet[r.sheetId]
    if (pm) byMonth[monthIndexOf(pm)] = r.byTheme
  })

  const now = new Date()
  const cur = now.getFullYear() * 12 + now.getMonth()
  const winA = [cur - 6, cur - 5, cur - 4]
  const winB = [cur - 3, cur - 2, cur - 1]
  const sumWin = (win, themeId) => win.reduce((a, k) => a + (byMonth[k]?.[themeId] || 0), 0)

  const rows = [...themes.value, NO_THEME]
    .map((theme) => {
      const a = Math.round(sumWin(winA, theme._id))
      const b = Math.round(sumWin(winB, theme._id))
      return {
        theme,
        a,
        b,
        delta: b - a,
        pct: a > 0 ? Math.round(((b - a) / a) * 100) : null,
      }
    })
    .filter((r) => r.a > 0 || r.b > 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))

  return rows.length ? { rows, labelA: windowLabel(winA), labelB: windowLabel(winB) } : null
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

// Position d'un tooltip fixed, recadrée pour rester dans la fenêtre
// (w/h = dimensions approximatives du tooltip)
function clampTip(event, w, h) {
  let x = event.clientX + 14
  let y = event.clientY - 28
  if (x + w > window.innerWidth - 8) x = event.clientX - w - 14
  if (y + h > window.innerHeight - 8) y = event.clientY - h - 14
  return { x: Math.max(8, x), y: Math.max(8, y) }
}

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
    .call(d3.axisLeft(yScale).ticks(6).tickFormat((d) => d + ' ' + currencySymbol.value))
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
          ...clampTip(event, 200, 100),
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
  if (!investEl.value || !investRows.value.length) return
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

  const rows = investRows.value
  const sheetIds = rows.map((r) => r.sheetId)
  const nameById = Object.fromEntries(rows.map((r) => [r.sheetId, r.sheetName]))

  const visible = investSeries.value.filter((s) => !investHidden.value.has(s.key))

  const xScale = d3.scalePoint().domain(sheetIds).range([0, W]).padding(0.5)
  // Les valeurs peuvent manquer (pas de snapshot) ou être négatives (mode variation)
  const allVals = visible.flatMap((s) => s.data.map((d) => d.value).filter((v) => v != null))
  const maxVal = d3.max(allVals) || 100
  const minVal = Math.min(0, d3.min(allVals) || 0)
  const yScale = d3.scaleLinear().domain([minVal, maxVal * 1.12]).nice().range([H, 0])

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

  // Axe Y ({{ currencySymbol }})
  g.append('g')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat((d) => d3.format('~s')(d) + ' ' + currencySymbol.value))
    .call((s) => s.select('.domain').remove())
    .call((s) => s.selectAll('line').remove())
    .call((s) => s.selectAll('text').attr('font-size', '11px').attr('fill', ink.axis))

  const lineGen = d3.line()
    .defined((d) => d.value != null)
    .x((d) => xScale(d.sheetId))
    .y((d) => yScale(d.value))
    .curve(d3.curveMonotoneX)
  const surface = dark ? '#12101a' : '#ffffff'

  visible.forEach((serie) => {
    const color = investColor(serie)
    g.append('path')
      .datum(serie.data)
      .attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
      .attr('d', lineGen)

    g.selectAll(`.dot-${serie.key}`)
      .data(serie.data.filter((d) => d.value != null)).join('circle')
      .attr('cx', (d) => xScale(d.sheetId)).attr('cy', (d) => yScale(d.value))
      .attr('r', 4).attr('fill', color).attr('stroke', surface).attr('stroke-width', 2)

    // Label direct en bout de ligne (dernier point renseigné)
    const last = [...serie.data].reverse().find((d) => d.value != null)
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
        ...clampTip(event, 220, 120),
        sheetName: nameById[nearest],
        rows: investSeries.value
          .filter((s) => !investHidden.value.has(s.key))
          .map((s) => ({ label: s.label, color: investColor(s), value: s.data.find((d) => d.sheetId === nearest)?.value ?? null })),
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
        <p class="text-[13px] text-gray-400 mt-0.5">Évolution des dépenses réelles par thème sur tous les sheets</p>
      </div>
    </div>

    <div v-if="loading" class="text-center text-gray-400 text-[13px] py-15">Chargement des données…</div>

    <template v-else>
    <!-- ─── Épargne & Investissements ─────────────────────── -->
    <div v-if="hasInvestData" class="glass-card px-6 py-5 mb-6">
      <div class="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h3 class="text-[15px] font-semibold text-gray-950 dark:text-gray-50">Épargne &amp; Investissements</h3>
        <div class="inline-flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 text-[12px]">
          <button class="px-3 py-1 cursor-pointer" :class="investMode === 'cumul' ? 'bg-violet-600 text-white' : 'bg-transparent text-gray-500 dark:text-gray-400'" @click="investMode = 'cumul'">Soldes</button>
          <button class="px-3 py-1 cursor-pointer border-l border-gray-200 dark:border-gray-700" :class="investMode === 'month' ? 'bg-violet-600 text-white' : 'bg-transparent text-gray-500 dark:text-gray-400'" @click="investMode = 'month'">Variation</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mb-4">
        <button
          v-for="def in investSeries"
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

    </div>

    <!-- ─── Comparatif 3 mois vs 3 mois ─────────────────── -->
    <div v-if="comparison" class="glass-card px-6 py-5 mt-6">
      <div class="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h3 class="text-[15px] font-semibold text-gray-950 dark:text-gray-50">Comparatif par thème</h3>
        <div class="text-[12.5px] text-gray-400">
          <span class="font-medium text-gray-500 dark:text-gray-300">{{ comparison.labelA }}</span>
          <span class="mx-1.5">vs</span>
          <span class="font-medium text-gray-500 dark:text-gray-300">{{ comparison.labelB }}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
        <div
          v-for="r in comparison.rows"
          :key="r.theme._id"
          class="flex items-center gap-2.5 py-1.5 border-b border-gray-100 dark:border-gray-700/60 last:border-b-0 md:nth-last-2:border-b-0"
        >
          <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: r.theme.color || '#9ca3af' }"></span>
          <span class="text-[13px] text-gray-700 dark:text-gray-200 flex-1 truncate">{{ r.theme.name }}</span>
          <span class="text-[12.5px] text-gray-400 tabular-nums w-18 text-right">{{ r.a }} {{ currencySymbol }}</span>
          <font-awesome-icon icon="arrow-right" class="text-[10px] text-gray-300 dark:text-gray-600" />
          <span class="text-[13px] font-semibold text-gray-950 dark:text-gray-50 tabular-nums w-18 text-right">{{ r.b }} {{ currencySymbol }}</span>
          <span
            class="text-[11.5px] font-semibold tabular-nums w-16 text-right px-1.5 py-0.5 rounded-full"
            :class="r.delta > 0
              ? 'bg-red-50 dark:bg-red-900/25 text-red-600 dark:text-red-400'
              : r.delta < 0
                ? 'bg-green-50 dark:bg-green-900/25 text-green-600 dark:text-green-400'
                : 'bg-gray-100 dark:bg-gray-700/60 text-gray-400'"
          >
            <template v-if="r.pct === null">nouveau</template>
            <template v-else-if="r.delta === 0">=</template>
            <template v-else>{{ r.pct > 0 ? '+' : '' }}{{ r.pct }} %</template>
          </span>
        </div>
      </div>
    </div>
    </template>

    <!-- Tooltips téléportés dans <body> : un ancêtre avec backdrop-filter
         (glass-card) détournerait le référentiel de position:fixed -->
    <teleport to="body">
      <!-- Tooltip Dépenses par thème -->
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
        <div class="font-bold text-[14px] text-white">{{ fmt(tooltip.amount) }} {{ currencySymbol }}</div>
      </div>

      <!-- Tooltip Épargne & Investissements -->
      <div
        v-if="investTip.visible"
        class="fixed bg-gray-900 text-white rounded-lg px-3.5 py-2.5 text-[12.5px] pointer-events-none z-9999 flex flex-col gap-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.2)] min-w-40"
        :style="{ left: investTip.x + 'px', top: investTip.y + 'px' }"
      >
        <div class="text-gray-300 text-[11.5px] font-medium">{{ investTip.sheetName }}</div>
        <div v-for="r in investTip.rows" :key="r.label" class="flex items-center justify-between gap-4">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full shrink-0" :style="{ background: r.color }"></span>{{ r.label }}</span>
          <span class="font-bold">{{ r.value == null ? '—' : fmt(r.value) + ' ' + currencySymbol }}</span>
        </div>
      </div>
    </teleport>
  </div>
</template>
