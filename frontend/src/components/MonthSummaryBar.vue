<script setup>
// La barre de synthèse du mois : les quatre chiffres qui ouvrent la page, la navigation
// d'un mois à l'autre, et les deux panneaux qu'elle déplie — les soldes des comptes et
// l'édition des soldes d'ouverture.
//
// POURQUOI C'EST UN COMPOSANT — ce bloc ne partage rien avec le registre en dessous.
// Il lit le bilan du mois et le donne à voir ; sa seule écriture est la saisie des
// soldes d'ouverture, dont il est le seul propriétaire. Le sortir de MonthView allège
// la vue de son ombre sticky, de son observateur d'intersection et de sa navigation.
//
// LES CHIFFRES VIENNENT DU SERVEUR, jamais d'un calcul refait ici : `summary` porte le
// disponible, le mis de côté et l'objectif, et les trois totaux du registre arrivent
// en propriétés. Recalculer serait s'exposer à afficher autre chose que la page.
import { ref, computed, watch, onUnmounted } from 'vue'
import { upsertMonthSnapshots } from '@/api/months.js'
import { apiError } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

const props = defineProps({
  current: { type: Object, required: true },      // le mois affiché
  months: { type: Array, default: () => [] },     // tous les mois, pour le sélecteur
  summary: { type: Object, default: null },       // le bilan rendu par le serveur
  accounts: { type: Array, default: () => [] },   // les comptes actifs
  snapshots: { type: Array, default: () => [] },  // les soldes d'ouverture enregistrés
  totalDepenses: { type: Number, default: 0 },
  plannedDepenses: { type: Number, default: 0 },
  resteAVivre: { type: Number, default: null },
})
const emit = defineEmits(['open-month', 'create-month', 'toggle-closed', 'snapshots-saved'])

const fmt = eur
// Un solde inconnu s'écrit « — » : afficher 0 € serait une affirmation fausse
const fmtOrDash = (v) => (v === null || v === undefined ? '—' : eur(v))

// ─── Navigation de mois ──────────────────────────────────
const sortedMonths = computed(() => [...props.months].sort((a, b) => a.period.localeCompare(b.period)))
const curIdx = computed(() => sortedMonths.value.findIndex((m) => m.id === props.current?.id))
const prevMonthTarget = computed(() => (curIdx.value > 0 ? sortedMonths.value[curIdx.value - 1] : null))
const nextMonthTarget = computed(() => (curIdx.value >= 0 ? sortedMonths.value[curIdx.value + 1] || null : null))

/**
 * Navigue au mois précédent ou suivant, sans sortir de la liste.
 *
 * @param {number} d -1 pour reculer, +1 pour avancer.
 */
function stepMonth(d) {
  const t = d < 0 ? prevMonthTarget.value : nextMonthTarget.value
  if (t) emit('open-month', t)
}

// Le mois qui suit le dernier existant, nommé en toutes lettres pour l'option de création
const nextPeriodName = computed(() => {
  const last = sortedMonths.value[sortedMonths.value.length - 1]
  if (!last) return ''
  const [y, m] = last.period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  const s = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return s.charAt(0).toUpperCase() + s.slice(1)
})

/**
 * Change de mois depuis le sélecteur, ou ouvre la création.
 *
 * L'option « nouveau mois » remet le sélecteur sur le mois courant avant d'ouvrir le
 * formulaire : si l'utilisateur renonce, la liste ne doit pas rester sur une option
 * qui ne correspond à aucun mois.
 *
 * @param {Event} e L'événement de changement du <select>.
 */
function onMonthSelect(e) {
  const v = e.target.value
  if (v === '__new') {
    e.target.value = String(props.current?.id ?? '')
    emit('create-month')
    return
  }
  const target = props.months.find((m) => m.id === Number(v))
  if (target) emit('open-month', target)
}

// Avancement de l'objectif d'épargne, pour la petite barre
const objectifPct = computed(() => {
  const t = props.summary?.tiles
  return t?.objectifEpargne ? Math.round((t.misDeCote / t.objectifEpargne) * 100) : 0
})

// ─── L'ombre de la barre collante ────────────────────────
// Une sentinelle d'un pixel posée au-dessus : tant qu'elle est visible, la page n'a pas
// défilé et la barre reste plate. Un IntersectionObserver coûte moins qu'un écouteur de
// scroll, qui se déclencherait à chaque pixel.
const scrolled = ref(false)
const stickySentinel = ref(null)
let sentinelObs = null
watch(stickySentinel, (el) => {
  if (sentinelObs) { sentinelObs.disconnect(); sentinelObs = null }
  if (el) {
    sentinelObs = new IntersectionObserver(([e]) => { scrolled.value = !e.isIntersecting })
    sentinelObs.observe(el)
  }
})
onUnmounted(() => sentinelObs?.disconnect())

// ─── Les deux panneaux dépliables ────────────────────────
const showAccounts = ref(false)
const snapshotsOpen = ref(false)
const snapshotEdits = ref({})

/** Ouvre l'édition des soldes de départ, pré-remplie avec ceux du mois. */
function openSnapshots() {
  const map = {}
  props.accounts.forEach((a) => {
    map[a.id] = props.snapshots.find((s) => s.accountId === a.id)?.balance ?? ''
  })
  snapshotEdits.value = map
  snapshotsOpen.value = !snapshotsOpen.value
}

/**
 * Enregistre les soldes de départ du mois.
 *
 * Les champs laissés vides sont écartés plutôt qu'enregistrés à zéro : un solde
 * inconnu n'est pas un solde nul. La vue parente relit ensuite son bilan — le
 * disponible et le reste à vivre se calculent tous les deux à partir de ces soldes.
 */
async function saveSnapshots() {
  const list = Object.entries(snapshotEdits.value)
    .filter(([, v]) => v !== '' && v !== null)
    .map(([accountId, balance]) => ({ accountId: Number(accountId), balance: parseFloat(balance) }))
  try {
    const { data } = await upsertMonthSnapshots(props.current.id, list)
    snapshotsOpen.value = false
    emit('snapshots-saved', data)
  } catch (e) { apiError(e) }
}

// Changer de mois referme les panneaux : leur contenu appartenait au mois précédent
watch(() => props.current?.id, () => { showAccounts.value = false; snapshotsOpen.value = false })
</script>

<template>
  <!-- Sentinelle de défilement : invisible, elle ne sert qu'à l'ombre de la barre -->
  <div ref="stickySentinel" style="height: 1px"></div>

  <div class="synth" :class="{ 'is-scrolled': scrolled }">
    <div class="synth-hero">
      <span class="num synth-solde" :class="{ 'is-over': (summary?.tiles.disponible ?? 0) < 0 }">{{ fmtOrDash(summary?.tiles.disponible) }}</span>
      <span class="synth-sub">Solde {{ summary?.mainAccount?.name || '—' }}</span>
    </div>
    <div class="synth-sep" />
    <div class="synth-kv">
      <span class="synth-k has-tip" title="Le réel des catégories dépense (le total du registre), le prévu du mois en repère.">Dépenses du mois</span>
      <span class="num synth-v" :class="{ 'is-over': totalDepenses > plannedDepenses }">{{ fmt(totalDepenses) }} <span class="synth-meta">sur {{ fmt(plannedDepenses) }}</span></span>
    </div>
    <div class="synth-sep" />
    <div class="synth-kv">
      <span class="synth-k has-tip" title="Ce qu'il vous restera une fois le mois déroulé : solde du compte principal, moins l'argent réservé en enveloppes, moins tout le prévu pas encore payé (dépenses, cagnottes, DCA, mensualités), plus les revenus prévus pas encore encaissés.">Reste à vivre</span>
      <span class="num synth-v" :class="{ 'is-over': (resteAVivre ?? 0) < 0 }">{{ resteAVivre === null ? '—' : fmt(resteAVivre) }}</span>
    </div>
    <div class="synth-sep" />
    <div class="synth-kv">
      <span class="synth-k has-tip" title="Épargne réalisée sur l'objectif du mois.">Épargne du mois</span>
      <span class="num synth-v">{{ fmt(summary?.tiles.misDeCote || 0) }} <span class="synth-meta">sur {{ fmt(summary?.tiles.objectifEpargne || 0) }}</span></span>
      <span v-if="summary?.tiles.objectifEpargne" class="mini-track"><span class="mini-fill" :style="{ width: Math.min(100, objectifPct) + '%' }" /></span>
    </div>
    <div class="synth-right">
      <div class="synth-month">
        <button class="btn-icon" title="Mois précédent" :disabled="!prevMonthTarget" @click="stepMonth(-1)">‹</button>
        <select class="month-select" :value="current?.id" title="Changer de mois" @change="onMonthSelect">
          <option v-for="m in months" :key="m.id" :value="m.id">{{ m.name }}</option>
          <option value="__new">Créer {{ nextPeriodName }}…</option>
        </select>
        <button class="btn-icon" title="Mois suivant" :disabled="!nextMonthTarget" @click="stepMonth(1)">›</button>
        <span class="synth-status"><span class="status-dot" :class="{ 'is-closed': current.isClosed }" />{{ current.isClosed ? 'Mois clôturé' : 'Mois ouvert' }}</span>
      </div>
      <div class="synth-actions">
        <button class="link-accent" @click="showAccounts = !showAccounts">Comptes</button>
        <button class="link-accent" @click="openSnapshots">Soldes d'ouverture</button>
        <button class="btn-secondary" @click="emit('toggle-closed')">{{ current.isClosed ? 'Rouvrir le mois' : 'Clôturer le mois' }}</button>
      </div>
    </div>
  </div>

  <!-- Soldes des comptes (panneau sous la synthèse) -->
  <div v-if="showAccounts" class="panel accounts-panel">
    <div class="accounts-grid">
      <div v-for="a in summary?.accounts || []" :key="a.accountId" class="account-tile">
        <p class="account-name">{{ a.name }}<span v-if="a.isMain" class="account-star"> ★</span></p>
        <p class="num account-balances"><span class="meta">{{ fmtOrDash(a.start) }}</span><span class="sep"> → </span><span class="ink" :class="{ 'is-over': (a.current ?? 0) < 0 }">{{ fmtOrDash(a.current) }}</span></p>
        <p v-if="a.envelopesTotal" class="account-meta num">
          enveloppes {{ fmt(a.envelopesTotal) }} · hors enveloppes
          <span :class="{ 'is-warn-text': a.unallocated < 0 }" :title="a.unallocated < 0 ? 'Négatif : les enveloppes réservent plus que le solde (découvert autorisé)' : ''">{{ fmtOrDash(a.unallocated) }}</span>
        </p>
      </div>
    </div>
  </div>

  <!-- Soldes d'ouverture (édition) -->
  <div v-if="snapshotsOpen" class="panel accounts-panel">
    <p class="panel-title">Soldes d'ouverture</p>
    <div class="snapshot-form">
      <label v-for="a in accounts" :key="a.id" class="field">
        <span>{{ a.name }}</span>
        <input v-model="snapshotEdits[a.id]" type="number" step="0.01" class="input w-28" :disabled="current.isClosed" placeholder="—" />
      </label>
    </div>
    <button v-if="!current.isClosed" class="btn-primary" @click="saveSnapshots">Enregistrer les soldes</button>
  </div>
</template>

<style scoped>
/* ─── La barre collante ─── */
.synth {
  position: sticky; top: 0; z-index: 30;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-container);
  padding: var(--s-4) var(--s-5);
  display: flex; align-items: center; gap: var(--s-5);
  margin-bottom: var(--s-5);
}
/* L'ombre n'apparaît qu'une fois la page défilée : au repos, la barre est dans le flux */
.synth.is-scrolled { box-shadow: var(--shadow-sticky); border-radius: 0 0 var(--r-container) var(--r-container); }
.synth-solde.is-over { color: var(--c-over); }

.mini-track { width: 64px; height: 4px; border-radius: var(--r-pill); background: var(--c-track); overflow: hidden; }
.mini-fill { display: block; height: 100%; background: var(--c-fill-goal); transition: width var(--dur-base) var(--ease); }

.synth-right { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: var(--s-2); }
.synth-month { display: flex; align-items: center; gap: var(--s-1); }
.month-select {
  font-size: 15px; font-weight: 600; color: var(--c-ink);
  background: transparent; border: none; outline: none; cursor: pointer;
  padding: 2px var(--s-1); border-radius: var(--r-control);
}
.month-select:hover { background: var(--c-surface-hover); }
.synth-status { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-small); color: var(--c-ink-2); margin-left: var(--s-3); }
.status-dot { width: 6px; height: 6px; border-radius: var(--r-pill); background: var(--c-credit); }
.status-dot.is-closed { background: var(--c-ink-disabled); }
.synth-actions { display: flex; align-items: center; gap: var(--s-4); }

/* ─── Les deux panneaux dépliables ─── */
.accounts-panel { padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.accounts-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3); }
.account-tile { background: var(--c-surface-sunken); border-radius: var(--r-control); padding: var(--s-3) var(--s-4); }
.account-name { font-size: var(--t-small); font-weight: 600; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.account-star { color: var(--c-accent); }
.account-balances { font-size: var(--t-small); }
.account-balances .sep { color: var(--c-ink-disabled); }
.account-meta { font-size: var(--t-meta); color: var(--c-ink-3); }
/* Hors-enveloppes négatif : un découvert autorisé, à signaler sans alarmer */
.is-warn-text { color: var(--c-warn); font-weight: 600; }
.snapshot-form { display: flex; flex-wrap: wrap; gap: var(--s-4); margin-bottom: var(--s-4); }
.panel-title { font-size: 15px; font-weight: 600; color: var(--c-ink); margin-bottom: var(--s-3); }

/* Sous 900 px, le bandeau passe à la ligne : les filets n'auraient plus de sens */
@media (max-width: 900px) {
  .synth { flex-wrap: wrap; gap: var(--s-4); }
  .synth-sep { display: none; }
  .accounts-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
