<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { getStats } from '@/api/stats.js'
import LineChart from '@/components/LineChart.vue'
import DonutChart from '@/components/DonutChart.vue'
import HelpTip from '@/components/HelpTip.vue'
import { apiError } from '@/composables/useDialog.js'

const stats = ref(null)
onMounted(async () => {
  try {
    stats.value = (await getStats()).data
    if (stats.value.themes.length) activeThemes.value = new Set([stats.value.themes[0].id])
    donutPeriod.value = periods.value[periods.value.length - 1] || ''
  } catch (e) { apiError(e) }
})

// ─── Filtre de période : une ligne au-dessus, il scope les quatre blocs ───
const range = ref('all')
const RANGES = [
  { value: '3', label: '3 mois' },
  { value: '6', label: '6 mois' },
  { value: '12', label: '12 mois' },
  { value: 'all', label: 'Tout' },
]
const allPeriods = computed(() => stats.value?.periods || [])
const periods = computed(() => (range.value === 'all' ? allPeriods.value : allPeriods.value.slice(-Number(range.value))))
const offset = computed(() => allPeriods.value.length - periods.value.length)
const slice = (points) => points.slice(offset.value)
const labels = computed(() => periods.value.map((p) => {
  const [y, m] = p.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}))
const monthName = (p) => {
  if (!p) return ''
  const [y, m] = p.split('-').map(Number)
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const fmt = (n) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const fmtOrDash = (n) => (n === null || n === undefined ? '—' : fmt(n))

// ─── 1. Épargne & investissements — couleur par compte, ordre fixe de la palette ───
const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const savingsHidden = ref(new Set())
const savingsAll = computed(() => (stats.value?.savings || []).map((s, i) => ({
  key: 'a' + s.accountId, id: s.accountId, name: s.name, color: SLOTS[i % SLOTS.length], points: slice(s.points),
})))
const savingsVisible = computed(() => savingsAll.value.filter((s) => !savingsHidden.value.has(s.id)))
function toggleSavings(id) {
  const set = new Set(savingsHidden.value)
  set.has(id) ? set.delete(id) : set.add(id)
  savingsHidden.value = set
}

// ─── 2. Thèmes — couleur du thème (la même que partout dans l'app), lissé sur la période ───
const activeThemes = ref(new Set())
const themesAll = computed(() => stats.value?.themes || [])
const themeSeries = computed(() => themesAll.value
  .filter((t) => activeThemes.value.has(t.id))
  .map((t) => ({ key: 't' + t.id, name: t.name, color: t.color, points: slice(t.points) })))
function toggleTheme(id) {
  const set = new Set(activeThemes.value)
  set.has(id) ? set.delete(id) : set.add(id)
  activeThemes.value = set
}
// Coût par mois lissé : total de la période / nombre de mois (les mois à zéro comptent)
const smoothed = (t) => {
  const pts = slice(t.points)
  if (!pts.length) return 0
  return Math.round((pts.reduce((s, v) => s + (v || 0), 0) / pts.length) * 100) / 100
}

// ─── 3. Catégories (hors transferts) — toutes affichées, masquables ───
const catsHidden = ref(new Set())
const catsAll = computed(() => (stats.value?.categories || []).map((c) => ({
  key: 'c' + c.id, id: c.id, name: c.name, color: c.color, type: c.type, points: slice(c.points),
})))
const catsVisible = computed(() => catsAll.value.filter((c) => !catsHidden.value.has(c.id)))
function toggleCat(id) {
  const set = new Set(catsHidden.value)
  set.has(id) ? set.delete(id) : set.add(id)
  catsHidden.value = set
}

// ─── 4. Répartition d'un mois : réel (anneau extérieur) vs prévu (intérieur) ───
const donutPeriod = ref('')
watch(periods, (p) => { if (!p.includes(donutPeriod.value)) donutPeriod.value = p[p.length - 1] || '' })
const TYPE_META = [
  { key: 'revenu', label: 'Revenus', color: '#1baf7a' },
  { key: 'depense', label: 'Dépenses', color: '#e34948' },
  { key: 'epargne', label: 'Épargne', color: '#4a3aa7' },
]
const donutData = computed(() => {
  const t = (stats.value?.types || []).find((x) => x.period === donutPeriod.value)
  if (!t) return null
  return {
    outer: TYPE_META.map((m) => ({ label: m.label, value: t.real[m.key], color: m.color })),
    inner: TYPE_META.map((m) => ({ label: m.label, value: t.planned[m.key], color: m.color })),
    reste: Math.round((t.real.revenu - t.real.depense - t.real.epargne) * 100) / 100,
    t,
  }
})
</script>

<template>
  <div>
    <!-- ─── En-tête + filtre de période ─────────────── -->
    <div class="flex items-start justify-between mb-5">
      <div>
        <h1 class="text-[22px] font-semibold">Stats</h1>
        <p class="text-[13px] text-gray-400 mt-0.5 flex items-center gap-1.5">
          Vos chiffres dans le temps
          <HelpTip wide text="Le réel vient de vos entrées, comme partout. Les virements système et les catégories « transfert » sont exclus des dépenses. La période choisie s'applique aux quatre blocs ; cliquez une pastille pour masquer/afficher une courbe, survolez pour lire les valeurs, « tableau » pour les chiffres exacts." />
        </p>
      </div>
      <div class="flex gap-1">
        <button v-for="r in RANGES" :key="r.value" class="range-btn" :class="{ 'range-btn--on': range === r.value }" @click="range = r.value">{{ r.label }}</button>
      </div>
    </div>

    <div v-if="!stats" class="text-center py-16 text-gray-400">Chargement…</div>

    <template v-else>
      <!-- ─── 1. Épargne & investissements ──────────── -->
      <div class="card mb-4">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="font-semibold text-[14px]">Épargne &amp; investissements</h2>
          <HelpTip text="Le solde de début de chaque mois (celui que vous saisissez à la création du mois), par compte épargne et investissement. Cliquez un compte pour masquer sa courbe." />
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3">
          <button v-for="s in savingsAll" :key="s.key" class="chip" :class="{ 'chip--off': savingsHidden.has(s.id) }" @click="toggleSavings(s.id)">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: s.color }" />{{ s.name }}
          </button>
        </div>
        <LineChart :labels="labels" :series="savingsVisible" />
        <details class="mt-2">
          <summary class="text-[11.5px] text-gray-400 cursor-pointer hover:text-gray-600">tableau</summary>
          <div class="overflow-x-auto mt-2">
            <table class="stat-table">
              <thead><tr><th></th><th v-for="(l, i) in labels" :key="i">{{ l }}</th></tr></thead>
              <tbody>
                <tr v-for="s in savingsAll" :key="s.key"><td>{{ s.name }}</td><td v-for="(v, i) in s.points" :key="i">{{ fmtOrDash(v) }}</td></tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <!-- ─── 2. Dépenses par thème ─────────────────── -->
      <div class="card mb-4">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="font-semibold text-[14px]">Dépenses par thème</h2>
          <HelpTip wide text="Les dépenses réelles portant chaque thème, mois par mois. Activez un thème pour voir sa courbe et son coût par mois lissé sur la période (les mois à zéro comptent : un abonnement annuel de 70 € pèse ≈ 5,83 €/mois)." />
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3">
          <button v-for="t in themesAll" :key="t.id" class="chip" :class="{ 'chip--off': !activeThemes.has(t.id) }" @click="toggleTheme(t.id)">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: t.color }" />{{ t.name }}
            <span v-if="activeThemes.has(t.id)" class="text-gray-400 font-normal">≈ {{ fmt(smoothed(t)) }}/mois</span>
          </button>
        </div>
        <LineChart :labels="labels" :series="themeSeries" />
        <details class="mt-2">
          <summary class="text-[11.5px] text-gray-400 cursor-pointer hover:text-gray-600">tableau</summary>
          <div class="overflow-x-auto mt-2">
            <table class="stat-table">
              <thead><tr><th></th><th v-for="(l, i) in labels" :key="i">{{ l }}</th><th>lissé</th></tr></thead>
              <tbody>
                <tr v-for="t in themesAll" :key="t.id"><td>{{ t.name }}</td><td v-for="(v, i) in slice(t.points)" :key="i">{{ fmt(v) }}</td><td class="font-semibold">{{ fmt(smoothed(t)) }}</td></tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <!-- ─── 3. Réel par catégorie ─────────────────── -->
      <div class="card mb-4">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="font-semibold text-[14px]">Réel par catégorie</h2>
          <HelpTip text="Le réel de chaque catégorie mois par mois — dépenses, revenus et épargne ensemble, les transferts exclus. Cliquez une pastille pour masquer une courbe." />
        </div>
        <div class="flex flex-wrap gap-1.5 mb-3">
          <button v-for="c in catsAll" :key="c.key" class="chip" :class="{ 'chip--off': catsHidden.has(c.id) }" @click="toggleCat(c.id)">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: c.color }" />{{ c.name }}
          </button>
        </div>
        <LineChart :labels="labels" :series="catsVisible" />
        <details class="mt-2">
          <summary class="text-[11.5px] text-gray-400 cursor-pointer hover:text-gray-600">tableau</summary>
          <div class="overflow-x-auto mt-2">
            <table class="stat-table">
              <thead><tr><th></th><th v-for="(l, i) in labels" :key="i">{{ l }}</th></tr></thead>
              <tbody>
                <tr v-for="c in catsAll" :key="c.key"><td>{{ c.name }}</td><td v-for="(v, i) in c.points" :key="i">{{ fmt(v) }}</td></tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <!-- ─── 4. Répartition d'un mois (réel vs prévu) ── -->
      <div class="card mb-4">
        <div class="flex items-center gap-2 mb-2">
          <h2 class="font-semibold text-[14px]">Répartition du mois</h2>
          <HelpTip wide text="Revenus, dépenses et épargne du mois choisi : l'anneau extérieur est le réel, l'intérieur (délavé) le prévu. Le centre affiche le reste réel (revenus − dépenses − épargne). Transferts exclus." />
          <select v-model="donutPeriod" class="input ml-auto w-44">
            <option v-for="p in periods" :key="p" :value="p">{{ monthName(p) }}</option>
          </select>
        </div>
        <div v-if="donutData" class="flex flex-wrap items-center gap-8">
          <DonutChart
            :outer="donutData.outer"
            :inner="donutData.inner"
            :center="{ value: fmt(donutData.reste), label: 'reste réel' }"
          />
          <div class="flex flex-col gap-2 text-[13px]">
            <div v-for="(m, i) in TYPE_META" :key="m.key" class="flex items-center gap-2.5">
              <span class="w-3 h-3 rounded shrink-0" :style="{ background: m.color }" />
              <span class="w-20 text-gray-500">{{ m.label }}</span>
              <span class="font-semibold w-24 text-right" style="font-variant-numeric: tabular-nums">{{ fmt(donutData.outer[i].value) }}</span>
              <span class="text-gray-400 text-[11.5px]">prévu {{ fmt(donutData.inner[i].value) }}</span>
            </div>
            <p class="text-[11.5px] text-gray-400 mt-1">Extérieur : réel · intérieur : prévu</p>
          </div>
        </div>
        <p v-else class="text-xs text-gray-400 py-6 text-center">Aucun mois sur la période.</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
@reference "@/style.css";

.card { @apply bg-white rounded-xl border border-stone-200 px-5 py-4; }
.range-btn { @apply px-3 py-1.5 rounded-lg text-[12.5px] font-medium text-gray-500 bg-white border border-stone-200 hover:bg-stone-50 cursor-pointer; }
.range-btn--on { @apply bg-violet-50 text-violet-700 border-violet-200; }
.chip { @apply flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium text-gray-700 bg-white border border-stone-200 hover:bg-stone-50 cursor-pointer; }
.chip--off { @apply opacity-40; }
.input { @apply py-1.5 px-2 border border-stone-200 rounded-md text-[13px] text-gray-900 bg-white outline-none focus:border-violet-400; }
.stat-table { @apply text-[11.5px] text-gray-600 border-collapse; }
.stat-table th { @apply text-left font-semibold text-gray-400 px-2 py-1 whitespace-nowrap; }
.stat-table td { @apply px-2 py-1 whitespace-nowrap border-t border-stone-100; font-variant-numeric: tabular-nums; }
.stat-table td:first-child { @apply font-medium text-gray-700; }
</style>
