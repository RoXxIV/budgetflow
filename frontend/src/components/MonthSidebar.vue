<script setup>
// La colonne latérale du mois : les enveloppes, les investissements, et la note libre.
//
// POURQUOI C'EST UN COMPOSANT — trois panneaux qui ne lisent rien du registre. Ils
// partagent avec lui les données du mois (enveloppes, actifs, contributions), mais pas
// une seule de ses fonctions. Ce qu'ils font, eux, c'est écrire : verser dans une
// enveloppe, pointer un DCA, saisir un mouvement, retirer une ligne d'historique.
//
// LE PARTAGE DE RESPONSABILITÉ — ce composant possède ses formulaires et ses appels,
// et prévient par `changed` dès qu'il a écrit. C'est la vue parente qui relit le mois :
// une écriture ici déplace des soldes, et seul le serveur sait ce que ça donne. Trois
// gestes lui restent parce qu'ils dépassent la colonne : annuler un versement pour le
// mois (le Reste à vivre en dépend), liquider une enveloppe (une fenêtre s'ouvre), et
// la relecture qui suit chaque écriture.
//
// LES CASES SONT À SENS UNIQUE, comme le pointage du registre : dès qu'un mouvement
// réel existe, il fait foi et la case ne rejoue plus. Pour revenir en arrière, on
// supprime le mouvement — ce qui se voit, là où décocher ne se verrait pas.
import { ref, computed, watch, onUnmounted } from 'vue'
import { addContribution, removeContribution } from '@/api/envelopes.js'
import { dcaAsset, addAssetMovement, removeAssetMovement } from '@/api/assets.js'
import { setMonthNotes } from '@/api/months.js'
import { apiError } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

const props = defineProps({
  current: { type: Object, required: true },       // le mois affiché
  envelopes: { type: Array, default: () => [] },   // enveloppes ouvertes
  assets: { type: Array, default: () => [] },      // actifs ouverts
  contribs: { type: Array, default: () => [] },    // contributions datées dans le mois
  movements: { type: Array, default: () => [] },   // mouvements d'investissement du mois
  accounts: { type: Array, default: () => [] },    // comptes actifs
  skips: { type: Array, default: () => [] },       // ce qui est annulé ce mois-ci
})
const emit = defineEmits(['changed', 'toggle-skip', 'liquidate'])

const fmt = eur
const shortDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
const isSkipped = (kind, id) => props.skips.some((s) => s.kind === kind && s.targetId === id)
// Le compte principal, proposé par défaut dans les deux formulaires
const mainAccountId = () => props.accounts.find((a) => a.isMain)?.id || ''
// Une date qui reste DANS le mois de la fiche : aujourd'hui si on y est, le 1er sinon.
// Saisir dans un mois passé ne doit pas y poser un mouvement daté d'aujourd'hui, qui
// tomberait dans le mauvais mois.
function dateDansLeMois() {
  const today = new Date().toISOString().substring(0, 10)
  return today.startsWith(props.current.period) ? today : `${props.current.period}-01`
}

// ─── Enveloppes ──────────────────────────────────────────
const openEnvelopeId = ref(null)
const contribForm = ref({})
const contribsForEnvelope = (env) => props.contribs.filter((c) => c.envelopeId === env.id)
// Le total affiché est le MIS DE CÔTÉ — les seuls versements « normale ». Le tag de
// chaque ligne montre, lui, le mouvement net : les deux peuvent différer.
const monthContribTotal = computed(() => props.contribs.filter((c) => c.kind === 'normale').reduce((s, c) => s + c.amount, 0))
const envelopePct = (env) => (env.effectiveTarget ? Math.min(100, Math.round((env.total / env.effectiveTarget) * 100)) : null)
// Enveloppe mensualisée au-delà de sa cible (abonnement repoussé, jamais liquidé) : en rouge
const isOverfull = (env) => !!env.effectiveTarget && env.total > env.effectiveTarget
const dejaVerse = (env) => contribsForEnvelope(env).some((c) => c.kind === 'normale')
const mouvementNet = (env) => contribsForEnvelope(env).reduce((s, c) => s + c.amount, 0)

/**
 * Déplie une enveloppe et prépare le versement.
 *
 * Le montant est pré-rempli à la mensualité suggérée : le geste courant est « je verse
 * ce qui est prévu », il doit tenir en un clic.
 *
 * @param {object} env L'enveloppe à déplier.
 */
function toggleEnvelope(env) {
  if (openEnvelopeId.value === env.id) { openEnvelopeId.value = null; return }
  openEnvelopeId.value = env.id
  contribForm.value = {
    amount: env.monthlySuggestion || '',
    date: dateDansLeMois(),
    fromAccountId: mainAccountId(),
    notes: '',
  }
}

/** Verse un montant dans une enveloppe depuis le mois. */
async function submitContribution(env) {
  const f = contribForm.value
  if (!f.amount) return
  try {
    await addContribution(env.id, {
      amount: parseFloat(f.amount),
      date: f.date,
      fromAccountId: f.fromAccountId || null,
      notes: f.notes || null,
    })
    contribForm.value = { ...f, amount: '', notes: '' }
    emit('changed')
  } catch (e) { apiError(e) }
}

async function deleteContribution(c) {
  try { await removeContribution(c.envelopeId, c.id); emit('changed') } catch (e) { apiError(e) }
}

/** Case « versé » : verse la mensualité suggérée en un clic. */
async function contributeSuggested(env) {
  if (dejaVerse(env)) return
  try {
    await addContribution(env.id, {
      amount: env.monthlySuggestion,
      date: dateDansLeMois(),
      fromAccountId: mainAccountId() || null,
      notes: 'Mensualité',
    })
    emit('changed')
  } catch (e) { apiError(e) }
}

// ─── Investissements ─────────────────────────────────────
const openAssetId = ref(null)
const assetMovementForm = ref({})
const movementsForAsset = (asset) => props.movements.filter((m) => m.assetId === asset.id)
const monthInvestedTotal = computed(() => props.movements.filter((m) => m.kind === 'versement').reduce((s, m) => s + m.amount, 0))
// Ce que l'actif a reçu ce mois : le net des versements et des retraits
const netForAsset = (asset) => movementsForAsset(asset).reduce((s, m) => s + (m.kind === 'versement' ? m.amount : -m.amount), 0)

/** Coche le versement récurrent (DCA) d'un actif pour ce mois. */
async function toggleDca(asset) {
  if (movementsForAsset(asset).length) return
  try { await dcaAsset(props.current.id, asset.id); emit('changed') } catch (e) { apiError(e) }
}

/** Déplie le détail d'un actif et prépare le formulaire de mouvement. */
function toggleAsset(asset) {
  if (openAssetId.value === asset.id) { openAssetId.value = null; return }
  openAssetId.value = asset.id
  assetMovementForm.value = {
    kind: 'versement',
    amount: '',
    date: dateDansLeMois(),
    counterpartAccountId: mainAccountId(),
  }
}

/** Enregistre un versement ou un retrait sur un actif, depuis le mois. */
async function submitAssetMovement(asset) {
  const f = assetMovementForm.value
  if (!f.amount) return
  try {
    await addAssetMovement(asset.id, {
      kind: f.kind, amount: parseFloat(f.amount), date: f.date,
      counterpartAccountId: f.counterpartAccountId || null,
    })
    assetMovementForm.value = { ...f, amount: '' }
    emit('changed')
  } catch (e) { apiError(e) }
}

async function deleteAssetMovement(m) {
  try { await removeAssetMovement(m.assetId, m.id); emit('changed') } catch (e) { apiError(e) }
}

// ─── Note du mois ────────────────────────────────────────
// Du contexte, pas de l'argent : la saisie reste ouverte même sur un mois clôturé.
const monthNotes = ref(props.current?.notes || '')
const notesSaved = ref(false)
let notesSavedTimer = null
onUnmounted(() => clearTimeout(notesSavedTimer))
watch(() => props.current?.id, () => { monthNotes.value = props.current?.notes || '' })

/**
 * Enregistre la note du mois, à la sortie du champ.
 *
 * Rien n'est envoyé si le texte n'a pas changé — la comparaison ignore les espaces de
 * bord, pour ne pas déclencher une écriture sur un simple passage dans le champ.
 */
async function saveNotes() {
  if (!props.current || monthNotes.value.trim() === (props.current.notes || '').trim()) return
  try {
    const { data } = await setMonthNotes(props.current.id, monthNotes.value)
    props.current.notes = data.notes
    notesSaved.value = true
    clearTimeout(notesSavedTimer)
    notesSavedTimer = setTimeout(() => { notesSaved.value = false }, 2000)
  } catch (e) { apiError(e) }
}

// Changer de mois referme les panneaux : leur contenu appartenait au mois précédent
watch(() => props.current?.id, () => { openEnvelopeId.value = null; openAssetId.value = null })
</script>

<template>
  <aside class="month-aside">
    <!-- ─── Enveloppes ─────────────────────────────── -->
    <div v-if="envelopes.length" class="panel side-panel">
      <div class="side-head">
        <span class="side-title has-tip" title="Total des versements du mois (mis de côté) — le même chiffre que la tuile Épargne. Les tags des lignes montrent, eux, le mouvement net de chaque enveloppe : les deux peuvent différer.">Enveloppes</span>
        <span class="num side-total">{{ fmt(monthContribTotal) }}</span>
      </div>
      <div v-for="env in envelopes" :key="env.id" class="side-item" @click="toggleEnvelope(env)">
        <div class="side-row1">
          <button
            v-if="env.monthlySuggestion > 0 && !current.isClosed && !dejaVerse(env) && !isSkipped('envelope', env.id)"
            class="pointbox pointbox-sm"
            :aria-label="'Verser la mensualité de ' + env.name"
            :title="'Verser la mensualité suggérée : ' + fmt(env.monthlySuggestion)"
            @click.stop="contributeSuggested(env)"
          ></button>
          <span v-else-if="dejaVerse(env)" class="pointbox pointbox-sm is-checked"><PhCheck :size="10" weight="bold" /></span>
          <span class="side-name">{{ env.name }}</span>
          <span v-if="isSkipped('envelope', env.id)" class="tag tag-neutral" title="Pas de versement ce mois-ci : le Reste à vivre ne le déduit plus. Tout revient le mois prochain.">annulé ce mois</span>
          <span class="num side-amounts" :title="isOverfull(env) ? 'Au-delà de la cible : à liquider quand le paiement passera' : ''">
            <span :class="isOverfull(env) ? 'is-over' : 'ink'">{{ fmt(env.total) }}</span><span v-if="env.targetAmount" :class="isOverfull(env) ? 'is-over' : 'meta'"> / {{ fmt(env.effectiveTarget) }}</span>
          </span>
        </div>
        <div v-if="env.targetAmount" class="goal-bar"><div class="goal-fill" :class="{ 'is-overfill': isOverfull(env) }" :style="{ width: Math.min(100, envelopePct(env) || 0) + '%' }" /></div>
        <div class="side-meta">
          <span v-if="env.accountName">{{ env.accountName }}</span><span v-if="env.monthlySuggestion" class="num"> · {{ fmt(env.monthlySuggestion) }}/mois</span>
          <span v-if="contribsForEnvelope(env).length" class="tag num" :class="mouvementNet(env) >= 0 ? 'tag-credit' : 'tag-alert'" title="Mouvement net de l'enveloppe ce mois : versements, dépenses sorties, réaffectations et ajustements compris — pas seulement le mis de côté">{{ mouvementNet(env) >= 0 ? '+' : '' }}{{ fmt(mouvementNet(env)) }} ce mois</span>
          <span v-if="env.targetAmount" class="side-rest num">reste {{ fmt(Math.max(0, Math.round((env.effectiveTarget - env.total) * 100) / 100)) }}</span>
        </div>

        <div v-if="openEnvelopeId === env.id" class="side-expand" @click.stop>
          <div v-for="c in contribsForEnvelope(env)" :key="c.id" class="entry-row">
            <span class="entry-date num">{{ shortDate(c.date) }}</span>
            <span class="entry-label">{{ c.kind !== 'normale' ? c.kind : (c.notes || '') }}</span>
            <span class="entry-amount num" :class="c.amount >= 0 ? 'is-credit' : 'is-over'">{{ fmt(c.amount) }}</span>
            <span class="entry-account">{{ c.fromAccountName || '' }}</span>
            <span class="entry-actions"><button v-if="!current.isClosed" class="btn-icon is-danger" title="Supprimer la contribution" @click.stop="deleteContribution(c)">×</button></span>
          </div>
          <p v-if="!contribsForEnvelope(env).length" class="entries-empty">Aucune contribution ce mois.</p>

          <div v-if="!current.isClosed" class="side-form">
            <input v-model="contribForm.amount" type="number" step="0.01" class="input w-20" :placeholder="env.monthlySuggestion ? String(env.monthlySuggestion) : 'Montant'" title="Montant à verser" @keyup.enter="submitContribution(env)" />
            <input v-model="contribForm.date" type="date" class="input w-32" title="Date du versement" />
            <select v-model="contribForm.fromAccountId" class="input flex-1" title="Compte source">
              <option value="">— depuis</option>
              <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <button class="btn-secondary" @click="submitContribution(env)">Ajouter</button>
          </div>

          <!-- Mensualisée : le geste qui ferme la boucle — le virement réel est passé,
               on vide l'enveloppe vers le compte remboursé et le cycle repart -->
          <div v-if="!current.isClosed && (env.linkedTemplateLineId || env.monthlySuggestion > 0 || isSkipped('envelope', env.id))" class="side-liquidate">
            <button v-if="env.linkedTemplateLineId && env.total > 0" class="link-accent" @click.stop="emit('liquidate', env)">Liquider et renouveler</button>
            <!-- Toutes les enveloppes à mensualité (liées OU libres) : le skip fait taire la
                 case et la suggestion ce mois-ci, et retire la mensualité du Reste à vivre
                 quand elle y était déduite. « Rétablir » reste accessible même après un
                 versement (état contradictoire sinon). -->
            <button
              v-if="isSkipped('envelope', env.id) || (env.monthlySuggestion > 0 && !dejaVerse(env))"
              class="link-accent"
              :title="isSkipped('envelope', env.id) ? 'Reprendre la mensualité ce mois-ci' : 'Ce mois-ci, pas de versement pour ce projet'"
              @click.stop="emit('toggle-skip', 'envelope', env.id)"
            >{{ isSkipped('envelope', env.id) ? 'Rétablir ce mois-ci' : 'Annuler ce mois-ci' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Investissements ────────────────────────── -->
    <div v-if="assets.length" class="panel side-panel">
      <div class="side-head"><span class="side-title">Investissements</span><span class="num side-total">{{ fmt(monthInvestedTotal) }}</span></div>
      <div v-for="asset in assets" :key="asset.id" class="side-item" @click="toggleAsset(asset)">
        <div class="side-row1">
          <button
            v-if="asset.monthlyDca > 0 && !movementsForAsset(asset).length && !current.isClosed && !isSkipped('asset', asset.id)"
            class="pointbox pointbox-sm"
            :aria-label="'Verser le DCA de ' + asset.name"
            title="Marquer le versement mensuel comme fait (annulation : supprimer le mouvement)"
            @click.stop="toggleDca(asset)"
          ></button>
          <span v-else-if="movementsForAsset(asset).length" class="pointbox pointbox-sm is-checked"><PhCheck :size="10" weight="bold" /></span>
          <span class="side-name">{{ asset.name }}</span>
          <span v-if="isSkipped('asset', asset.id)" class="tag tag-neutral" title="Pas de versement ce mois-ci : le Reste à vivre ne le déduit plus. Tout revient le mois prochain.">annulé ce mois</span>
          <span v-if="asset.type" class="tag tag-neutral">{{ asset.type }}</span>
          <span class="num side-amounts">
            <span class="ink">{{ fmt(movementsForAsset(asset).length ? netForAsset(asset) : asset.monthlyDca) }}</span>
            <span v-if="!movementsForAsset(asset).length && asset.monthlyDca" class="meta"> prévu</span>
          </span>
        </div>
        <div class="side-meta"><span v-if="asset.accountName">{{ asset.accountName }}</span></div>

        <div v-if="openAssetId === asset.id" class="side-expand" @click.stop>
          <div v-for="m in movementsForAsset(asset)" :key="m.id" class="entry-row">
            <span class="entry-date num">{{ shortDate(m.date) }}</span>
            <span class="entry-label"><span v-if="m.source === 'dca'" class="tag tag-info">DCA</span></span>
            <span class="entry-amount num" :class="m.kind === 'versement' ? 'is-credit' : 'is-over'">{{ m.kind === 'retrait' ? '−' : '+' }}{{ fmt(m.amount) }}</span>
            <span class="entry-account">{{ m.kind === 'versement' ? (m.counterpartAccountName || '?') + ' → ' + (asset.accountName || asset.name) : (asset.accountName || asset.name) + ' → ' + (m.counterpartAccountName || '?') }}</span>
            <span class="entry-actions"><button v-if="!current.isClosed" class="btn-icon is-danger" title="Supprimer le mouvement" @click.stop="deleteAssetMovement(m)">×</button></span>
          </div>
          <p v-if="!movementsForAsset(asset).length" class="entries-empty">Aucun mouvement ce mois.</p>

          <!-- « Rétablir » reste accessible même après un versement (état contradictoire sinon) -->
          <div v-if="asset.monthlyDca > 0 && !current.isClosed && (isSkipped('asset', asset.id) || !movementsForAsset(asset).length)" class="side-liquidate">
            <button class="link-accent" :title="isSkipped('asset', asset.id) ? 'Re-déduire le DCA du Reste à vivre' : 'Ce mois-ci, pas de versement : le Reste à vivre ne le déduira plus'" @click.stop="emit('toggle-skip', 'asset', asset.id)">{{ isSkipped('asset', asset.id) ? 'Rétablir ce mois-ci' : 'Annuler ce mois-ci' }}</button>
          </div>

          <div v-if="!current.isClosed" class="side-form">
            <select v-model="assetMovementForm.kind" class="input w-24" title="Sens du mouvement">
              <option value="versement">Versement</option>
              <option value="retrait">Retrait</option>
            </select>
            <input v-model="assetMovementForm.amount" type="number" step="0.01" class="input w-20" placeholder="Montant" @keyup.enter="submitAssetMovement(asset)" />
            <input v-model="assetMovementForm.date" type="date" class="input w-32" title="Date du mouvement" />
            <select v-model="assetMovementForm.counterpartAccountId" class="input flex-1" :title="assetMovementForm.kind === 'versement' ? 'Compte source' : 'Compte destination'">
              <option value="">— compte</option>
              <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <button class="btn-secondary" @click="submitAssetMovement(asset)">Ajouter</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Note du mois : texte libre, enregistrée au blur (aussi sur un mois clôturé) -->
    <div class="panel side-panel notes-panel">
      <div class="side-head">
        <span class="side-title">Notes</span>
        <span v-if="notesSaved" class="notes-saved">Enregistré</span>
      </div>
      <textarea
        v-model="monthNotes"
        class="notes-area"
        rows="4"
        :placeholder="'Une note pour ' + (current.name || 'ce mois') + '…'"
        @blur="saveNotes"
      ></textarea>
    </div>

    <router-link to="/abonnements" class="link-accent aside-link" title="Bac à sable : coût total des abonnements et simulations, sans rien toucher ailleurs">Tracker d'abonnements →</router-link>
    <router-link to="/plan" class="link-accent aside-link" title="Bac à sable : répartir une capacité mensuelle entre plusieurs projets, et voir quand chacun tombe">Plan de financement →</router-link>
  </aside>
</template>

<style scoped>
/* La colonne suit le défilement : on garde les enveloppes sous les yeux pendant qu'on
   parcourt le registre. */
.month-aside { display: flex; flex-direction: column; gap: var(--s-5); position: sticky; top: calc(var(--h-summary) + var(--s-5) + 16px); }

.side-panel { overflow: hidden; }
.side-head { display: flex; align-items: baseline; justify-content: space-between; padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-line); }
.side-title { font-size: 13px; font-weight: 600; color: var(--c-ink); }
.side-total { font-size: 13px; color: var(--c-ink-2); }
.side-item { padding: var(--s-3) var(--s-5); cursor: pointer; }
.side-item + .side-item { border-top: 1px solid var(--c-line); }
.side-item:hover { background: var(--c-surface-hover); }
.side-row1 { display: flex; align-items: center; gap: var(--s-2); }
.side-name { font-size: var(--t-body); font-weight: 500; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.side-amounts { margin-left: auto; font-size: 13px; white-space: nowrap; }
.side-meta { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-meta); color: var(--c-ink-3); margin-top: var(--s-1); flex-wrap: wrap; }
.side-rest { margin-left: auto; }
.side-expand { margin-top: var(--s-3); background: var(--c-surface-sunken); border-radius: var(--r-control); padding: var(--s-2) var(--s-3); cursor: default; animation: side-in var(--dur-base) var(--ease); }
.side-form { display: flex; align-items: center; gap: var(--s-2); margin-top: var(--s-2); flex-wrap: wrap; }
.side-liquidate { margin-top: var(--s-2); border-top: 1px solid var(--c-line); padding-top: var(--s-2); }
@keyframes side-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* Avancement d'une enveloppe vers sa cible */
.goal-bar { height: 4px; border-radius: var(--r-pill); background: var(--c-track); overflow: hidden; margin-top: var(--s-2); }
.goal-fill { height: 100%; background: var(--c-fill-goal); transition: width var(--dur-base) var(--ease); }
.goal-fill.is-overfill { background: var(--c-fill-over); }

/* Les lignes d'historique dépliées. Le registre a les mêmes noms de classes mais une
   grille plus large : chacun garde la sienne, elles ne se croisent jamais (scoped). */
.entry-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) 76px minmax(0, 90px) 26px; gap: var(--s-3); align-items: center; min-height: 32px; }
.entry-date { font-size: var(--t-small); color: var(--c-ink-3); }
.entry-label { font-size: var(--t-small); color: var(--c-ink-2); display: flex; align-items: center; gap: var(--s-2); min-width: 0; white-space: nowrap; overflow: hidden; }
.entry-amount { font-size: var(--t-small); color: var(--c-ink); text-align: right; }
.entry-account { font-size: var(--t-meta); color: var(--c-ink-3); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry-actions { display: flex; justify-content: flex-end; gap: 2px; }
.entries-empty { font-size: var(--t-small); color: var(--c-ink-3); padding: var(--s-2) 0; }
.tag-info { background: var(--c-accent-soft); color: var(--c-accent); }

/* La note du mois : un champ qui ne ressemble à un champ qu'au survol */
.notes-panel { padding: 0 var(--s-3) var(--s-3); }
.notes-panel .side-head { margin: 0 calc(-1 * var(--s-3)) var(--s-2); }
.notes-saved { font-size: var(--t-meta); color: var(--c-ink-3); }
.notes-area {
  width: 100%; resize: vertical; min-height: 72px;
  font-family: var(--font-ui); font-size: 13px; line-height: var(--lh-body); color: var(--c-ink);
  background: transparent; border: 1px solid transparent; border-radius: var(--r-control);
  padding: var(--s-2) var(--s-3); outline: none;
  transition: border-color var(--dur-fast) var(--ease), background-color var(--dur-fast) var(--ease);
}
.notes-area:hover { border-color: var(--c-line-strong); }
.notes-area:focus { border-color: var(--c-accent); background: var(--c-surface); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.notes-area::placeholder { color: var(--c-ink-3); }

.aside-link { align-self: flex-start; padding-left: var(--s-2); margin-top: calc(-1 * var(--s-3)); }
</style>
