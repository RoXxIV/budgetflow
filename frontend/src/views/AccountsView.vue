<script setup>
import { ref, computed, onMounted } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { getAccounts, createAccount, updateAccount, deleteAccount, setAccountActive, getNetWorth } from '@/api/accounts.js'
import {
  getEnvelopes, createEnvelope, updateEnvelope, deleteEnvelope, closeEnvelopeInto, liquidateEnvelope,
  getContributions, addContribution, removeContribution,
  getAvailability, reallocateEnvelope, simulateEnvelope,
} from '@/api/envelopes.js'
import { watch } from 'vue'
import { confirmDialog, apiError } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'
import HelpTip from '@/components/HelpTip.vue'

// ─── Data ────────────────────────────────────────────────
const accounts = ref([])
const envelopes = ref([])
const netWorth = ref(null)
const error = ref('')

/** Recharge comptes, enveloppes et patrimoine — les trois vont ensemble. */
async function load() {
  try {
    const [accRes, envRes, nwRes] = await Promise.all([getAccounts(), getEnvelopes(), getNetWorth()])
    accounts.value = accRes.data
    envelopes.value = envRes.data
    netWorth.value = nwRes.data
    error.value = ''
  } catch (e) {
    error.value = e.response?.data?.message || e.message
  }
}
onMounted(load)

// Le détail du patrimoine pour un compte : solde de début de mois, solde live, valeur de marché
const netWorthOf = (accountId) => netWorth.value?.accounts.find((a) => a.accountId === accountId) || null

/**
 * De combien le solde a bougé depuis le début du mois.
 *
 * Renvoie null dans deux cas distincts mais qui s'affichent pareil : solde inconnu
 * (rien à comparer) ou écart nul (rien à signaler).
 *
 * @param {number} accountId Le compte.
 * @returns {number|null} L'écart en euros, ou null.
 */
const monthDelta = (accountId) => {
  const a = netWorthOf(accountId)
  if (!a || a.balance == null || a.start == null) return null
  const d = Math.round((a.balance - a.start) * 100) / 100
  return d === 0 ? null : d
}

// ─── Réaffectation entre enveloppes d'un même compte ─────
const reallocForm = ref({ toEnvelopeId: '', amount: '' })
// Une réaffectation ne se fait qu'entre enveloppes d'un MÊME compte : l'argent ne
// bouge pas de la banque, seule sa réservation change
const reallocTargets = (envelope) => envelopes.value.filter((e) => e.accountId === envelope.accountId && e.id !== envelope.id && !e.isClosed)

/**
 * Déplace de l'argent d'une enveloppe vers une autre du même compte.
 *
 * Aucun mouvement bancaire : deux contributions liées, l'une négative, l'autre
 * positive. Le solde du compte est inchangé.
 *
 * @param {object} envelope L'enveloppe source.
 */
async function doReallocate(envelope) {
  const f = reallocForm.value
  if (!f.toEnvelopeId || !(parseFloat(f.amount) > 0)) return
  try {
    await reallocateEnvelope(envelope.id, { toEnvelopeId: f.toEnvelopeId, amount: parseFloat(f.amount) })
    reallocForm.value = { toEnvelopeId: '', amount: '' }
    contributions.value = (await getContributions(envelope.id)).data
    await load()
  } catch (e) { apiError(e) }
}

// Enveloppes sans compte hôte (virtuelles) — les autres sont affichées dans leur compte
const virtualEnvelopes = computed(() => envelopes.value.filter((e) => !e.accountId))

// Comptes actifs / désactivés (un compte désactivé garde son historique mais sort des saisies et du bilan)
const activeAccounts = computed(() => accounts.value.filter((a) => a.isActive))
const inactiveAccounts = computed(() => accounts.value.filter((a) => !a.isActive))

// ─── Helpers ─────────────────────────────────────────────
const fmt = eur // « 1 667,85 € », espaces fines insécables
// « 4 mars » — jamais d'ISO à l'écran (même règle que la page Mois)
const shortDate = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '')
// Avancement vers la cible, plafonné à 100 % : une jauge ne déborde pas de sa barre
const pct = (e) => (e.effectiveTarget ? Math.min(100, Math.round((e.total / e.effectiveTarget) * 100)) : null)
// Au-delà de la cible : typiquement une mensualisée qu'on a oublié de liquider à
// l'échéance, elle continue d'encaisser. Signalé en rouge, ce n'est pas une bonne nouvelle.
const isOverfull = (e) => { const t = e.effectiveTarget ?? e.targetAmount; return !!t && e.total > t }

// ─── Liquider et renouveler ──────────────────────────────
const liquidation = ref(null) // { env, toAccountId }

/**
 * Ouvre la liquidation d'une enveloppe mensualisée : l'échéance arrive, l'argent
 * mis de côté retourne sur un compte et le cycle repart à zéro.
 *
 * @param {object} env L'enveloppe à liquider.
 */
function openLiquidation(env) {
  liquidation.value = { env, toAccountId: accounts.value.find((a) => a.isMain)?.id || '' }
}
/** Exécute la liquidation vers le compte choisi (la dépense reste à saisir). */
async function confirmLiquidation() {
  const l = liquidation.value
  if (!l?.toAccountId) return
  try {
    await liquidateEnvelope(l.env.id, l.toAccountId)
    liquidation.value = null
    await load()
  } catch (e) { apiError(e) }
}

// ─── Registre des comptes groupé par type (brief Comptes §2/§4) ───
const GROUP_LABELS = { courant: 'Comptes courants', epargne: 'Épargne', investissement: 'Investissement', especes: 'Espèces' }
/**
 * Le solde à afficher pour un compte.
 *
 * `used` est ce que le backend a retenu : valeur de marché pour un compte
 * d'investissement valorisé, solde live sinon. null reste null — un solde inconnu
 * s'affiche « — », jamais 0, qui serait une information fausse.
 *
 * @param {object} a Le compte.
 * @returns {number|null} Le solde, ou null s'il est inconnu.
 */
const accountBalance = (a) => {
  const r = netWorthOf(a.id)
  if (!r) return null
  return r.used ?? r.balance ?? null
}
/**
 * Range les comptes actifs par type, du plus courant au plus lointain.
 *
 * Dans chaque groupe, le compte principal passe devant, puis les autres du plus
 * garni au moins garni. Le -1e15 relègue les soldes inconnus en fin de liste plutôt
 * que de les traiter comme des zéros. Un groupe vide n'est pas affiché.
 *
 * Le total ne compte que les comptes inclus dans le patrimoine : un compte joint suivi
 * mais pas à soi ne doit pas gonfler la somme.
 *
 * @returns {Array<{type: string, label: string, accounts: Array, total: number}>}
 */
const accountGroups = computed(() =>
  ['courant', 'epargne', 'investissement', 'especes']
    .map((type) => {
      const accs = activeAccounts.value
        .filter((a) => a.type === type)
        .sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0) || ((accountBalance(b) ?? -1e15) - (accountBalance(a) ?? -1e15)))
      return {
        type,
        label: GROUP_LABELS[type],
        accounts: accs,
        total: accs.reduce((s, a) => s + (a.includeInNetWorth ? (accountBalance(a) || 0) : 0), 0),
      }
    })
    .filter((g) => g.accounts.length)
)
const monthLabel = computed(() => {
  const p = netWorth.value?.monthPeriod
  if (!p) return ''
  const [y, m] = p.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
})

// Dépliage des enveloppes d'un compte + menu d'actions ⋯
const openAccountId = ref(null)
/** Déplie les enveloppes d'un compte ; sans enveloppe, il n'y a rien à déplier. */
function toggleAccount(account) {
  if (!account.envelopes.length) return
  openAccountId.value = openAccountId.value === account.id ? null : account.id
}

const menuAccountId = ref(null)

/**
 * Désigne un compte comme principal.
 *
 * Le rôle se transfère, il ne se cumule pas : le serveur retire la marque à l'ancien.
 * C'est aussi pourquoi il ne se décoche pas — il faut toujours un compte principal.
 *
 * @param {object} account Le nouveau compte principal.
 */
async function makeMain(account) {
  try { await updateAccount(account.id, { isMain: true }); await load() } catch (e) { apiError(e) }
}

/**
 * Inclut ou exclut un compte du patrimoine.
 *
 * Pour un compte suivi mais qui n'est pas vraiment à soi (compte joint, compte pro) :
 * il garde ses saisies mais sort du total.
 *
 * @param {object} account Le compte à basculer.
 */
async function togglePatrimoine(account) {
  try { await updateAccount(account.id, { includeInNetWorth: !account.includeInNetWorth }); await load() } catch (e) { apiError(e) }
}

// ─── Formulaire compte (ajout / édition) ─────────────────
const accountFormOpen = ref(false)
const editingAccountId = ref(null)
const accountForm = ref(defaultAccountForm())
// Le compte principal ne se décoche pas : le rôle se transfère en cochant un autre compte
const isEditingMain = computed(() => !!editingAccountId.value && !!accounts.value.find((a) => a.id === editingAccountId.value)?.isMain)

function defaultAccountForm() {
  return { name: '', type: 'courant', isMain: false, includeInNetWorth: true, allowOverdraft: false, multiProjects: false, initialBalance: '' }
}

/** Ouvre le formulaire vide pour créer un compte. */
function openAddAccount() {
  editingAccountId.value = null
  accountForm.value = defaultAccountForm()
  accountFormOpen.value = true
}

/**
 * Ouvre le formulaire pré-rempli sur un compte existant.
 *
 * `multiProjects` et `initialBalance` restent vides : ils n'ont de sens qu'à la
 * création, ils décident de l'enveloppe créée d'office et de son premier versement.
 *
 * @param {object} account Le compte à modifier.
 */
function openEditAccount(account) {
  editingAccountId.value = account.id
  accountForm.value = {
    name: account.name,
    type: account.type,
    isMain: account.isMain,
    includeInNetWorth: account.includeInNetWorth,
    allowOverdraft: account.allowOverdraft,
    multiProjects: false,
    initialBalance: '',
  }
  accountFormOpen.value = true
}

/**
 * Enregistre le compte : création ou modification.
 *
 * À la création seulement, un compte épargne mono-projet reçoit d'office une
 * enveloppe à son nom, alimentée du solde initial — d'où les deux champs supplémentaires.
 */
async function submitAccount() {
  const f = accountForm.value
  if (!f.name.trim()) return
  try {
    if (editingAccountId.value) {
      await updateAccount(editingAccountId.value, {
        name: f.name, type: f.type, isMain: f.isMain, includeInNetWorth: f.includeInNetWorth, allowOverdraft: f.allowOverdraft,
      })
    } else {
      await createAccount({
        name: f.name, type: f.type, isMain: f.isMain, includeInNetWorth: f.includeInNetWorth, allowOverdraft: f.allowOverdraft,
        multiProjects: f.multiProjects,
        initialBalance: f.initialBalance === '' ? null : parseFloat(f.initialBalance),
      })
    }
    accountFormOpen.value = false
    await load()
  } catch (e) { apiError(e) }
}

/**
 * Supprime définitivement un compte, après confirmation.
 *
 * Le serveur refuse dès qu'il porte de l'histoire — entrées, soldes, lignes ou
 * enveloppes. Cette action ne sert qu'à effacer un compte créé par erreur ; pour tous
 * les autres, la voie est la désactivation.
 *
 * @param {object} account Le compte à supprimer.
 */
async function removeAccountConfirm(account) {
  const ok = await confirmDialog({
    title: 'Supprimer définitivement',
    message: `Supprimer « ${account.name} » ? Possible uniquement pour un compte sans aucun historique (créé par erreur). Sinon, utilisez Désactiver : rien n'est perdu.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try { await deleteAccount(account.id); await load() } catch (e) { apiError(e) }
}

// ─── Désactivation (l'historique reste, réactivable) ─────
const deactivation = ref(null) // { account, balance, toAccountId } : le compte a un solde à virer d'abord

/**
 * Désactive un compte : il sort des saisies et du bilan, son historique reste.
 *
 * Deux issues possibles. Sans solde, c'est immédiat. Avec un solde, le serveur refuse
 * par un code ACCOUNT_HAS_BALANCE — l'argent ne peut pas disparaître du bilan sans
 * aller quelque part. On ouvre alors la fenêtre qui demande où le virer, en proposant
 * le compte principal.
 *
 * @param {object} account Le compte à désactiver.
 */
async function deactivateConfirm(account) {
  const ok = await confirmDialog({
    title: 'Désactiver le compte',
    message: `« ${account.name} » disparaîtra des saisies, du bilan et du patrimoine. Tout l'historique est conservé, et le compte est réactivable ici à tout moment.`,
    confirmLabel: 'Désactiver',
  })
  if (!ok) return
  try { await setAccountActive(account.id, false); await load() } catch (e) {
    const p = e.response?.data
    if (p?.code === 'ACCOUNT_HAS_BALANCE') {
      // Le compte a un solde : il faut dire où va l'argent → modal virement puis désactivation
      deactivation.value = {
        account, balance: p.balance,
        toAccountId: activeAccounts.value.find((a) => a.id !== account.id && a.isMain)?.id
          || activeAccounts.value.find((a) => a.id !== account.id)?.id || '',
      }
      return
    }
    apiError(e)
  }
}

/** Vire le solde vers le compte choisi, puis désactive. */
async function confirmDeactivation() {
  const d = deactivation.value
  if (!d?.toAccountId) return
  try {
    await setAccountActive(d.account.id, false, d.toAccountId)
    deactivation.value = null
    await load()
  } catch (e) { apiError(e) }
}

/** Réactive un compte désactivé : il revient dans les saisies et le bilan. */
async function reactivate(account) {
  try { await setAccountActive(account.id, true); await load() } catch (e) { apiError(e) }
}

// ─── Formulaire enveloppe (ajout / édition) ──────────────
const envelopeFormOpen = ref(false)
const editingEnvelopeId = ref(null)
const envelopeForm = ref(defaultEnvelopeForm())

function defaultEnvelopeForm() {
  return { name: '', accountId: '', targetAmount: '', months: '', initialAmount: '', fromEnvelopeId: '' }
}

// ─── Échéance en mois : libellé du mois visé + mensualité simulée ───
// Le mois est du calendrier (calculé ici) ; la mensualité est un montant, donc l'API la calcule.
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const targetMonthLabel = computed(() => {
  const n = Number(envelopeForm.value.months)
  if (envelopeForm.value.months === '' || !Number.isInteger(n) || n < 0) return null
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + n, 1)
  return `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`
})

const simulation = ref(null)      // { deadline, months, remaining, monthlySuggestion } renvoyé par l'API
const simulating = ref(false)
// Numéro d'ordre des requêtes : seule la dernière lancée a le droit d'écrire le
// résultat. Sans lui, une réponse lente arrivée après une plus récente afficherait
// une mensualité qui ne correspond plus à ce qui est saisi.
let simulationSeq = 0

// Toute modification de la cible, de l'échéance ou du montant initial relance la
// simulation auprès de l'API — le front n'invente aucun montant, il affiche le sien.
watch(
  () => {
    const f = envelopeForm.value
    return [f.months, f.targetAmount, f.initialAmount, editingEnvelopeId.value].join('|')
  },
  async () => {
    const f = envelopeForm.value
    if (f.months === '' || f.targetAmount === '') { simulation.value = null; return }
    const seq = ++simulationSeq
    simulating.value = true
    try {
      const { data } = await simulateEnvelope({
        months: Number(f.months),
        targetAmount: parseFloat(f.targetAmount),
        // En création le déjà-versé est le montant initial ; en édition, l'API le lit en base
        currentTotal: editingEnvelopeId.value ? null : (parseFloat(f.initialAmount) || 0),
        envelopeId: editingEnvelopeId.value,
      })
      if (seq === simulationSeq) simulation.value = data
    } catch {
      if (seq === simulationSeq) simulation.value = null
    } finally {
      if (seq === simulationSeq) simulating.value = false
    }
  },
)

// L'enveloppe d'une ligne mensualisée voit son échéance réécrite par le template à chaque cycle
const editingEnvelopeIsLinked = computed(() =>
  !!envelopes.value.find((e) => e.id === editingEnvelopeId.value)?.linkedTemplateLineId
)

// ─── Invariant : le montant initial ne dépasse pas le disponible hors enveloppes du compte ───
const availability = ref(null) // { balance, envelopesTotal, available } du compte choisi
watch(() => envelopeForm.value.accountId, async (id) => {
  availability.value = null
  envelopeForm.value.fromEnvelopeId = ''
  if (id) { try { availability.value = (await getAvailability(id)).data } catch { availability.value = null } }
})
const siblingEnvelopes = computed(() =>
  envelopes.value.filter((e) => e.accountId === envelopeForm.value.accountId && !e.isClosed && e.id !== editingEnvelopeId.value)
)
// L'invariant du projet : la somme des enveloppes d'un compte ne dépasse pas son
// solde. Un montant pris dans une autre enveloppe se compare à ELLE, pas au disponible
// du compte — l'argent est déjà là, il change juste d'étiquette. Découvert autorisé :
// jamais bloquant, seulement signalé.
const initialTooHigh = computed(() => {
  const f = envelopeForm.value
  const amount = parseFloat(f.initialAmount)
  if (!(amount > 0)) return false
  if (f.fromEnvelopeId) {
    const src = siblingEnvelopes.value.find((e) => e.id === f.fromEnvelopeId)
    return src ? amount > src.total : false
  }
  if (availability.value?.allowOverdraft) return false // découvert autorisé : jamais bloqué
  return availability.value?.available != null && amount > availability.value.available
})
// Découvert autorisé et montant au-delà du disponible : accepté, mais signalé en ambre
const initialOverdraws = computed(() => {
  const f = envelopeForm.value
  const amount = parseFloat(f.initialAmount)
  return !!availability.value?.allowOverdraft && !f.fromEnvelopeId && amount > 0
    && availability.value?.available != null && amount > availability.value.available
})

/**
 * Ouvre le formulaire de création d'enveloppe.
 *
 * @param {number|string} [accountId] Compte hôte pré-sélectionné ; vide pour une
 *   enveloppe virtuelle, dont l'argent attend sur le compte principal.
 */
function openAddEnvelope(accountId = '') {
  editingEnvelopeId.value = null
  envelopeForm.value = { ...defaultEnvelopeForm(), accountId }
  envelopeFormOpen.value = true
}

const editingEnvelope = ref(null) // l'enveloppe telle qu'elle était (pour détecter un déplacement de compte)

/**
 * Ouvre le formulaire pré-rempli sur une enveloppe existante.
 *
 * L'enveloppe d'origine est mise de côté dans `editingEnvelope` : c'est en la
 * comparant à la saisie qu'on détectera un changement de compte hôte, qui impose un
 * virement.
 *
 * @param {object} envelope L'enveloppe à modifier.
 */
function openEditEnvelope(envelope) {
  editingEnvelopeId.value = envelope.id
  editingEnvelope.value = envelope
  envelopeForm.value = {
    name: envelope.name,
    accountId: envelope.accountId || '',
    targetAmount: envelope.targetAmount ?? '',
    months: envelope.deadlineMonths ?? '',
    initialAmount: '',
    fromEnvelopeId: '', // même forme que defaultEnvelopeForm : initialTooHigh la lit
  }
  envelopeFormOpen.value = true
}

/**
 * Enregistre l'enveloppe : création ou modification.
 *
 * Le cas délicat est le déplacement vers un autre compte hôte alors que l'enveloppe
 * contient de l'argent : celui-ci doit PHYSIQUEMENT suivre, donc un virement système
 * est enregistré dans le mois en cours. On le confirme d'abord, parce que ça touche
 * aux soldes de deux comptes.
 *
 * La comparaison porte sur les hôtes RÉELS : une enveloppe virtuelle est hébergée par
 * le compte principal, donc passer de « virtuelle » à « compte principal » ne déplace
 * rien et ne doit rien déclencher.
 */
async function submitEnvelope() {
  const f = envelopeForm.value
  if (!f.name.trim()) return
  const data = {
    name: f.name,
    accountId: f.accountId || null,
    targetAmount: f.targetAmount === '' ? null : parseFloat(f.targetAmount),
    months: f.months === '' ? null : Number(f.months),
  }
  try {
    if (editingEnvelopeId.value) {
      // Déplacement vers un autre compte avec de l'argent dedans : l'argent suit → virement système confirmé
      const old = editingEnvelope.value
      const mainId = accounts.value.find((a) => a.isMain)?.id || null
      const oldHost = old?.accountId || mainId
      const newHost = data.accountId || mainId
      if (old && old.total > 0 && (old.accountId || null) !== data.accountId && oldHost !== newHost) {
        const name = (id) => accounts.value.find((a) => a.id === id)?.name || 'le compte principal'
        const ok = await confirmDialog({
          title: "Déplacer l'enveloppe",
          message: `« ${old.name} » contient ${fmt(old.total)} : l'argent doit suivre. Un virement de ${fmt(old.total)} sera enregistré de ${name(oldHost)} vers ${name(newHost)} dans le mois en cours.`,
          confirmLabel: 'Déplacer et virer',
        })
        if (!ok) return
      }
      await updateEnvelope(editingEnvelopeId.value, data)
    } else {
      if (initialTooHigh.value) return
      await createEnvelope({
        ...data,
        initialAmount: f.initialAmount === '' ? null : parseFloat(f.initialAmount),
        fromEnvelopeId: f.fromEnvelopeId || null,
      })
    }
    envelopeFormOpen.value = false
    await load()
  } catch (e) { apiError(e) }
}

/**
 * Clôt une enveloppe, ou la rouvre.
 *
 * @param {object} envelope L'enveloppe à basculer.
 */
async function toggleClosed(envelope) {
  try { await updateEnvelope(envelope.id, { isClosed: !envelope.isClosed }); await load() } catch (e) { apiError(e) }
}

/**
 * Supprime une enveloppe, ou bascule vers la clôture si elle porte de l'histoire.
 *
 * Même schéma que la désactivation d'un compte : le serveur refuse par un code
 * ENVELOPE_HAS_FUNDS, et on ouvre la fenêtre qui demande ce que devient l'argent.
 * Rien ne se perd, tout se réaffecte.
 *
 * @param {object} envelope L'enveloppe à supprimer.
 */
async function removeEnvelopeConfirm(envelope) {
  const ok = await confirmDialog({ title: "Supprimer l'enveloppe", message: `Supprimer « ${envelope.name} » ? (avec un historique, elle sera clôturée à la place — rien n'est perdu)`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try { await deleteEnvelope(envelope.id); await load() } catch (e) {
    const p = e.response?.data
    if (p?.code === 'ENVELOPE_HAS_FUNDS') {
      // L'enveloppe a un historique : clôturer, seule ou en réaffectant son contenu (jamais de perte)
      envelopeDelete.value = { envelope, total: p.total, contributions: p.contributions, choice: 'close', destination: defaultDestination(envelope) }
      return
    }
    apiError(e)
  }
}

// ─── Enveloppe avec historique : clôturer, ou clôturer et réaffecter ─
const envelopeDelete = ref(null) // { envelope, total, contributions, choice: close|reallocate, destination: 'e:ID'|'a:ID' }
const envelopeDeleteTargets = computed(() => {
  const d = envelopeDelete.value
  if (!d) return []
  return envelopes.value.filter((e) => e.id !== d.envelope.id && !e.isClosed)
})
/**
 * Destination proposée d'office pour le contenu d'une enveloppe clôturée.
 *
 * Une autre enveloppe de préférence, sinon le compte principal. Le préfixe distingue
 * les deux : « e:12 » pour une enveloppe, « a:3 » pour un compte.
 *
 * @param {object} envelope L'enveloppe en cours de clôture, à exclure des candidats.
 * @returns {string} La destination préfixée, ou '' s'il n'y en a aucune.
 */
function defaultDestination(envelope) {
  const env = envelopes.value.find((e) => e.id !== envelope.id && !e.isClosed)
  if (env) return 'e:' + env.id
  const acc = activeAccounts.value.find((a) => a.isMain) || activeAccounts.value[0]
  return acc ? 'a:' + acc.id : ''
}

/**
 * Clôt l'enveloppe, seule ou en réaffectant son contenu.
 *
 * Réaffecter vers une enveloppe d'un autre compte déclenche côté serveur le virement
 * qui va avec : l'argent doit suivre son étiquette.
 */
async function confirmEnvelopeDelete() {
  const d = envelopeDelete.value
  if (!d) return
  try {
    if (d.choice === 'reallocate' && d.destination) {
      const [kind, rawId] = d.destination.split(':')
      await closeEnvelopeInto(d.envelope.id, kind === 'e' ? { toEnvelopeId: Number(rawId) } : { toAccountId: Number(rawId) })
    } else {
      await updateEnvelope(d.envelope.id, { isClosed: true })
    }
    envelopeDelete.value = null
    if (openEnvelopeId.value === d.envelope.id) openEnvelopeId.value = null
    await load()
  } catch (e) { apiError(e) }
}

// ─── Contributions (panneau déplié par enveloppe) ────────
const openEnvelopeId = ref(null)
const contributions = ref([])
const contribForm = ref({ amount: '', date: new Date().toISOString().substring(0, 10), notes: '' })

/**
 * Déplie le détail d'une enveloppe et charge ses contributions.
 *
 * La liste est vidée avant le chargement : sans cela, on verrait brièvement les
 * contributions de l'enveloppe précédente, ce qui se lit comme une erreur.
 *
 * @param {object} envelope L'enveloppe à déplier.
 */
async function toggleContribs(envelope) {
  if (openEnvelopeId.value === envelope.id) { openEnvelopeId.value = null; return }
  openEnvelopeId.value = envelope.id
  contribForm.value = { amount: '', date: new Date().toISOString().substring(0, 10), notes: '' }
  contributions.value = [] // jamais les contributions de l'enveloppe précédente pendant le chargement
  try { contributions.value = (await getContributions(envelope.id)).data } catch (e) { apiError(e) }
}

/**
 * Ajoute un versement dans l'enveloppe.
 *
 * Après enregistrement, seuls le montant et la note sont vidés — la date reste, pour
 * enchaîner plusieurs versements du même jour. `load()` est rappelé car un versement
 * change le disponible du compte hôte, affiché ailleurs sur la page.
 *
 * @param {object} envelope L'enveloppe alimentée.
 */
async function submitContribution(envelope) {
  const f = contribForm.value
  if (!f.amount) return
  try {
    await addContribution(envelope.id, { amount: parseFloat(f.amount), date: f.date, notes: f.notes || null })
    contributions.value = (await getContributions(envelope.id)).data
    contribForm.value = { amount: '', date: f.date, notes: '' }
    await load()
  } catch (e) { apiError(e) }
}

/**
 * Retire une contribution.
 *
 * @param {object} envelope L'enveloppe concernée.
 * @param {number} contribId La contribution à retirer.
 */
async function deleteContribution(envelope, contribId) {
  try {
    await removeContribution(envelope.id, contribId)
    contributions.value = (await getContributions(envelope.id)).data
    await load()
  } catch (e) { apiError(e) }
}

const KIND_LABELS = { normale: '', initiale: 'initiale', ajustement: 'ajustement', reaffectation: 'réaffectation', depense: 'dépense' }
</script>

<template>
  <div>
    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold">Comptes &amp; enveloppes</h1>
        <p class="page-sub">Vos comptes bancaires et vos projets d'épargne</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="openAddEnvelope()">+ Enveloppe</button>
        <button class="btn-primary" @click="openAddAccount">+ Compte</button>
      </div>
    </div>

    <p v-if="error" class="error-banner mb-4 text-[13px] rounded-lg px-4 py-2.5">
      Backend injoignable : {{ error }}
    </p>

    <!-- ─── Patrimoine : une valeur en héros + répartition par type — brief §3 ── -->
    <div v-if="netWorth && accounts.length" class="panel patri">
      <div class="synth-hero">
        <span class="num synth-solde">{{ fmt(netWorth.total) }}</span>
        <span class="synth-sub"><span class="has-tip" title="Somme des comptes inclus, au solde du mois en cours. Pour un compte investissement dont les actifs sont valorisés, la valeur de marché remplace le solde.">Patrimoine total</span><template v-if="monthLabel"> · {{ monthLabel }}</template></span>
      </div>
      <template v-for="grp in accountGroups" :key="'t' + grp.type">
        <div class="synth-sep" />
        <div class="synth-kv">
          <span class="synth-k">{{ grp.label }}</span>
          <span class="num synth-v">{{ fmt(grp.total) }}</span>
        </div>
      </template>
    </div>

    <!-- ─── Formulaire compte ────────────────────────── -->
    <AppModal :open="accountFormOpen" :title="editingAccountId ? 'Modifier le compte' : 'Nouveau compte'" @close="accountFormOpen = false">
      <div class="flex flex-wrap gap-4 items-end">
        <label class="field">
          <span>Nom</span>
          <input v-model="accountForm.name" type="text" class="input w-48" placeholder="Compte courant, Livret…" @keyup.enter="submitAccount" />
        </label>
        <label class="field">
          <span class="flex items-center gap-1">Type <HelpTip wide text="Descriptif : n'affecte aucun calcul (ce sont les catégories et les enveloppes qui pilotent l'argent). Il sert au badge, servira aux regroupements des stats, et à la création un compte épargne propose un solde initial + une enveloppe automatique ; un compte investissement est proposé par défaut comme hôte des actifs." /></span>
          <select v-model="accountForm.type" class="input w-40">
            <option value="courant">Courant</option>
            <option value="epargne">Épargne</option>
            <option value="investissement">Investissement</option>
            <option value="especes">Espèces</option>
          </select>
        </label>
        <template v-if="!editingAccountId && accountForm.type === 'epargne'">
          <label class="field">
            <span>Solde initial</span>
            <input v-model="accountForm.initialBalance" type="number" step="0.01" class="input w-32" placeholder="0.00" />
          </label>
          <label class="checkbox">
            <input v-model="accountForm.multiProjects" type="checkbox" />
            <span>Ce compte sert à plusieurs projets</span>
            <HelpTip text="Par défaut un compte épargne reçoit une enveloppe du même nom (un livret = un projet). Cochez si ce compte abritera plusieurs enveloppes (ex. « Vacances » et « Imprévus » sur le même livret) : vous les créerez ensuite." />
          </label>
        </template>
        <label class="checkbox" :class="{ 'opacity-60': isEditingMain }">
          <input v-model="accountForm.isMain" type="checkbox" :disabled="isEditingMain" />
          <span>Compte principal</span>
          <HelpTip wide text="Le compte de vos dépenses courantes : proposé par défaut à chaque saisie, et c'est son solde que le bilan du mois suit. Il y en a toujours exactement un — pour le changer, cochez cette case sur un autre compte (le rôle se transfère). Les lignes du template gardent leur « Depuis » : rien n'est modifié automatiquement." />
          <span v-if="isEditingMain" class="text-[11px] text-gray-400">(se transfère en cochant un autre compte)</span>
        </label>
        <label class="checkbox">
          <input v-model="accountForm.includeInNetWorth" type="checkbox" />
          <span>Inclus dans le patrimoine</span>
          <HelpTip text="Décochez pour un compte qui n'est pas vraiment à vous (compte joint, compte pro…) : il sera suivi mais exclu du total du patrimoine." />
        </label>
        <label class="checkbox">
          <input v-model="accountForm.allowOverdraft" type="checkbox" />
          <span>Découvert autorisé</span>
          <HelpTip wide text="Les enveloppes de ce compte ne sont plus plafonnées par son solde : vous pouvez réserver plus que le disponible (le « hors enveloppes » devient négatif, affiché en ambre). Utile pour un compte avec découvert autorisé à la banque." />
        </label>
      </div>
      <p v-if="!editingAccountId && accountForm.type === 'epargne' && !accountForm.multiProjects" class="text-xs text-gray-400 mt-2">
        Une enveloppe « {{ accountForm.name || '…' }} » sera créée automatiquement sur ce compte.
      </p>
      <template #footer>
        <button class="btn-primary" @click="submitAccount">{{ editingAccountId ? 'Sauver' : 'Créer' }}</button>
        <button class="btn-secondary" @click="accountFormOpen = false">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Formulaire enveloppe ─────────────────────── -->
    <AppModal :open="envelopeFormOpen" :title="editingEnvelopeId ? 'Modifier l\'enveloppe' : 'Nouvelle enveloppe'" @close="envelopeFormOpen = false">
      <div class="flex flex-wrap gap-4 items-end">
        <label class="field">
          <span>Nom</span>
          <input v-model="envelopeForm.name" type="text" class="input w-48" placeholder="Vacances, Imprévus…" @keyup.enter="submitEnvelope" />
        </label>
        <label class="field">
          <span class="flex items-center gap-1">Compte hôte (optionnel) <HelpTip text="Où l'argent de l'enveloppe se trouve physiquement. Sans compte, l'enveloppe est virtuelle : l'argent reste sur le compte principal, simplement réservé." /></span>
          <select v-model="envelopeForm.accountId" class="input w-44">
            <option value="">— Aucun (virtuelle)</option>
            <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <label class="field">
          <span class="flex items-center gap-1">Cible (optionnelle) <HelpTip text="Le montant à atteindre. Avec une échéance, l'app suggère chaque mois la part à mettre de côté pour y arriver à temps." /></span>
          <input v-model="envelopeForm.targetAmount" type="number" step="0.01" class="input w-32" placeholder="4500" />
        </label>
        <label class="field">
          <span class="flex items-center gap-1">Échéance dans (optionnelle) <HelpTip text="Le nombre de mois avant l'échéance, à partir du mois en cours. 0 = ce mois-ci. L'app en déduit le mois visé et la part à mettre de côté chaque mois." /></span>
          <div class="flex items-center gap-2">
            <input v-model="envelopeForm.months" type="number" min="0" step="1" class="input w-20" placeholder="12" />
            <span class="text-[13px]" :class="targetMonthLabel ? 'text-gray-500' : 'text-gray-400'">
              {{ targetMonthLabel ? 'mois → ' + targetMonthLabel : 'mois' }}
            </span>
          </div>
        </label>
        <label v-if="!editingEnvelopeId" class="field">
          <span>Montant initial</span>
          <input v-model="envelopeForm.initialAmount" type="number" step="0.01" class="input w-32" :class="{ 'is-invalid': initialTooHigh }" placeholder="0.00" />
        </label>
        <label v-if="!editingEnvelopeId && siblingEnvelopes.length" class="field">
          <span>Pris dans une enveloppe du compte</span>
          <select v-model="envelopeForm.fromEnvelopeId" class="input w-44">
            <option value="">— non (sur le disponible)</option>
            <!-- Pas de montant ici : le contenu d'un <option> échappe au flou du mode
                 discret, aucun filtre CSS ne s'y applique de façon fiable. -->
            <option v-for="e in siblingEnvelopes" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </label>
      </div>
      <!-- Simulation : essayer plusieurs couples cible / échéance avant de valider -->
      <p v-if="envelopeForm.months !== '' && envelopeForm.targetAmount !== ''" class="text-[12px] mt-2" :class="simulation ? 'text-gray-500' : 'text-gray-400'">
        <template v-if="simulation && simulation.monthlySuggestion !== null">
          <template v-if="simulation.remaining > 0">
            Reste <span class="num">{{ fmt(simulation.remaining) }}</span> à réunir en
            <b>{{ simulation.months === 0 ? 'ce mois-ci' : simulation.months + ' mois' }}</b>
            → <b class="num is-credit">{{ fmt(simulation.monthlySuggestion) }}/mois</b>{{ targetMonthLabel ? ` jusqu'à ${targetMonthLabel}` : '' }}.
          </template>
          <template v-else>Cible déjà atteinte : aucune mensualité à prévoir.</template>
        </template>
        <template v-else-if="simulating">Calcul…</template>
      </p>
      <p v-if="editingEnvelopeIsLinked" class="text-[12px] mt-1 text-amber-600">
        Enveloppe pilotée par une ligne mensualisée du template : son échéance sera recalculée automatiquement au prochain cycle.
      </p>

      <!-- Rappel du disponible : l'invariant Σ enveloppes ≤ solde du compte -->
      <p v-if="!editingEnvelopeId && envelopeForm.accountId && availability" class="text-[12px] mt-2" :class="initialTooHigh ? 'text-red-500' : initialOverdraws ? 'text-amber-600' : 'text-gray-400'">
        <template v-if="availability.available === null">Solde de {{ availability.accountName }} inconnu (saisir le solde de début de mois) — pas de contrôle possible.</template>
        <template v-else-if="envelopeForm.fromEnvelopeId">
          Montant pris dans « {{ siblingEnvelopes.find((e) => e.id === envelopeForm.fromEnvelopeId)?.name }} » — aucun mouvement bancaire, l'enveloppe source baisse d'autant.
          <span v-if="initialTooHigh"> Elle ne contient pas assez.</span>
        </template>
        <template v-else>
          {{ availability.accountName }} : <span class="num">{{ fmt(availability.balance) }}</span> · déjà en enveloppes <span class="num">{{ fmt(availability.envelopesTotal) }}</span> ·
          <b class="num">disponible hors enveloppes {{ fmt(availability.available) }}</b>
          <span v-if="initialTooHigh"> — le montant initial dépasse le disponible.</span>
          <span v-else-if="initialOverdraws"> — au-delà du disponible : le hors enveloppes deviendra négatif (découvert autorisé).</span>
        </template>
      </p>
      <template #footer>
        <button class="btn-primary" :disabled="initialTooHigh" @click="submitEnvelope">{{ editingEnvelopeId ? 'Sauver' : 'Créer' }}</button>
        <button class="btn-secondary" @click="envelopeFormOpen = false">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Désactivation d'un compte avec solde ─────── -->
    <AppModal :open="!!deactivation" title="Le compte a encore un solde" @close="deactivation = null">
      <div v-if="deactivation" class="flex flex-col gap-3 text-[13px]">
        <p>
          « <b>{{ deactivation.account.name }}</b> » a un solde de <b class="num">{{ fmt(deactivation.balance) }}</b>.
          Avant de le désactiver, cet argent doit aller quelque part.
        </p>
        <label class="field"><span>Virer le solde vers</span>
          <select v-model="deactivation.toAccountId" class="input w-48">
            <option v-for="a in activeAccounts.filter((x) => x.id !== deactivation.account.id)" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <p class="text-[11.5px] text-gray-400">
          Un virement de <span class="num">{{ fmt(Math.abs(deactivation.balance)) }}</span> sera enregistré dans le mois en cours, puis le compte sera désactivé (réactivable, historique conservé).
        </p>
      </div>
      <template #footer>
        <button class="btn-primary" :disabled="!deactivation?.toAccountId" @click="confirmDeactivation">Virer puis désactiver</button>
        <button class="btn-secondary" @click="deactivation = null">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Enveloppe avec historique : clôturer, ou clôturer et réaffecter ── -->
    <AppModal :open="!!envelopeDelete" title="L'enveloppe n'est pas vide" @close="envelopeDelete = null">
      <div v-if="envelopeDelete" class="flex flex-col gap-3 text-[13px]">
        <p>
          « <b>{{ envelopeDelete.envelope.name }}</b> » contient <b class="num">{{ fmt(envelopeDelete.total) }}</b>
          ({{ envelopeDelete.contributions }} contribution{{ envelopeDelete.contributions > 1 ? 's' : '' }}).
          L'historique est conservé dans les deux cas.
        </p>
        <label class="checkbox items-start">
          <input v-model="envelopeDelete.choice" type="radio" value="close" class="mt-0.5" />
          <span><b>Clôturer</b> — l'argent redevient hors enveloppes{{ envelopeDelete.envelope.accountName ? ' de ' + envelopeDelete.envelope.accountName : ' du compte principal' }}. Réouvrable.</span>
        </label>
        <label v-if="envelopeDelete.total > 0" class="checkbox items-start">
          <input v-model="envelopeDelete.choice" type="radio" value="reallocate" class="mt-0.5" />
          <span class="flex items-center gap-2 flex-wrap"><b>Clôturer et réaffecter</b> <span class="num">{{ fmt(envelopeDelete.total) }}</span> vers
            <select v-model="envelopeDelete.destination" class="input w-56" @focus="envelopeDelete.choice = 'reallocate'">
              <optgroup v-if="envelopeDeleteTargets.length" label="Mes enveloppes">
                <option v-for="t in envelopeDeleteTargets" :key="'e' + t.id" :value="'e:' + t.id">{{ t.name }}{{ t.accountName ? ' (' + t.accountName + ')' : '' }}</option>
              </optgroup>
              <optgroup label="Mes comptes (hors enveloppes)">
                <option v-for="a in activeAccounts" :key="'a' + a.id" :value="'a:' + a.id">{{ a.name }}</option>
              </optgroup>
            </select>
          </span>
        </label>
        <p class="text-[11.5px] text-gray-400">
          Si la destination est sur un autre compte, un virement système du montant est enregistré dans le mois en cours — l'argent suit physiquement.
        </p>
      </div>
      <template #footer>
        <button class="btn-primary" :disabled="envelopeDelete?.choice === 'reallocate' && !envelopeDelete?.destination" @click="confirmEnvelopeDelete">
          {{ envelopeDelete?.choice === 'reallocate' ? 'Clôturer et réaffecter' : 'Clôturer' }}
        </button>
        <button class="btn-secondary" @click="envelopeDelete = null">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Liquider et renouveler une enveloppe mensualisée ── -->
    <AppModal :open="!!liquidation" title="Liquider et renouveler" @close="liquidation = null">
      <div v-if="liquidation" class="flex flex-col gap-3 text-[13px]">
        <p>
          « <b>{{ liquidation.env.name }}</b> » contient <b class="num">{{ fmt(liquidation.env.total) }}</b>{{ liquidation.env.accountName ? ' sur ' + liquidation.env.accountName : ' (compte principal)' }}.
        </p>
        <label class="field"><span>Virer vers</span>
          <select v-model="liquidation.toAccountId" class="input w-48">
            <option v-for="a in activeAccounts" :key="a.id" :value="a.id">{{ a.name }}{{ a.id === (liquidation.env.accountId || accounts.find((x) => x.isMain)?.id) ? ' (compte hôte — juste libéré)' : '' }}</option>
          </select>
        </label>
        <p class="text-[11.5px] text-gray-400">
          L'enveloppe repart à zéro et son échéance avance d'un cycle — les mensualités reprennent.
          Le virement est tracé dans le mois en cours. <b>Aucune dépense n'est créée</b> :
          vous saisissez ensuite vous-même la ligne du paiement, sur le compte réellement prélevé.
        </p>
      </div>
      <template #footer>
        <button class="btn-primary" :disabled="!liquidation?.toAccountId" @click="confirmLiquidation">Liquider et renouveler</button>
        <button class="btn-secondary" @click="liquidation = null">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Aucun compte ─────────────────────────────── -->
    <div v-if="!accounts.length && !virtualEnvelopes.length" class="panel empty-panel">
      <p>Aucun compte pour l'instant.</p>
      <button class="btn-primary" @click="openAddAccount">Ajouter un compte</button>
    </div>

    <!-- ─── Registre des comptes, groupé par type — brief §2/§4/§5 ── -->
    <div v-else class="panel acc-panel" @click="menuAccountId = null">
      <div class="acc-grid acc-head">
        <span></span><span></span><span class="colh">enveloppes</span><span class="colh">solde</span><span></span>
      </div>

      <section v-for="grp in accountGroups" :key="grp.type" class="reg-section">
        <div class="acc-grid acc-sec-head">
          <span></span>
          <span class="reg-sec-title">{{ grp.label }} <span class="reg-sec-count num">{{ grp.accounts.length }}</span></span>
          <span></span>
          <span class="num reg-sec-real">{{ fmt(grp.total) }}</span>
          <span></span>
        </div>

        <div v-for="account in grp.accounts" :key="account.id" class="acc-rowwrap">
          <div class="acc-grid acc-row" :class="{ 'is-excluded': !account.includeInNetWorth, 'is-openable': account.envelopes.length }" @click="toggleAccount(account)">
            <span class="cell-star"><span v-if="account.isMain" class="star" title="Compte principal">★</span></span>
            <span class="cell-label">
              <span class="row-label">{{ account.name }}</span>
              <span v-if="netWorthOf(account.id)?.marketValue != null" class="tag tag-neutral" title="Valorisé à la valeur de marché de ses actifs">marché</span>
              <span v-if="!account.includeInNetWorth" class="tag tag-neutral" title="Suivi mais exclu du total du patrimoine">exclu</span>
              <span v-if="monthDelta(account.id) !== null" class="tag num" :class="monthDelta(account.id) > 0 ? 'tag-credit' : 'tag-alert'" title="Mouvement du solde depuis le début du mois">{{ monthDelta(account.id) > 0 ? '+' : '' }}{{ fmt(monthDelta(account.id)) }}</span>
            </span>
            <span class="num cell-envcount" :class="{ meta: !account.envelopes.length }">{{ account.envelopes.length || '—' }}</span>
            <span class="num cell-balance" :class="{ 'is-over': (accountBalance(account) ?? 0) < 0, meta: accountBalance(account) === null }" :title="accountBalance(account) === null ? 'Solde inconnu — saisir le solde d\u2019ouverture du mois' : ''">{{ accountBalance(account) === null ? '—' : fmt(accountBalance(account)) }}</span>
            <span class="cell-actions" @click.stop>
              <button class="btn-icon row-action" title="Modifier" @click="openEditAccount(account)">✎</button>
              <span class="menu-wrap">
                <button class="btn-icon" title="Actions" @click="menuAccountId = menuAccountId === account.id ? null : account.id">⋯</button>
                <div v-if="menuAccountId === account.id" class="menu">
                  <button class="menu-item" @click="menuAccountId = null; openAddEnvelope(account.id)">Ajouter une enveloppe</button>
                  <button v-if="!account.isMain" class="menu-item" @click="menuAccountId = null; makeMain(account)">Définir comme compte principal</button>
                  <button class="menu-item" @click="menuAccountId = null; togglePatrimoine(account)">{{ account.includeInNetWorth ? 'Exclure du patrimoine' : 'Inclure dans le patrimoine' }}</button>
                  <button class="menu-item" @click="menuAccountId = null; deactivateConfirm(account)">Désactiver le compte</button>
                  <div class="menu-sep" />
                  <button class="menu-item is-danger" @click="menuAccountId = null; removeAccountConfirm(account)">Supprimer le compte</button>
                </div>
              </span>
              <span class="chev-slot"><PhCaretDown v-if="account.envelopes.length" :size="13" class="chev" :class="{ 'is-open': openAccountId === account.id }" @click="toggleAccount(account)" /></span>
            </span>
          </div>

          <!-- Enveloppes du compte (niveau 2) — §5 -->
          <div v-if="openAccountId === account.id && account.envelopes.length" class="env-block">
            <div v-for="envelope in account.envelopes" :key="envelope.id" class="env-item" :class="{ 'is-closed-env': envelope.isClosed }" @click.stop="toggleContribs(envelope)">
              <div class="env-row1">
                <span class="env-name">{{ envelope.name }}</span>
                <span v-if="envelope.isClosed" class="tag tag-neutral">clôturée</span>
                <span class="num env-amounts">
                  <span :class="isOverfull(envelope) ? 'is-over' : 'ink'">{{ fmt(envelope.total) }}</span><span v-if="envelope.targetAmount" :class="isOverfull(envelope) ? 'is-over' : 'meta'"> / {{ fmt(envelope.effectiveTarget) }}</span>
                  <span v-if="envelope.targetAmount" class="env-pct num">{{ pct(envelope) }} %</span>
                </span>
              </div>
              <div v-if="envelope.targetAmount" class="env-row2">
                <span class="goal-bar"><span class="goal-fill" :class="{ 'is-overfill': isOverfull(envelope) }" :style="{ width: Math.min(100, pct(envelope) || 0) + '%' }" /></span>
                <span class="num env-rest">reste {{ fmt(Math.max(0, Math.round((envelope.effectiveTarget - envelope.total) * 100) / 100)) }}</span>
              </div>

              <div v-if="openEnvelopeId === envelope.id" class="env-expand" @click.stop>
                <div v-for="c in contributions" :key="c.id" class="entry-row">
                  <span class="entry-date num">{{ shortDate(c.date) }}</span>
                  <span class="entry-label">{{ KIND_LABELS[c.kind] ? KIND_LABELS[c.kind] + (c.notes ? ' · ' + c.notes : '') : (c.notes || '') }}</span>
                  <span class="entry-amount num" :class="c.amount >= 0 ? 'is-credit' : 'is-over'">{{ fmt(c.amount) }}</span>
                  <span class="entry-actions"><button class="btn-icon is-danger" title="Supprimer la contribution" @click.stop="deleteContribution(envelope, c.id)">×</button></span>
                </div>
                <p v-if="!contributions.length" class="entries-empty">Aucune contribution.</p>
                <div v-if="!envelope.isClosed" class="env-form">
                  <input v-model="contribForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="submitContribution(envelope)" />
                  <input v-model="contribForm.date" type="date" class="input w-32" />
                  <input v-model="contribForm.notes" type="text" class="input flex-1" placeholder="Note (optionnelle)" />
                  <button class="btn-secondary" @click="submitContribution(envelope)">Ajouter</button>
                </div>
                <div v-if="!envelope.isClosed && reallocTargets(envelope).length" class="env-form">
                  <span class="meta">Réaffecter</span>
                  <input v-model="reallocForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="doReallocate(envelope)" />
                  <span class="meta">vers</span>
                  <select v-model="reallocForm.toEnvelopeId" class="input flex-1">
                    <option value="">— enveloppe</option>
                    <option v-for="t in reallocTargets(envelope)" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                  <button class="btn-secondary" @click="doReallocate(envelope)">OK</button>
                </div>
                <div class="env-actions">
                  <button v-if="envelope.linkedTemplateLineId && envelope.total > 0" class="link-accent" title="Le virement réel est passé : vider l'enveloppe vers un compte et faire repartir le cycle" @click="openLiquidation(envelope)">Liquider et renouveler</button>
                  <button class="link-accent" @click="openEditEnvelope(envelope)">Modifier</button>
                  <button class="link-accent" @click="toggleClosed(envelope)">{{ envelope.isClosed ? 'Rouvrir' : 'Clôturer' }}</button>
                  <button class="link-danger" @click="removeEnvelopeConfirm(envelope)">Supprimer</button>
                </div>
              </div>
            </div>
            <button class="btn-discret" @click.stop="openAddEnvelope(account.id)"><PhPlus :size="12" weight="bold" /> Ajouter une enveloppe</button>
          </div>
        </div>
      </section>

      <!-- Enveloppes virtuelles (sans compte hôte) -->
      <section v-if="virtualEnvelopes.length" class="reg-section">
        <div class="acc-grid acc-sec-head">
          <span></span>
          <span class="reg-sec-title">Enveloppes virtuelles <span class="reg-sec-count num">{{ virtualEnvelopes.length }}</span></span>
          <span></span><span></span><span></span>
        </div>
        <div class="env-block is-flat">
          <div v-for="envelope in virtualEnvelopes" :key="envelope.id" class="env-item" :class="{ 'is-closed-env': envelope.isClosed }" @click.stop="toggleContribs(envelope)">
            <div class="env-row1">
              <span class="env-name">{{ envelope.name }}</span>
              <span v-if="envelope.isClosed" class="tag tag-neutral">clôturée</span>
              <span class="num env-amounts">
                <span :class="isOverfull(envelope) ? 'is-over' : 'ink'">{{ fmt(envelope.total) }}</span><span v-if="envelope.targetAmount" :class="isOverfull(envelope) ? 'is-over' : 'meta'"> / {{ fmt(envelope.targetAmount) }}</span>
                <span v-if="envelope.targetAmount" class="env-pct num">{{ pct(envelope) }} %</span>
              </span>
            </div>
            <div v-if="envelope.targetAmount" class="env-row2">
              <span class="goal-bar"><span class="goal-fill" :class="{ 'is-overfill': isOverfull(envelope) }" :style="{ width: Math.min(100, pct(envelope) || 0) + '%' }" /></span>
              <span class="num env-rest">reste {{ fmt(Math.max(0, Math.round(((envelope.effectiveTarget ?? envelope.targetAmount) - envelope.total) * 100) / 100)) }}</span>
            </div>
            <div v-if="openEnvelopeId === envelope.id" class="env-expand" @click.stop>
              <div v-for="c in contributions" :key="c.id" class="entry-row">
                <span class="entry-date num">{{ shortDate(c.date) }}</span>
                <span class="entry-label">{{ KIND_LABELS[c.kind] ? KIND_LABELS[c.kind] + (c.notes ? ' · ' + c.notes : '') : (c.notes || '') }}</span>
                <span class="entry-amount num" :class="c.amount >= 0 ? 'is-credit' : 'is-over'">{{ fmt(c.amount) }}</span>
                <span class="entry-actions"><button class="btn-icon is-danger" title="Supprimer la contribution" @click.stop="deleteContribution(envelope, c.id)">×</button></span>
              </div>
              <p v-if="!contributions.length" class="entries-empty">Aucune contribution.</p>
              <div v-if="!envelope.isClosed" class="env-form">
                <input v-model="contribForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="submitContribution(envelope)" />
                <input v-model="contribForm.date" type="date" class="input w-32" />
                <input v-model="contribForm.notes" type="text" class="input flex-1" placeholder="Note (optionnelle)" />
                <button class="btn-secondary" @click="submitContribution(envelope)">Ajouter</button>
              </div>
              <div class="env-actions">
                <button class="link-accent" @click="openEditEnvelope(envelope)">Modifier</button>
                <button class="link-accent" @click="toggleClosed(envelope)">{{ envelope.isClosed ? 'Rouvrir' : 'Clôturer' }}</button>
                <button class="link-danger" @click="removeEnvelopeConfirm(envelope)">Supprimer</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Comptes désactivés : hors saisies et bilan, réactivables -->
      <section v-if="inactiveAccounts.length" class="reg-section">
        <div class="acc-grid acc-sec-head">
          <span></span>
          <span class="reg-sec-title meta">Comptes désactivés <span class="reg-sec-count num">{{ inactiveAccounts.length }}</span></span>
          <span></span><span></span><span></span>
        </div>
        <div v-for="account in inactiveAccounts" :key="account.id" class="acc-grid acc-row is-inactive">
          <span></span>
          <span class="cell-label"><span class="row-label meta">{{ account.name }}</span><span class="tag tag-neutral">désactivé</span></span>
          <span></span>
          <span></span>
          <span class="cell-actions" @click.stop>
            <button class="link-accent" @click="reactivate(account)">Réactiver</button>
            <button class="btn-icon is-danger row-action" title="Supprimer définitivement (seulement sans historique)" @click="removeAccountConfirm(account)">×</button>
          </span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
@reference "@/style.css";

/* ─── Page ─── */
.error-banner { background: var(--c-over-soft); color: var(--c-over); }

/* ─── Patrimoine ─── */
.patri { display: flex; align-items: center; gap: var(--s-6); padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.synth-hero { display: flex; flex-direction: column; line-height: var(--lh-tight); }
.synth-solde { font-size: var(--t-hero); font-weight: 600; color: var(--c-ink); }
.synth-sub { font-size: var(--t-meta); color: var(--c-ink-3); margin-top: 2px; }
.synth-sep { width: 1px; align-self: stretch; background: var(--c-line); }
.synth-kv { display: flex; flex-direction: column; gap: 2px; line-height: var(--lh-tight); }
.synth-k { font-size: var(--t-small); color: var(--c-ink-3); }
.synth-v { font-size: var(--t-amount); color: var(--c-ink); }

/* ─── Registre des comptes ─── */
.acc-panel { overflow: visible; }
.acc-grid {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 96px 140px 96px;
  align-items: center;
  gap: var(--s-3);
  padding-inline: var(--s-5);
  min-height: var(--h-row);
}
.acc-head { min-height: 30px; border-bottom: 1px solid var(--c-line); background: var(--c-surface-sunken); border-radius: var(--r-container) var(--r-container) 0 0; }
.colh { font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); text-align: right; }
.reg-section + .reg-section { border-top: 1px solid var(--c-line-strong); }
.acc-sec-head { min-height: 44px; background: var(--c-surface-sunken); }
.reg-sec-title { font-size: var(--t-section); font-weight: 600; color: var(--c-ink); }
.reg-sec-count { font-size: var(--t-small); font-weight: 400; color: var(--c-ink-3); margin-left: var(--s-2); }
.reg-sec-real { font-size: var(--t-section-n); font-weight: 600; color: var(--c-ink); text-align: right; }

.acc-row { border-bottom: 1px solid var(--c-line); transition: background-color var(--dur-fast) var(--ease); }
.acc-rowwrap:last-child .acc-row { border-bottom: none; }
.acc-row.is-openable { cursor: pointer; }
.acc-row:hover { background: var(--c-surface-hover); }
.acc-row.is-excluded .row-label { color: var(--c-ink-3); }
.acc-row.is-inactive { border-bottom: none; }
.cell-star { text-align: center; }
.star { color: var(--c-ink-2); font-size: 14px; }
.cell-label { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
.row-label { font-size: var(--t-body); font-weight: 500; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-envcount { font-size: 13px; color: var(--c-ink-2); text-align: right; }
.cell-balance { font-size: var(--t-amount); color: var(--c-ink); text-align: right; }
.cell-actions { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }
.row-action { opacity: 0; }
.acc-row:hover .row-action, .row-action:focus-visible { opacity: 1; }
.chev-slot { width: 20px; display: flex; justify-content: center; }
.chev { color: var(--c-ink-3); transition: transform var(--dur-fast) var(--ease); transform: rotate(-90deg); cursor: pointer; }
.chev.is-open { transform: rotate(0deg); }

/* Menu ⋯ */
.menu { min-width: 230px; }

/* ─── Enveloppes (niveau 2) ─── */
.env-block {
  margin: var(--s-1) var(--s-5) var(--s-3) calc(20px + var(--s-5));
  background: var(--c-surface-sunken);
  border-radius: var(--r-control);
  padding: var(--s-2) var(--s-4);
  animation: reg-in var(--dur-base) var(--ease);
}
.env-block.is-flat { margin-left: var(--s-5); }
.env-item { padding: var(--s-2) 0; cursor: pointer; }
.env-item + .env-item { border-top: 1px solid var(--c-line); }
.env-item.is-closed-env .env-name { color: var(--c-ink-3); }
.env-row1 { display: flex; align-items: center; gap: var(--s-2); min-height: 24px; }
.env-name { font-size: 13px; font-weight: 500; color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.env-amounts { margin-left: auto; font-size: 13px; white-space: nowrap; }
.env-pct { margin-left: var(--s-3); font-size: var(--t-small); color: var(--c-ink-3); }
.env-row2 { display: flex; align-items: center; gap: var(--s-4); margin-top: 3px; }
.goal-bar { width: 200px; height: 4px; border-radius: var(--r-pill); background: var(--c-track); overflow: hidden; flex-shrink: 0; }
.goal-fill { display: block; height: 100%; background: var(--c-fill-goal); transition: width var(--dur-base) var(--ease); }
.goal-fill.is-overfill { background: var(--c-fill-over); }
.env-rest { font-size: var(--t-small); color: var(--c-ink-3); }
.env-expand { margin-top: var(--s-3); border-top: 1px solid var(--c-line); padding-top: var(--s-2); cursor: default; }
.entry-row { display: grid; grid-template-columns: 84px minmax(0, 1fr) 96px 30px; gap: var(--s-3); align-items: center; min-height: 30px; }
.entry-date { font-size: var(--t-small); color: var(--c-ink-3); }
.entry-label { font-size: var(--t-small); color: var(--c-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.entry-amount { font-size: var(--t-small); text-align: right; }
.entry-actions { display: flex; justify-content: flex-end; }
.entries-empty { font-size: var(--t-small); color: var(--c-ink-3); padding: var(--s-2) 0; }
.env-form { display: flex; align-items: center; gap: var(--s-2); margin-top: var(--s-2); flex-wrap: wrap; }
.env-actions { display: flex; gap: var(--s-4); margin-top: var(--s-3); }


/* ─── Tags ─── */
.tag-credit { background: var(--c-credit-soft); color: var(--c-credit); }

/* ─── Boutons, liens, champs (partagés avec les modales) ─── */
.link-danger { color: var(--c-over); font-size: var(--t-small); font-weight: 500; cursor: pointer; }
.link-danger:hover { text-decoration: underline; }
.input.is-invalid { border-color: var(--c-over); }

@keyframes reg-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

button:focus-visible, select:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); border-radius: var(--r-control); }

@media (max-width: 899px) {
  .acc-grid { grid-template-columns: 20px minmax(0, 1fr) 120px 72px; min-height: var(--h-row-touch); }
  .cell-envcount, .acc-head .colh:first-of-type { display: none; }
}
</style>
