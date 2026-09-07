<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { getStats } from '@/api/stats.js'
import BarChart from '@/components/BarChart.vue'
import StackedAreaChart from '@/components/StackedAreaChart.vue'
import SeriesPicker from '@/components/SeriesPicker.vue'
import { apiError } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

const stats = ref(null)
onMounted(async () => {
  try {
    stats.value = (await getStats()).data
    initSelections()
    repPeriod.value = basePeriods.value.at(-1) || allPeriods.value.at(-1) || ''
  } catch (e) { apiError(e) }
})

const fmt = eur

// ─── Périodes : le mois en cours est exclu par défaut (falaise de septembre, §1.1) ───
const nowPeriod = new Date().toISOString().slice(0, 7)
const includeCurrent = ref(false)
const allPeriods = computed(() => stats.value?.periods || [])
const hasCurrent = computed(() => allPeriods.value.includes(nowPeriod))
const basePeriods = computed(() => (includeCurrent.value ? allPeriods.value : allPeriods.value.filter((p) => p !== nowPeriod)))

const range = ref('all')
const RANGES = [
  { value: '3', label: '3 mois' },
  { value: '6', label: '6 mois' },
  { value: '12', label: '12 mois' },
  { value: 'all', label: 'Tout' },
]
const periods = computed(() => (range.value === 'all' ? basePeriods.value : basePeriods.value.slice(-Number(range.value))))
// Découpe par INDEX de période, pas par tranche contiguë : quand le mois en cours est exclu
// mais qu'un mois suivant existe déjà (créé en avance), la liste a un trou au milieu — une
// tranche contiguë décalerait toutes les valeurs d'un cran sous les mauvais labels (revue 04/09)
const sliceIdxs = computed(() => periods.value.map((p) => allPeriods.value.indexOf(p)))

/**
 * Extrait d'une série complète les seules valeurs des périodes affichées.
 *
 * On pioche par indice, jamais par tranche : toutes les séries arrivent alignées sur
 * `allPeriods`, et c'est cet alignement qui garantit qu'une valeur reste sous son mois.
 *
 * @param {Array<number|null>} points La série complète, alignée sur allPeriods.
 * @returns {Array<number|null>} Les valeurs des périodes visibles, dans l'ordre.
 */
const slice = (points) => sliceIdxs.value.map((i) => points[i])

// Libellés courts de l'axe X (« sept. 26 ») ; UTC pour ne pas glisser d'un mois
// selon le fuseau, le 1er du mois à minuit local pouvant tomber la veille
const labels = computed(() => periods.value.map((p) => {
  const [y, m] = p.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}))

/**
 * Écrit une période en toutes lettres, pour un titre (« Septembre 2026 »).
 *
 * @param {string} p La période au format AAAA-MM.
 * @returns {string} Le mois et l'année, première lettre en majuscule.
 */
const monthName = (p) => {
  if (!p) return ''
  const [y, m] = p.split('-').map(Number)
  const s = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Palette stable : une entité garde sa couleur, affectée par rang de montant (§4) ───
const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']
const OTHER = 'var(--chart-other)'
// Somme d'une série sur tout l'historique, trous comptés pour zéro
const totalOf = (points) => points.reduce((s, v) => s + (v || 0), 0)

/**
 * Attribue une couleur à chaque entité, par rang de montant.
 *
 * Le rang est calculé sur l'historique COMPLET, pas sur la période affichée : sans
 * cela, changer de fenêtre (3 mois → 12 mois) redistribuerait les couleurs et le
 * lecteur perdrait ses repères d'un graphique à l'autre. Le modulo fait boucler la
 * palette au-delà de six entités — celles-là finissent de toute façon dans « Autres ».
 *
 * @param {Array<{id: number, points: number[]}>} list Les entités à colorer.
 * @returns {Map<number, string>} L'identifiant de chaque entité vers sa couleur.
 */
const colorMapOf = (list) => {
  const ranked = [...list].sort((a, b) => totalOf(b.points) - totalOf(a.points))
  return new Map(ranked.map((e, i) => [e.id, PALETTE[i % PALETTE.length]]))
}

/**
 * Moyenne mensuelle d'une série sur la période affichée.
 *
 * Sert à classer les entités dans le sélecteur : « ce poste me coûte X par mois ».
 *
 * @param {Array<number|null>} points La série complète.
 * @returns {number} La moyenne, arrondie au centime.
 */
const avgOf = (points) => {
  const p = slice(points)
  return p.length ? Math.round((p.reduce((s, v) => s + (v || 0), 0) / p.length) * 100) / 100 : 0
}

// ─── Collections ─────────────────────────────────────────
// Patrimoine : un solde est un STOCK, pas un flux — un mois sans relevé ne vaut pas
// zéro, il vaut encore le dernier solde connu. On comble donc les trous en reportant
// la dernière valeur, sinon la courbe plongerait à zéro puis remonterait. `raw` garde
// les valeurs d'origine, avec leurs trous, pour l'affichage en tableau.
const savingsRaw = computed(() => (stats.value?.savings || []).map((s) => {
  let last = 0
  return { id: s.accountId, name: s.name, points: s.points.map((v) => (v === null || v === undefined ? last : (last = v))), raw: s.points }
}))
const envsRaw = computed(() => (stats.value?.envelopes || []).map((e) => ({ id: e.id, name: e.name + (e.isClosed ? ' (clôturée)' : ''), points: e.points })))
const themesRaw = computed(() => (stats.value?.themes || []).map((t) => ({ id: t.id, name: t.name, points: t.points })))
const catsRaw = computed(() => (stats.value?.categories || []).filter((c) => c.type === 'depense').map((c) => ({ id: c.id, name: c.name, points: c.points })))

const savingsColors = computed(() => colorMapOf(savingsRaw.value))
const envColors = computed(() => colorMapOf(envsRaw.value))
const themeColors = computed(() => colorMapOf(themesRaw.value))
const catColors = computed(() => colorMapOf(catsRaw.value))

// ─── Sélections (§5) : top 5 par montant + « Autres » par défaut ───
const savingsSel = ref([])
const envSel = ref([])
const themeSel = ref([])
const catSel = ref([])
// Les n entités qui pèsent le plus lourd sur tout l'historique
const topIds = (raw, n) => [...raw].sort((a, b) => totalOf(b.points) - totalOf(a.points)).slice(0, n).map((e) => e.id)

/**
 * Choisit ce qui est tracé à l'ouverture de la page.
 *
 * Tout afficher donnerait un graphique illisible à trente séries : on part des plus
 * gros postes, le reste étant regroupé dans « Autres ». L'utilisateur ajuste ensuite
 * par le sélecteur.
 */
function initSelections() {
  savingsSel.value = topIds(savingsRaw.value, 6)
  envSel.value = topIds(envsRaw.value, 6)
  themeSel.value = topIds(themesRaw.value, 5)
  catSel.value = topIds(catsRaw.value, 5)
}

/**
 * Prépare la liste d'un sélecteur : nom, couleur et montant, du plus gros au plus petit.
 *
 * `valueOf` diffère selon la nature de la donnée : moyenne mensuelle pour un flux
 * (dépenses, versements), dernière valeur connue pour un stock (solde de compte).
 *
 * @param {import('vue').Ref<Array>} raw Les entités de la collection.
 * @param {import('vue').Ref<Map>} colors La table des couleurs de cette collection.
 * @param {(entity: object) => number} valueOf Le montant à afficher et à trier.
 * @returns {Array<{id: number, name: string, color: string, avg: number}>}
 */
const makeItems = (raw, colors, valueOf) => [...raw.value]
  .map((e) => ({ id: e.id, name: e.name, color: colors.value.get(e.id), avg: valueOf(e) }))
  .sort((a, b) => b.avg - a.avg)
const savingsItems = computed(() => makeItems(savingsRaw, savingsColors, (e) => slice(e.points).at(-1) ?? 0))
const envItems = computed(() => makeItems(envsRaw, envColors, (e) => avgOf(e.points)))
const themeItems = computed(() => makeItems(themesRaw, themeColors, (e) => avgOf(e.points)))
const catItems = computed(() => makeItems(catsRaw, catColors, (e) => avgOf(e.points)))

/**
 * Compose les séries à tracer : la sélection, plus un agrégat « Autres ».
 *
 * Regrouper le reste plutôt que de le masquer garde les totaux justes — sans cela, la
 * somme des bandes d'une aire empilée ne vaudrait plus le total réel. « Autres » n'est
 * ajouté que s'il pèse quelque chose, pour ne pas traîner une série vide.
 *
 * @param {Array} raw Toutes les entités de la collection.
 * @param {Array<number>} selectedIds Les entités à tracer nommément.
 * @param {Map<number, string>} colors La table des couleurs.
 * @param {object} [options]
 * @param {boolean} [options.withOther] false pour ne pas agréger le reste.
 * @returns {Array<{key: string, name: string, color: string, points: number[]}>}
 */
function buildSeries(raw, selectedIds, colors, { withOther = true } = {}) {
  const inSel = raw.filter((e) => selectedIds.includes(e.id))
    .sort((a, b) => totalOf(b.points) - totalOf(a.points))
  const series = inSel.map((e) => ({ key: 's' + e.id, name: e.name, color: colors.get(e.id), points: slice(e.points) }))
  if (withOther) {
    const others = raw.filter((e) => !selectedIds.includes(e.id))
    if (others.length) {
      const pts = periods.value.map((_, i) => Math.round(others.reduce((s, e) => s + (slice(e.points)[i] || 0), 0) * 100) / 100)
      if (pts.some((v) => v)) series.push({ key: '__other', name: 'Autres', color: OTHER, points: pts })
    }
  }
  return series
}
const savingsSeries = computed(() => buildSeries(savingsRaw.value, savingsSel.value, savingsColors.value))
const envSeries = computed(() => buildSeries(envsRaw.value, envSel.value, envColors.value))
const themeSeries = computed(() => buildSeries(themesRaw.value, themeSel.value, themeColors.value))
const catSeries = computed(() => buildSeries(catsRaw.value, catSel.value, catColors.value))

// Revenus vs dépenses : deux flux, deux barres par mois (réel)
const typesVisible = computed(() => periods.value.map((p) => (stats.value?.types || []).find((t) => t.period === p)))
const revDepSeries = computed(() => [
  { key: 'rev', name: 'Revenus', color: 'var(--chart-3)', points: typesVisible.value.map((t) => t?.real.revenu ?? 0) },
  { key: 'dep', name: 'Dépenses', color: 'var(--chart-1)', points: typesVisible.value.map((t) => t?.real.depense ?? 0) },
])

/**
 * Les chiffres du bandeau de tête, calculés sur la seule période affichée.
 *
 * Le taux d'épargne vaut null quand les revenus sont nuls : afficher 0 % laisserait
 * croire qu'on n'épargne pas, alors qu'on ne peut simplement pas se prononcer.
 * Le patrimoine se lit sur la dernière colonne, et son évolution est l'écart entre la
 * première et la dernière.
 *
 * @returns {{n: number, taux: number|null, epargneMois: number, depensesMois: number,
 *   patrimoine: number, patDelta: number}|null} null tant qu'aucun mois n'est affiché.
 */
const banner = computed(() => {
  const ts = typesVisible.value.filter(Boolean)
  if (!ts.length) return null
  const n = ts.length
  const sumRev = ts.reduce((s, t) => s + t.real.revenu, 0)
  const sumDep = ts.reduce((s, t) => s + t.real.depense, 0)
  const sumEp = ts.reduce((s, t) => s + t.real.epargne, 0)
  const patSeries = periods.value.map((_, i) => savingsRaw.value.reduce((s, a) => s + (slice(a.points)[i] || 0), 0))
  return {
    n,
    taux: sumRev > 0 ? (sumEp / sumRev) * 100 : null,
    epargneMois: sumEp / n,
    depensesMois: sumDep / n,
    patrimoine: patSeries.at(-1) ?? 0,
    patDelta: (patSeries.at(-1) ?? 0) - (patSeries[0] ?? 0),
  }
})

// ─── Répartition du mois (§6) : prévu vs réel, même échelle (revenus prévus) ───
const repPeriod = ref('')
watch(allPeriods, (p) => { if (!p.includes(repPeriod.value)) repPeriod.value = basePeriods.value.at(-1) || p.at(-1) || '' })
const repIdx = computed(() => allPeriods.value.indexOf(repPeriod.value))
// Mois précédent / suivant du panneau de répartition, sans sortir de l'historique
const repStep = (d) => {
  const i = repIdx.value + d
  if (i >= 0 && i < allPeriods.value.length) repPeriod.value = allPeriods.value[i]
}

/**
 * Prépare la répartition d'un mois : prévu d'un côté, réel de l'autre.
 *
 * Les deux barres partagent volontairement la MÊME échelle — le plus grand des quatre
 * totaux — pour qu'on puisse les comparer d'un coup d'œil. Deux échelles autonomes
 * donneraient deux barres pleines et masqueraient l'écart, qui est tout l'intérêt.
 *
 * @returns {object|null} Les segments en pourcentage et les restes en euros, ou null.
 */
const rep = computed(() => {
  const t = (stats.value?.types || []).find((x) => x.period === repPeriod.value)
  if (!t) return null
  const scale = Math.max(t.planned.revenu, t.real.revenu, t.planned.depense + t.planned.epargne, t.real.depense + t.real.epargne, 1)
  const seg = (v) => Math.max(0, (v / scale) * 100)
  return {
    t, scale,
    planned: { dep: seg(t.planned.depense), ep: seg(t.planned.epargne), reste: Math.round((t.planned.revenu - t.planned.depense - t.planned.epargne) * 100) / 100 },
    real: { dep: seg(t.real.depense), ep: seg(t.real.epargne), reste: Math.round((t.real.revenu - t.real.depense - t.real.epargne) * 100) / 100 },
    realEmpty: !t.real.depense && !t.real.epargne && !t.real.revenu,
  }
})

// ─── Vue Graphique / Tableau par panneau (§9) ───
const views = ref({ pat: 'chart', env: 'chart', themes: 'chart', revdep: 'chart', cats: 'chart' })
const setView = (k, v) => { views.value = { ...views.value, [k]: v } }

/**
 * Prépare les lignes de la vue Tableau d'un panneau.
 *
 * Contrairement aux graphiques, le tableau montre TOUTES les entités, sans « Autres » :
 * on vient y chercher un chiffre précis. Il affiche aussi `raw` quand elle existe —
 * les soldes non relevés y restent des trous (« — ») plutôt que d'être comblés, pour
 * ne pas faire passer un report pour une mesure.
 *
 * @param {Array} raw Les entités de la collection.
 * @param {Map<number, string>} colors La table des couleurs.
 * @returns {Array<{id: number, name: string, color: string, cells: Array, avg: number}>}
 */
const tableRows = (raw, colors) => [...raw]
  .sort((a, b) => totalOf(b.points) - totalOf(a.points))
  .map((e) => ({ id: e.id, name: e.name, color: colors.get(e.id), cells: slice(e.raw || e.points), avg: avgOf(e.points) }))

// Ligne de total du tableau : une somme par colonne, donc par mois
const colTotals = (rows) => periods.value.map((_, i) => rows.reduce((s, r) => s + (r.cells[i] || 0), 0))
// Un montant inconnu s'affiche « — » : ne rien savoir n'est pas valoir zéro
const fmtOrDash = (n) => (n === null || n === undefined ? '—' : fmt(n))
const pct0 = (n) => Math.round(n) + ' %'
</script>

<template>
  <div>
    <!-- ─── En-tête + filtre de période ─────────────── -->
    <div class="flex items-start justify-between mb-4">
      <div>
        <h1 class="text-[22px] font-semibold">Stats</h1>
        <p class="page-sub">Vos chiffres dans le temps</p>
      </div>
      <div class="flex gap-1">
        <button v-for="r in RANGES" :key="r.value" class="range-btn" :class="{ 'is-on': range === r.value }" @click="range = r.value">{{ r.label }}</button>
      </div>
    </div>

    <p v-if="hasCurrent" class="exclude-note">
      <template v-if="!includeCurrent">{{ monthName(nowPeriod) }} exclu — mois en cours.</template>
      <label class="checkbox"><input v-model="includeCurrent" type="checkbox" /> Inclure le mois en cours</label>
    </p>

    <div v-if="!stats" class="panel empty-panel">Chargement…</div>

    <template v-else>
      <!-- ─── Bandeau : la page s'ouvre sur des chiffres (§8) ── -->
      <div v-if="banner" class="panel bandeau">
        <div class="synth-hero">
          <span class="num synth-solde">{{ banner.taux === null ? '—' : pct0(banner.taux) }}</span>
          <span class="synth-sub has-tip" title="Épargne réelle (contributions aux enveloppes + versements d'investissement + lignes épargne) rapportée aux revenus réels, sur la période affichée.">Taux d'épargne <span class="meta">moyen, {{ banner.n }} mois</span></span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k">Épargne / mois</span>
          <span class="num synth-v">{{ fmt(banner.epargneMois) }}</span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k">Dépenses / mois</span>
          <span class="num synth-v">{{ fmt(banner.depensesMois) }}</span>
        </div>
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k">Patrimoine épargne + invest</span>
          <span class="num synth-v">{{ fmt(banner.patrimoine) }}</span>
          <span class="num synth-v2 meta">{{ banner.patDelta >= 0 ? '+' : '−' }}{{ fmt(Math.abs(banner.patDelta)) }} sur {{ banner.n }} mois</span>
        </div>
      </div>

      <!-- ─── 1. Patrimoine par compte (stock → aire empilée) ── -->
      <div class="panel chart-panel">
        <div class="panel-head">
          <h2 class="panel-title has-tip" title="Le solde de début de chaque mois par compte épargne et investissement, empilé : la hauteur totale est votre patrimoine, la ligne noire son total. Un mois sans solde saisi reprend le dernier connu.">Patrimoine par compte</h2>
          <div class="panel-tools">
            <SeriesPicker v-model:selected="savingsSel" :items="savingsItems" word="comptes" />
            <span class="view-tabs">
              <button class="view-tab" :class="{ 'is-active': views.pat === 'chart' }" @click="setView('pat', 'chart')">Graphique</button>
              <button class="view-tab" :class="{ 'is-active': views.pat === 'table' }" @click="setView('pat', 'table')">Tableau</button>
            </span>
          </div>
        </div>
        <template v-if="views.pat === 'chart'">
          <StackedAreaChart :labels="labels" :series="savingsSeries" :height="260" />
          <div class="legend">
            <span v-for="s in savingsSeries" :key="s.key" class="legend-item">
              <span class="legend-dot" :style="{ background: s.color }" />{{ s.name }}
              <span class="num meta" :title="fmt(s.points.at(-1) ?? 0) + ' — dernière valeur'">{{ fmt(s.points.at(-1) ?? 0) }}</span>
            </span>
          </div>
        </template>
        <div v-else class="table-wrap">
          <table class="stat-table">
            <thead><tr><th scope="col"></th><th v-for="(l, i) in labels" :key="i" scope="col">{{ l }}</th></tr></thead>
            <tbody>
              <tr v-for="r in tableRows(savingsRaw, savingsColors)" :key="r.id">
                <th scope="row"><span class="legend-dot" :style="{ background: r.color }" />{{ r.name }}</th>
                <td v-for="(v, i) in r.cells" :key="i" class="num">{{ fmtOrDash(v) }}</td>
              </tr>
              <tr class="row-total">
                <th scope="row">Total</th>
                <td v-for="(v, i) in periods" :key="i" class="num">{{ fmt(savingsRaw.reduce((s, a) => s + (slice(a.points)[i] || 0), 0)) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ─── 2. Deux flux côte à côte ────────────────── -->
      <div class="two-col">
        <div class="panel chart-panel">
          <div class="panel-head">
            <h2 class="panel-title has-tip" title="Les contributions « normales » de chaque enveloppe, mois par mois (recalages et réaffectations exclus) — le flux d'épargne.">Versé par enveloppe, par mois</h2>
            <div class="panel-tools">
              <SeriesPicker v-model:selected="envSel" :items="envItems" word="enveloppes" />
              <span class="view-tabs">
                <button class="view-tab" :class="{ 'is-active': views.env === 'chart' }" @click="setView('env', 'chart')">Graphique</button>
                <button class="view-tab" :class="{ 'is-active': views.env === 'table' }" @click="setView('env', 'table')">Tableau</button>
              </span>
            </div>
          </div>
          <template v-if="views.env === 'chart'">
            <BarChart :labels="labels" :series="envSeries" :height="240" />
            <div class="legend">
              <span v-for="s in envSeries" :key="s.key" class="legend-item">
                <span class="legend-dot" :style="{ background: s.color }" />{{ s.name }}
                <span class="num meta" :title="fmt(avgOf(s.points)) + ' par mois en moyenne'">{{ fmt(avgOf(s.points)) }}</span>
              </span>
            </div>
          </template>
          <div v-else class="table-wrap">
            <table class="stat-table">
              <thead><tr><th scope="col"></th><th v-for="(l, i) in labels" :key="i" scope="col">{{ l }}</th><th scope="col">moyenne</th></tr></thead>
              <tbody>
                <tr v-for="r in tableRows(envsRaw, envColors)" :key="r.id">
                  <th scope="row"><span class="legend-dot" :style="{ background: r.color }" />{{ r.name }}</th>
                  <td v-for="(v, i) in r.cells" :key="i" class="num">{{ fmt(v) }}</td>
                  <td class="num row-avg">{{ fmt(r.avg) }}</td>
                </tr>
                <tr class="row-total">
                  <th scope="row">Total</th>
                  <td v-for="(v, i) in colTotals(tableRows(envsRaw, envColors))" :key="i" class="num">{{ fmt(v) }}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel chart-panel">
          <div class="panel-head">
            <h2 class="panel-title has-tip" title="Revenus réels et dépenses réelles de chaque mois — deux grandeurs séparées des catégories, transferts exclus.">Revenus vs dépenses</h2>
            <div class="panel-tools">
              <span class="view-tabs">
                <button class="view-tab" :class="{ 'is-active': views.revdep === 'chart' }" @click="setView('revdep', 'chart')">Graphique</button>
                <button class="view-tab" :class="{ 'is-active': views.revdep === 'table' }" @click="setView('revdep', 'table')">Tableau</button>
              </span>
            </div>
          </div>
          <template v-if="views.revdep === 'chart'">
            <BarChart :labels="labels" :series="revDepSeries" :height="240" />
            <div class="legend">
              <span v-for="s in revDepSeries" :key="s.key" class="legend-item">
                <span class="legend-dot" :style="{ background: s.color }" />{{ s.name }}
                <span class="num meta">{{ fmt(avgOf(s.points)) }}</span>
              </span>
            </div>
          </template>
          <div v-else class="table-wrap">
            <table class="stat-table">
              <thead><tr><th scope="col"></th><th v-for="(l, i) in labels" :key="i" scope="col">{{ l }}</th><th scope="col">moyenne</th></tr></thead>
              <tbody>
                <tr v-for="s in revDepSeries" :key="s.key">
                  <th scope="row"><span class="legend-dot" :style="{ background: s.color }" />{{ s.name }}</th>
                  <td v-for="(v, i) in s.points" :key="i" class="num">{{ fmt(v) }}</td>
                  <td class="num row-avg">{{ fmt(avgOf(s.points)) }}</td>
                </tr>
                <tr class="row-total">
                  <th scope="row">Reste</th>
                  <td v-for="(t, i) in typesVisible" :key="i" class="num">{{ fmt((t?.real.revenu ?? 0) - (t?.real.depense ?? 0)) }}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ─── 3. Dépenses : thèmes et catégories ──────── -->
      <div class="two-col">
        <div class="panel chart-panel">
          <div class="panel-head">
            <h2 class="panel-title has-tip" title="Les dépenses réelles portant chaque thème, empilées par mois : la hauteur totale est la dépense mensuelle des thèmes tracés. Les thèmes non sélectionnés sont agrégés dans « Autres ».">Dépenses par thème</h2>
            <div class="panel-tools">
              <SeriesPicker v-model:selected="themeSel" :items="themeItems" word="thèmes" />
              <span class="view-tabs">
                <button class="view-tab" :class="{ 'is-active': views.themes === 'chart' }" @click="setView('themes', 'chart')">Graphique</button>
                <button class="view-tab" :class="{ 'is-active': views.themes === 'table' }" @click="setView('themes', 'table')">Tableau</button>
              </span>
            </div>
          </div>
          <template v-if="views.themes === 'chart'">
            <BarChart :labels="labels" :series="themeSeries" stacked :height="240" />
            <div class="legend">
              <span v-for="s in themeSeries" :key="s.key" class="legend-item">
                <span class="legend-dot" :style="{ background: s.color }" />{{ s.name }}
                <span class="num meta" :title="fmt(avgOf(s.points)) + ' par mois en moyenne'">{{ fmt(avgOf(s.points)) }}</span>
              </span>
            </div>
          </template>
          <div v-else class="table-wrap">
            <table class="stat-table">
              <thead><tr><th scope="col"></th><th v-for="(l, i) in labels" :key="i" scope="col">{{ l }}</th><th scope="col">moyenne</th></tr></thead>
              <tbody>
                <tr v-for="r in tableRows(themesRaw, themeColors)" :key="r.id">
                  <th scope="row"><span class="legend-dot" :style="{ background: r.color }" />{{ r.name }}</th>
                  <td v-for="(v, i) in r.cells" :key="i" class="num">{{ fmt(v) }}</td>
                  <td class="num row-avg">{{ fmt(r.avg) }}</td>
                </tr>
                <tr class="row-total">
                  <th scope="row">Total</th>
                  <td v-for="(v, i) in colTotals(tableRows(themesRaw, themeColors))" :key="i" class="num">{{ fmt(v) }}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel chart-panel">
          <div class="panel-head">
            <h2 class="panel-title has-tip" title="Le réel des catégories de type dépense, empilé par mois. Les catégories non sélectionnées sont agrégées dans « Autres ». Transferts exclus.">Dépenses réelles par catégorie</h2>
            <div class="panel-tools">
              <SeriesPicker v-model:selected="catSel" :items="catItems" word="catégories" />
              <span class="view-tabs">
                <button class="view-tab" :class="{ 'is-active': views.cats === 'chart' }" @click="setView('cats', 'chart')">Graphique</button>
                <button class="view-tab" :class="{ 'is-active': views.cats === 'table' }" @click="setView('cats', 'table')">Tableau</button>
              </span>
            </div>
          </div>
          <template v-if="views.cats === 'chart'">
            <BarChart :labels="labels" :series="catSeries" stacked :height="240" />
            <div class="legend">
              <span v-for="s in catSeries" :key="s.key" class="legend-item">
                <span class="legend-dot" :style="{ background: s.color }" />{{ s.name }}
                <span class="num meta" :title="fmt(avgOf(s.points)) + ' par mois en moyenne'">{{ fmt(avgOf(s.points)) }}</span>
              </span>
            </div>
          </template>
          <div v-else class="table-wrap">
            <table class="stat-table">
              <thead><tr><th scope="col"></th><th v-for="(l, i) in labels" :key="i" scope="col">{{ l }}</th><th scope="col">moyenne</th></tr></thead>
              <tbody>
                <tr v-for="r in tableRows(catsRaw, catColors)" :key="r.id">
                  <th scope="row"><span class="legend-dot" :style="{ background: r.color }" />{{ r.name }}</th>
                  <td v-for="(v, i) in r.cells" :key="i" class="num">{{ fmt(v) }}</td>
                  <td class="num row-avg">{{ fmt(r.avg) }}</td>
                </tr>
                <tr class="row-total">
                  <th scope="row">Total</th>
                  <td v-for="(v, i) in colTotals(tableRows(catsRaw, catColors))" :key="i" class="num">{{ fmt(v) }}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ─── 4. Répartition du mois : prévu vs réel (§6) ── -->
      <div class="panel chart-panel">
        <div class="panel-head">
          <h2 class="panel-title has-tip" title="Prévu et réel du mois choisi, sur la même échelle : la largeur totale représente les revenus. Épargne réelle = contributions aux enveloppes + versements d'investissement + lignes épargne. Transferts exclus.">Répartition du mois</h2>
          <div class="month-nav">
            <button class="btn-icon" :disabled="repIdx <= 0" @click="repStep(-1)">‹</button>
            <span class="month-nav-name">{{ monthName(repPeriod) }}</span>
            <button class="btn-icon" :disabled="repIdx >= allPeriods.length - 1" @click="repStep(1)">›</button>
          </div>
        </div>
        <div v-if="rep" class="rep">
          <div class="rep-block">
            <span class="rep-label">Prévu</span>
            <div class="rep-bar">
              <span class="rep-seg" :style="{ width: rep.planned.dep + '%', background: 'var(--chart-1)' }" />
              <span class="rep-seg" :style="{ width: rep.planned.ep + '%', background: 'var(--chart-3)' }" />
            </div>
            <p class="rep-legend">
              <span>Revenus <span class="num ink">{{ fmt(rep.t.planned.revenu) }}</span></span>
              <span><span class="legend-dot" style="background: var(--chart-1)" />Dépenses <span class="num ink">{{ fmt(rep.t.planned.depense) }}</span></span>
              <span><span class="legend-dot" style="background: var(--chart-3)" />Épargne <span class="num ink">{{ fmt(rep.t.planned.epargne) }}</span></span>
              <span>Reste <span class="num" :class="rep.planned.reste < 0 ? 'is-over' : 'ink'">{{ fmt(rep.planned.reste) }}</span></span>
            </p>
          </div>
          <div class="rep-block">
            <span class="rep-label">Réel</span>
            <div class="rep-bar">
              <template v-if="!rep.realEmpty">
                <span class="rep-seg" :style="{ width: rep.real.dep + '%', background: 'var(--chart-1)' }" />
                <span class="rep-seg" :style="{ width: rep.real.ep + '%', background: 'var(--chart-3)' }" />
              </template>
            </div>
            <p v-if="rep.realEmpty" class="rep-legend meta">Aucune dépense enregistrée pour l'instant.</p>
            <p v-else class="rep-legend">
              <span>Revenus <span class="num ink">{{ fmt(rep.t.real.revenu) }}</span></span>
              <span><span class="legend-dot" style="background: var(--chart-1)" />Dépenses <span class="num ink">{{ fmt(rep.t.real.depense) }}</span></span>
              <span><span class="legend-dot" style="background: var(--chart-3)" />Épargne <span class="num ink">{{ fmt(rep.t.real.epargne) }}</span></span>
              <span>Reste réel <span class="num" :class="rep.real.reste < 0 ? 'is-over' : 'ink'">{{ fmt(rep.real.reste) }}</span></span>
            </p>
          </div>
        </div>
        <p v-else class="empty-line">Aucun mois sur la période.</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ─── Page ─── */
.page-sub { font-size: 13px; color: var(--c-ink-2); margin-top: 2px; }
.panel { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--r-container); }
.meta { color: var(--c-ink-3); font-weight: 400; }
.ink { color: var(--c-ink); }
.is-over { color: var(--c-over); }

/* Filtre de période — le seul violet de la page avec les liens */
.range-btn {
  height: 30px; padding: 0 var(--s-4);
  background: var(--c-surface); border: 1px solid var(--c-line-strong);
  border-radius: var(--r-control); color: var(--c-ink-2);
  font-size: var(--t-small); font-weight: 500; cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease);
}
.range-btn:hover { background: var(--c-surface-hover); }
.range-btn.is-on { background: var(--c-accent-soft); color: var(--c-accent); border-color: var(--c-accent-soft); }

.exclude-note { display: flex; align-items: center; gap: var(--s-4); font-size: var(--t-small); color: var(--c-ink-3); margin-bottom: var(--s-4); }
.exclude-note .checkbox { display: inline-flex; align-items: center; gap: var(--s-2); cursor: pointer; color: var(--c-ink-2); }

/* ─── Bandeau ─── */
.bandeau { display: flex; align-items: center; gap: var(--s-6); padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.synth-hero { display: flex; flex-direction: column; line-height: var(--lh-tight); }
.synth-solde { font-size: var(--t-hero); font-weight: 600; color: var(--c-ink); }
.synth-sub { font-size: var(--t-meta); color: var(--c-ink-3); margin-top: 2px; align-self: flex-start; }
.has-tip { text-decoration: underline dotted var(--c-ink-3); text-underline-offset: 3px; cursor: help; }
.synth-sep { width: 1px; align-self: stretch; background: var(--c-line); }
.synth-kv { display: flex; flex-direction: column; gap: 2px; line-height: var(--lh-tight); }
.synth-k { font-size: var(--t-small); color: var(--c-ink-3); }
.synth-v { font-size: var(--t-amount); color: var(--c-ink); }
.synth-v2 { font-size: var(--t-small); }

/* ─── Panneaux de graphiques ─── */
.chart-panel { padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-5); align-items: start; }
.two-col .chart-panel { margin-bottom: var(--s-5); }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); margin-bottom: var(--s-3); flex-wrap: wrap; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--c-ink); }
.panel-tools { display: flex; align-items: center; gap: var(--s-4); }
.view-tabs { display: inline-flex; gap: var(--s-4); }
.view-tab { font-size: var(--t-small); font-weight: 500; color: var(--c-ink-3); padding: var(--s-1) 0; cursor: pointer; border-bottom: 2px solid transparent; }
.view-tab:hover { color: var(--c-ink); }
.view-tab.is-active { color: var(--c-ink); border-bottom-color: var(--c-accent); }

/* Légende compacte : elle affiche ce qui est tracé, elle ne filtre plus */
.legend { display: flex; flex-wrap: wrap; gap: var(--s-5); margin-top: var(--s-2); font-size: var(--t-small); color: var(--c-ink-2); }
.legend-item { display: inline-flex; align-items: center; gap: var(--s-2); }
.legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: var(--r-pill); flex-shrink: 0; margin-right: 2px; }

/* ─── Tableaux (§9) ─── */
.table-wrap { overflow-x: auto; }
.stat-table { font-size: var(--t-small); color: var(--c-ink-2); border-collapse: collapse; width: 100%; }
.stat-table th { text-align: left; font-weight: 600; color: var(--c-ink-3); padding: var(--s-1) var(--s-3); white-space: nowrap; }
.stat-table thead th { text-align: right; }
.stat-table thead th:first-child { text-align: left; }
.stat-table td { padding: var(--s-1) var(--s-3); white-space: nowrap; border-top: 1px solid var(--c-line); text-align: right; font-variant-numeric: tabular-nums; }
.stat-table tbody th { font-weight: 500; color: var(--c-ink); border-top: 1px solid var(--c-line); }
.stat-table .row-total th, .stat-table .row-total td { border-top: 1px solid var(--c-line-strong); font-weight: 600; color: var(--c-ink); }
.row-avg { color: var(--c-ink); font-weight: 500; }

/* ─── Répartition du mois ─── */
.month-nav { display: flex; align-items: center; gap: var(--s-2); }
.month-nav-name { font-size: 13px; font-weight: 500; color: var(--c-ink); min-width: 130px; text-align: center; }
.btn-icon { width: 26px; height: 26px; border-radius: var(--r-control); display: inline-flex; align-items: center; justify-content: center; color: var(--c-ink-3); font-size: 14px; cursor: pointer; }
.btn-icon:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.btn-icon:disabled { opacity: 0.35; cursor: default; }
.btn-icon:disabled:hover { background: none; color: var(--c-ink-3); }
.rep { display: flex; flex-direction: column; gap: var(--s-5); }
.rep-block { display: flex; flex-direction: column; gap: var(--s-2); }
.rep-label { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); }
.rep-bar { display: flex; height: 10px; border-radius: var(--r-pill); overflow: hidden; background: var(--c-track); }
.rep-seg { display: block; }
.rep-seg + .rep-seg { border-left: 2px solid var(--c-surface); }
.rep-legend { display: flex; flex-wrap: wrap; gap: var(--s-5); font-size: var(--t-small); color: var(--c-ink-2); }
.rep-legend .legend-dot { margin-right: 2px; }

/* ─── Divers ─── */
.empty-panel { text-align: center; padding: var(--s-8); font-size: 13px; color: var(--c-ink-2); }
.empty-line { font-size: var(--t-small); color: var(--c-ink-3); padding: var(--s-4) 0; text-align: center; }
input[type='checkbox'] { cursor: pointer; }
button:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); border-radius: var(--r-control); }

@media (max-width: 1099px) {
  .two-col { grid-template-columns: 1fr; }
  .bandeau { flex-wrap: wrap; gap: var(--s-4); }
  .synth-sep { display: none; }
}
</style>
