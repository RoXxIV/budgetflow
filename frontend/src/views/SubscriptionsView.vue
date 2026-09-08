<script setup>
import { ref, computed, onMounted } from 'vue'
import { getSubscriptions, createSubscription, updateSubscription, deleteSubscription, importSubscriptions } from '@/api/subscriptions.js'
import { getThemes } from '@/api/themes.js'
import AppModal from '@/components/AppModal.vue'
import { confirmDialog, apiError } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

// Tracker d'abonnements — page BAC À SABLE : tout ce qui se passe ici reste ici.
// Le but : connaître le vrai coût des abonnements, et simuler (nouvelle offre moins
// chère via le champ simulation, résiliation en décochant, ajout hypothétique à prix 0
// avec juste une simulation) pour voir l'économie par mois et par an.

const subs = ref([])
const themes = ref([])

/** Recharge la liste des abonnements et celle des thèmes. */
async function load() {
  const [sRes, tRes] = await Promise.all([getSubscriptions(), getThemes()])
  subs.value = sRes.data
  themes.value = tRes.data
}

// Premier passage : le bac à sable est amorcé une fois avec les abonnements du mois
// courant et les lignes mensualisées, pour ne pas partir d'une page blanche. Ensuite
// il vit sa vie — l'import ne se rejoue jamais, sinon il écraserait les simulations.
onMounted(async () => {
  try {
    await load()
    if (!subs.value.length) {
      const { data } = await importSubscriptions()
      subs.value = data.subscriptions
    }
  } catch (e) { apiError(e) }
})

const fmt = eur
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const PERIOD_LABELS = { mensuel: 'mensuel', annuel: 'annuel', hebdo: 'hebdo' }

/**
 * Ramène un prix à son équivalent mensuel.
 *
 * Sans ça, additionner un abonnement annuel et un hebdomadaire ne voudrait rien dire.
 * L'hebdomadaire passe par 52 semaines / 12 mois, et non par 4 : un mois compte
 * 4,33 semaines, et l'écart se voit sur l'année.
 *
 * @param {number} price Le prix tel qu'il est prélevé.
 * @param {'mensuel'|'annuel'|'hebdo'} period Sa périodicité.
 * @returns {number} Le coût mensuel équivalent.
 */
const monthlyEq = (price, period) => (period === 'annuel' ? price / 12 : period === 'hebdo' ? (price * 52) / 12 : price)

/**
 * Écrit l'échéance d'un abonnement en clair.
 *
 * Le champ `day` ne veut pas dire la même chose selon la périodicité : jour de la
 * semaine (1-7) en hebdomadaire, jour du mois partout ailleurs. En annuel, le mois
 * peut être connu sans le jour, d'où le libellé construit par morceaux.
 *
 * @param {object} s L'abonnement.
 * @returns {string} Par exemple « le mardi », « 15 mars », « le 3 », ou « — ».
 */
const dueLabel = (s) => {
  if (s.period === 'hebdo') return s.day ? 'le ' + WEEKDAYS[s.day - 1] : '—'
  if (s.period === 'annuel') return s.month ? (s.day ? s.day + ' ' : '') + MONTHS[s.month - 1] : '—'
  return s.day ? 'le ' + s.day : '—'
}

// Décocher un abonnement simule une résiliation : il sort de tous les totaux
const activeSubs = computed(() => subs.value.filter((s) => s.isActive))
// Ce que coûtent réellement les abonnements aujourd'hui, par mois
const totalMonthly = computed(() => activeSubs.value.reduce((t, s) => t + monthlyEq(s.price, s.period), 0))
// Au moins une simulation en cours : c'est ce qui déclenche l'affichage comparatif
const hasSim = computed(() => activeSubs.value.some((s) => s.sim !== null))
// Même total, mais chaque `sim` renseigné remplace le prix réel (0 = offre abandonnée)
const simMonthly = computed(() => activeSubs.value.reduce((t, s) => t + monthlyEq(s.sim ?? s.price, s.period), 0))
// L'économie mensuelle, arrondie au centime — négative quand on économise
const simDelta = computed(() => Math.round((simMonthly.value - totalMonthly.value) * 100) / 100)

// ─── Édition inline de la simulation (le geste central de la page) ───

/**
 * Prépare la case de simulation pour la saisie, au focus.
 *
 * La cellule affiche un montant formaté (« 12,14 € ») ; on le remplace par sa valeur
 * brute et on la présélectionne, pour taper par-dessus sans effacer à la main.
 *
 * @param {object} s L'abonnement de la ligne.
 * @param {FocusEvent} e L'événement de focus, dont la cible est le champ.
 */
function startSim(s, e) {
  e.target.value = s.sim === null ? '' : String(s.sim).replace('.', ',')
  e.target.select()
}

/**
 * Enregistre la simulation saisie, à la sortie du champ.
 *
 * La saisie est tolérante : espaces (fines comprises), virgule décimale et symbole €
 * sont acceptés. Un champ vidé remet la simulation à null — pas à zéro, qui veut dire
 * « résilié » et vaudrait 0 € dans les totaux.
 *
 * Trois cas ne déclenchent aucun appel réseau : valeur invalide, valeur négative, ou
 * valeur inchangée. Dans tous ces cas — échec réseau compris — le champ est réaffiché
 * à sa valeur d'avant, pour qu'il ne mente jamais sur ce qui est réellement enregistré.
 *
 * @param {object} s L'abonnement de la ligne.
 * @param {FocusEvent} e L'événement de sortie de champ.
 */
async function commitSim(s, e) {
  const raw = e.target.value.replace(/[\s  €]/g, '').replace(',', '.')
  const sim = raw === '' ? null : parseFloat(raw)
  if (sim !== null && (Number.isNaN(sim) || sim < 0)) { e.target.value = s.sim === null ? '' : fmt(s.sim); return }
  if (sim === s.sim) { e.target.value = s.sim === null ? '' : fmt(s.sim); return }
  try {
    await updateSubscription(s.id, { sim })
    subs.value = (await getSubscriptions()).data
  } catch (err) { apiError(err); e.target.value = s.sim === null ? '' : fmt(s.sim) }
}

/**
 * Bascule un abonnement entre actif et résilié (simulé).
 *
 * @param {object} s L'abonnement à basculer.
 */
async function toggleActive(s) {
  try { await updateSubscription(s.id, { isActive: !s.isActive }); subs.value = (await getSubscriptions()).data } catch (e) { apiError(e) }
}

// ─── Modal ajout / édition ───────────────────────────────
const menuId = ref(null)
const formOpen = ref(false)
const editingId = ref(null)
const form = ref({})

/** Ouvre le formulaire vide, pour ajouter un abonnement (réel ou hypothétique). */
function openAdd() {
  editingId.value = null
  form.value = { name: '', themeId: '', period: 'mensuel', price: '', sim: '', day: '', month: '' }
  formOpen.value = true
}

/**
 * Ouvre le formulaire pré-rempli sur un abonnement existant.
 *
 * Les champs vides du modèle deviennent '' plutôt que null : un <select> ou un <input>
 * lié à null afficherait « null » au lieu de rester vide.
 *
 * @param {object} s L'abonnement à modifier.
 */
function openEdit(s) {
  editingId.value = s.id
  form.value = { name: s.name, themeId: s.themeId || '', period: s.period, price: s.price, sim: s.sim ?? '', day: s.day || '', month: s.month || '' }
  formOpen.value = true
}

/**
 * Enregistre le formulaire : création ou modification selon `editingId`.
 *
 * Le chemin inverse d'openEdit : les '' du formulaire redeviennent null ou 0 pour
 * l'API. Un prix laissé vide vaut 0 — c'est le cas d'un abonnement purement
 * hypothétique, qu'on ajoute pour n'en simuler que le coût.
 */
async function submit() {
  const f = form.value
  if (!f.name.trim()) return
  const data = {
    name: f.name, themeId: f.themeId || null, period: f.period,
    price: f.price === '' ? 0 : parseFloat(f.price),
    sim: f.sim === '' ? null : parseFloat(f.sim),
    day: f.day === '' ? null : Number(f.day),
    month: f.month === '' ? null : Number(f.month),
  }
  try {
    if (editingId.value) await updateSubscription(editingId.value, data)
    else await createSubscription(data)
    formOpen.value = false
    subs.value = (await getSubscriptions()).data
  } catch (e) { apiError(e) }
}
/**
 * Retire un abonnement du tracker, après confirmation.
 *
 * Suppression franche, sans précaution d'historique : cette page est un bac à sable,
 * rien de ce qu'elle contient n'alimente les mois, le Template ou les enveloppes.
 *
 * @param {object} s L'abonnement à retirer.
 */
async function removeConfirm(s) {
  const ok = await confirmDialog({ title: "Supprimer l'abonnement", message: `Retirer « ${s.name} » du tracker ? (rien d'autre n'est touché — c'est un bac à sable)`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try { await deleteSubscription(s.id); subs.value = (await getSubscriptions()).data } catch (e) { apiError(e) }
}
</script>

<template>
  <div @click="menuId = null">
    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold">Abonnements</h1>
        <p class="page-sub">Bac à sable : rien ici ne touche le mois, le template ou les enveloppes.</p>
      </div>
      <button class="btn-primary" @click="openAdd">+ Abonnement</button>
    </div>

    <!-- ─── Bandeau : les 4 chiffres demandés ────────── -->
    <div v-if="subs.length" class="panel bandeau">
      <div class="synth-hero">
        <span class="num synth-solde">{{ fmt(totalMonthly) }}</span>
        <span class="synth-sub">Total / mois</span>
      </div>
      <div class="synth-sep" />
      <div class="synth-kv">
        <span class="synth-k">Total / an</span>
        <span class="num synth-v">{{ fmt(totalMonthly * 12) }}</span>
      </div>
      <div class="synth-sep" />
      <div class="synth-kv">
        <span class="synth-k has-tip" title="Les montants de la colonne simulation remplacent les prix (0 = résiliation simulée). Un abonnement hypothétique : prix 0, simulation renseignée.">Simulation appliquée</span>
        <span class="num synth-v">{{ hasSim ? fmt(simMonthly) : '—' }}<span v-if="hasSim" class="synth-meta"> / mois</span></span>
        <span v-if="hasSim && simDelta !== 0" class="num synth-v2" :class="simDelta < 0 ? 'is-credit' : 'is-over'">
          {{ simDelta < 0 ? '−' : '+' }}{{ fmt(Math.abs(simDelta)) }} / mois · {{ simDelta < 0 ? '−' : '+' }}{{ fmt(Math.abs(Math.round(simDelta * 12 * 100) / 100)) }} / an
        </span>
      </div>
      <div class="synth-sep" />
      <div class="synth-kv">
        <span class="synth-k">Abonnements actifs</span>
        <span class="num synth-v">{{ activeSubs.length }}<span v-if="activeSubs.length !== subs.length" class="synth-meta"> sur {{ subs.length }}</span></span>
      </div>
    </div>

    <!-- ─── Modal ajout / édition ────────────────────── -->
    <AppModal :open="formOpen" :title="editingId ? 'Modifier l\'abonnement' : 'Nouvel abonnement'" @close="formOpen = false">
      <div class="flex flex-wrap gap-4 items-end">
        <label class="field"><span>Nom</span><input v-model="form.name" type="text" class="input w-44" placeholder="Streaming, Salle de sport…" @keyup.enter="submit" /></label>
        <label v-if="themes.length" class="field"><span>Thème</span>
          <select v-model="form.themeId" class="input w-36">
            <option value="">—</option>
            <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </label>
        <label class="field"><span>Périodicité</span>
          <select v-model="form.period" class="input w-32">
            <option value="mensuel">Mensuel</option>
            <option value="annuel">Annuel</option>
            <option value="hebdo">Hebdo</option>
          </select>
        </label>
        <!-- La date suit la périodicité : mensuel → jour ; annuel → mois + jour ; hebdo → jour de semaine -->
        <label v-if="form.period === 'annuel'" class="field"><span>Mois</span>
          <select v-model="form.month" class="input w-28">
            <option value="">—</option>
            <option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option>
          </select>
        </label>
        <label v-if="form.period === 'hebdo'" class="field"><span>Jour</span>
          <select v-model="form.day" class="input w-32">
            <option value="">—</option>
            <option v-for="(d, i) in WEEKDAYS" :key="i" :value="i + 1">{{ d }}</option>
          </select>
        </label>
        <label v-else class="field"><span>Jour</span><input v-model="form.day" type="number" min="1" max="31" class="input w-20" placeholder="—" /></label>
        <label class="field"><span>Prix (€)</span><input v-model="form.price" type="number" step="0.01" class="input w-24" @keyup.enter="submit" /></label>
        <label class="field"><span class="flex items-center gap-1">Simulation (€)</span><input v-model="form.sim" type="number" step="0.01" class="input w-24" placeholder="optionnel" @keyup.enter="submit" /></label>
      </div>
      <p class="modal-hint mt-2">La simulation remplace le prix dans les totaux simulés — 0 pour simuler une résiliation. Pour un abonnement hypothétique : prix 0 et simulation renseignée.</p>
      <template #footer>
        <button class="btn-primary" @click="submit">{{ editingId ? 'Sauver' : 'Ajouter' }}</button>
        <button class="btn-secondary" @click="formOpen = false">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Aucun abonnement ─────────────────────────── -->
    <div v-if="!subs.length" class="panel empty-panel">
      <p>Aucun abonnement suivi pour l'instant.</p>
      <button class="btn-primary" @click="openAdd">Ajouter un abonnement</button>
    </div>

    <!-- ─── Registre ─────────────────────────────────── -->
    <div v-else class="panel sub-panel">
      <div class="sub-grid sub-head">
        <span></span>
        <span></span>
        <span class="colh is-left">périodicité</span>
        <span class="colh is-left">échéance</span>
        <span class="colh">prix</span>
        <span class="colh" title="Remplace le prix dans les totaux simulés — 0 = résiliation simulée">simulation</span>
        <span class="colh">équiv. / mois</span>
        <span></span>
      </div>

      <div v-for="s in subs" :key="s.id" class="sub-grid sub-row" :class="{ 'is-inactive': !s.isActive }">
        <span class="cell-check" @click.stop>
          <input type="checkbox" :checked="s.isActive" title="Décocher = simuler la résiliation (sort des totaux)" @change="toggleActive(s)" />
        </span>
        <span class="cell-label">
          <span class="row-label" :title="s.name">{{ s.name }}</span>
          <span v-if="s.themeName" class="tag tag-neutral">{{ s.themeName }}</span>
        </span>
        <span class="cell-text">{{ PERIOD_LABELS[s.period] }}</span>
        <span class="cell-text num">{{ dueLabel(s) }}</span>
        <span class="num cell-n">{{ fmt(s.price) }}</span>
        <span class="cell-sim" @click.stop>
          <input
            class="num sim-input" type="text" inputmode="decimal"
            :value="s.sim === null ? '' : fmt(s.sim)" placeholder="—"
            :disabled="!s.isActive"
            @focus="startSim(s, $event)" @blur="commitSim(s, $event)" @keyup.enter="$event.target.blur()"
          />
        </span>
        <span class="num cell-n" :class="{ meta: !s.isActive }">{{ fmt(monthlyEq(s.price, s.period)) }}</span>
        <span class="cell-actions" @click.stop>
          <span class="menu-wrap">
            <button class="btn-icon" title="Actions" @click="menuId = menuId === s.id ? null : s.id">⋯</button>
            <div v-if="menuId === s.id" class="menu">
              <button class="menu-item" @click="menuId = null; openEdit(s)">Modifier</button>
              <div class="menu-sep" />
              <button class="menu-item is-danger" @click="menuId = null; removeConfirm(s)">Supprimer</button>
            </div>
          </span>
        </span>
      </div>

      <!-- Total : le réel, et la version simulée quand elle diffère -->
      <div class="sub-grid sub-total">
        <span></span>
        <span class="total-label">Total</span>
        <span></span><span></span>
        <span class="num cell-n">{{ fmt(totalMonthly) }}<span class="meta"> / mois</span></span>
        <span class="num cell-n" :class="hasSim ? (simDelta < 0 ? 'is-credit' : simDelta > 0 ? 'is-over' : '') : 'meta'">{{ hasSim ? fmt(simMonthly) : '—' }}</span>
        <span class="num cell-n">{{ fmt(totalMonthly * 12) }}<span class="meta"> / an</span></span>
        <span></span>
      </div>
    </div>
  </div>
</template>

<style scoped>

/* ─── Bandeau ─── */
.bandeau { display: flex; align-items: center; gap: var(--s-6); padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); flex-wrap: wrap; }

/* ─── Registre ─── */
.sub-panel { overflow: visible; }
.sub-grid {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 100px 110px 100px 110px 110px 40px;
  align-items: center;
  gap: var(--s-3);
  padding-inline: var(--s-5);
  min-height: var(--h-row);
}
.sub-head { min-height: 30px; border-bottom: 1px solid var(--c-line); background: var(--c-surface-sunken); border-radius: var(--r-container) var(--r-container) 0 0; }
.colh.is-left { text-align: left; }
.sub-row { border-bottom: 1px solid var(--c-line); transition: background-color var(--dur-fast) var(--ease); }
.sub-row:hover { background: var(--c-surface-hover); }
.sub-row.is-inactive .row-label, .sub-row.is-inactive .cell-text, .sub-row.is-inactive .cell-n { color: var(--c-ink-3); }
.cell-check { display: flex; justify-content: center; }
.cell-text { font-size: 13px; color: var(--c-ink-2); white-space: nowrap; }
.cell-text.num { text-align: left; }
.cell-n { font-size: var(--t-body); color: var(--c-ink); text-align: right; }
.cell-actions { display: flex; justify-content: flex-end; }

/* Simulation : un champ qui se lit comme un montant (le geste central de la page) */
.cell-sim { display: flex; justify-content: flex-end; }
.sim-input {
  width: 100%; max-width: 110px; text-align: right;
  font-size: var(--t-body); color: var(--c-accent); font-weight: 500;
  background: transparent; border: 1px solid transparent; border-radius: var(--r-control);
  padding: 2px var(--s-2); outline: none; font-family: var(--font-ui);
  transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.sim-input::placeholder { color: var(--c-ink-3); font-weight: 400; }
.sim-input:hover:not(:disabled) { border-color: var(--c-line-strong); background: var(--c-surface); }
.sim-input:focus { border-color: var(--c-accent); background: var(--c-surface); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.sim-input:disabled { opacity: 0.4; }

.sub-total { min-height: 44px; background: var(--c-surface-sunken); border-top: 1px solid var(--c-line-strong); border-radius: 0 0 var(--r-container) var(--r-container); }
.sub-panel .sub-row:last-of-type { border-bottom: none; }
.total-label { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); }
.sub-total .cell-n { font-weight: 600; }

/* Menu ⋯ */
.menu { min-width: 180px; }

/* ─── États vides, boutons, champs ─── */
.modal-hint { font-size: 11.5px; color: var(--c-ink-3); }

button:focus-visible, select:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); border-radius: var(--r-control); }

@media (max-width: 1099px) {
  .sub-grid { grid-template-columns: 28px minmax(0, 1fr) 100px 110px 110px 40px; }
  .sub-grid > :nth-child(3), .sub-grid > :nth-child(4) { display: none; }
}
</style>
