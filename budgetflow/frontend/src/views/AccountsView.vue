<script setup>
import { ref, computed, onMounted } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { getAccounts, createAccount, updateAccount, deleteAccount, setAccountActive, getNetWorth } from '@/api/accounts.js'
import {
  getEnvelopes, createEnvelope, updateEnvelope, deleteEnvelope, closeEnvelopeInto,
  getContributions, addContribution, removeContribution,
  getAvailability, reallocateEnvelope,
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

const netWorthOf = (accountId) => netWorth.value?.accounts.find((a) => a.accountId === accountId) || null
// Écart du solde depuis le début du mois en cours (null si inconnu ou nul)
const monthDelta = (accountId) => {
  const a = netWorthOf(accountId)
  if (!a || a.balance == null || a.start == null) return null
  const d = Math.round((a.balance - a.start) * 100) / 100
  return d === 0 ? null : d
}

// ─── Réaffectation entre enveloppes d'un même compte ─────
const reallocForm = ref({ toEnvelopeId: '', amount: '' })
const reallocTargets = (envelope) => envelopes.value.filter((e) => e.accountId === envelope.accountId && e.id !== envelope.id && !e.isClosed)

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
const TYPE_LABELS = { courant: 'Courant', epargne: 'Épargne', investissement: 'Investissement', especes: 'Espèces' }
const TYPE_COLORS = {
  courant: 'bg-blue-50 text-blue-700',
  epargne: 'bg-emerald-50 text-emerald-700',
  investissement: 'bg-violet-50 text-violet-700',
  especes: 'bg-amber-50 text-amber-700',
}
const fmt = eur // « 1 667,85 € », espaces fines insécables
const pct = (e) => (e.effectiveTarget ? Math.min(100, Math.round((e.total / e.effectiveTarget) * 100)) : null)

// ─── Registre des comptes groupé par type (brief Comptes §2/§4) ───
const GROUP_LABELS = { courant: 'Comptes courants', epargne: 'Épargne', investissement: 'Investissement', especes: 'Espèces' }
// Solde affiché : valeur de marché si valorisé, sinon solde live ; null = inconnu (on affiche « — », pas 0)
const accountBalance = (a) => {
  const r = netWorthOf(a.id)
  if (!r) return null
  return r.used ?? r.balance ?? null
}
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
function toggleAccount(account) {
  if (!account.envelopes.length) return
  openAccountId.value = openAccountId.value === account.id ? null : account.id
}
const menuAccountId = ref(null)
async function makeMain(account) {
  try { await updateAccount(account.id, { isMain: true }); await load() } catch (e) { apiError(e) }
}
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

function openAddAccount() {
  editingAccountId.value = null
  accountForm.value = defaultAccountForm()
  accountFormOpen.value = true
}

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

// Suppression définitive : seulement pour un compte sans historique (créé par erreur) — sinon le backend refuse
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

async function confirmDeactivation() {
  const d = deactivation.value
  if (!d?.toAccountId) return
  try {
    await setAccountActive(d.account.id, false, d.toAccountId)
    deactivation.value = null
    await load()
  } catch (e) { apiError(e) }
}

async function reactivate(account) {
  try { await setAccountActive(account.id, true); await load() } catch (e) { apiError(e) }
}

// ─── Formulaire enveloppe (ajout / édition) ──────────────
const envelopeFormOpen = ref(false)
const editingEnvelopeId = ref(null)
const envelopeForm = ref(defaultEnvelopeForm())

function defaultEnvelopeForm() {
  return { name: '', accountId: '', targetAmount: '', deadline: '', initialAmount: '', fromEnvelopeId: '' }
}

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

function openAddEnvelope(accountId = '') {
  editingEnvelopeId.value = null
  envelopeForm.value = { ...defaultEnvelopeForm(), accountId }
  envelopeFormOpen.value = true
}

const editingEnvelope = ref(null) // l'enveloppe telle qu'elle était (pour détecter un déplacement de compte)

function openEditEnvelope(envelope) {
  editingEnvelopeId.value = envelope.id
  editingEnvelope.value = envelope
  envelopeForm.value = {
    name: envelope.name,
    accountId: envelope.accountId || '',
    targetAmount: envelope.targetAmount ?? '',
    deadline: envelope.deadline || '',
    initialAmount: '',
  }
  envelopeFormOpen.value = true
}

async function submitEnvelope() {
  const f = envelopeForm.value
  if (!f.name.trim()) return
  const data = {
    name: f.name,
    accountId: f.accountId || null,
    targetAmount: f.targetAmount === '' ? null : parseFloat(f.targetAmount),
    deadline: f.deadline || null,
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

async function toggleClosed(envelope) {
  try { await updateEnvelope(envelope.id, { isClosed: !envelope.isClosed }); await load() } catch (e) { apiError(e) }
}

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
function defaultDestination(envelope) {
  const env = envelopes.value.find((e) => e.id !== envelope.id && !e.isClosed)
  if (env) return 'e:' + env.id
  const acc = activeAccounts.value.find((a) => a.isMain) || activeAccounts.value[0]
  return acc ? 'a:' + acc.id : ''
}

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

async function toggleContribs(envelope) {
  if (openEnvelopeId.value === envelope.id) { openEnvelopeId.value = null; return }
  openEnvelopeId.value = envelope.id
  contribForm.value = { amount: '', date: new Date().toISOString().substring(0, 10), notes: '' }
  contributions.value = (await getContributions(envelope.id)).data
}

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

    <p v-if="error" class="mb-4 text-[13px] text-red-600 bg-red-50 rounded-lg px-4 py-2.5">
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
          <input v-model="accountForm.name" type="text" class="input w-48" placeholder="N26, Livret A…" @keyup.enter="submitAccount" />
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
            <HelpTip text="Par défaut un compte épargne reçoit une enveloppe du même nom (un livret = un projet). Cochez si ce compte abritera plusieurs enveloppes (ex. « Japon » et « Matelas » sur le même livret) : vous les créerez ensuite." />
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
          <input v-model="envelopeForm.name" type="text" class="input w-48" placeholder="Japon, Matelas…" @keyup.enter="submitEnvelope" />
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
          <span>Échéance (optionnelle)</span>
          <input v-model="envelopeForm.deadline" type="date" class="input w-40" />
        </label>
        <label v-if="!editingEnvelopeId" class="field">
          <span>Montant initial</span>
          <input v-model="envelopeForm.initialAmount" type="number" step="0.01" class="input w-32" :class="{ 'border-red-400': initialTooHigh }" placeholder="0.00" />
        </label>
        <label v-if="!editingEnvelopeId && siblingEnvelopes.length" class="field">
          <span>Pris dans une enveloppe du compte</span>
          <select v-model="envelopeForm.fromEnvelopeId" class="input w-44">
            <option value="">— non (sur le disponible)</option>
            <option v-for="e in siblingEnvelopes" :key="e.id" :value="e.id">{{ e.name }} ({{ fmt(e.total) }})</option>
          </select>
        </label>
      </div>
      <!-- Rappel du disponible : l'invariant Σ enveloppes ≤ solde du compte -->
      <p v-if="!editingEnvelopeId && envelopeForm.accountId && availability" class="text-[12px] mt-2" :class="initialTooHigh ? 'text-red-500' : initialOverdraws ? 'text-amber-600' : 'text-gray-400'">
        <template v-if="availability.available === null">Solde de {{ availability.accountName }} inconnu (saisir le solde de début de mois) — pas de contrôle possible.</template>
        <template v-else-if="envelopeForm.fromEnvelopeId">
          Montant pris dans « {{ siblingEnvelopes.find((e) => e.id === envelopeForm.fromEnvelopeId)?.name }} » — aucun mouvement bancaire, l'enveloppe source baisse d'autant.
          <span v-if="initialTooHigh"> Elle ne contient pas assez.</span>
        </template>
        <template v-else>
          {{ availability.accountName }} : {{ fmt(availability.balance) }} · déjà en enveloppes {{ fmt(availability.envelopesTotal) }} ·
          <b>disponible hors enveloppes {{ fmt(availability.available) }}</b>
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
          « <b>{{ deactivation.account.name }}</b> » a un solde de <b>{{ fmt(deactivation.balance) }}</b>.
          Avant de le désactiver, cet argent doit aller quelque part.
        </p>
        <label class="field"><span>Virer le solde vers</span>
          <select v-model="deactivation.toAccountId" class="input w-48">
            <option v-for="a in activeAccounts.filter((x) => x.id !== deactivation.account.id)" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <p class="text-[11.5px] text-gray-400">
          Un virement de {{ fmt(Math.abs(deactivation.balance)) }} sera enregistré dans le mois en cours, puis le compte sera désactivé (réactivable, historique conservé).
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
          « <b>{{ envelopeDelete.envelope.name }}</b> » contient <b>{{ fmt(envelopeDelete.total) }}</b>
          ({{ envelopeDelete.contributions }} contribution{{ envelopeDelete.contributions > 1 ? 's' : '' }}).
          L'historique est conservé dans les deux cas.
        </p>
        <label class="checkbox items-start">
          <input v-model="envelopeDelete.choice" type="radio" value="close" class="mt-0.5" />
          <span><b>Clôturer</b> — l'argent redevient hors enveloppes{{ envelopeDelete.envelope.accountName ? ' de ' + envelopeDelete.envelope.accountName : ' du compte principal' }}. Réouvrable.</span>
        </label>
        <label v-if="envelopeDelete.total > 0" class="checkbox items-start">
          <input v-model="envelopeDelete.choice" type="radio" value="reallocate" class="mt-0.5" />
          <span class="flex items-center gap-2 flex-wrap"><b>Clôturer et réaffecter</b> {{ fmt(envelopeDelete.total) }} vers
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
                  <span class="ink">{{ fmt(envelope.total) }}</span><span v-if="envelope.targetAmount" class="meta"> / {{ fmt(envelope.effectiveTarget) }}</span>
                  <span v-if="envelope.targetAmount" class="env-pct num">{{ pct(envelope) }} %</span>
                </span>
              </div>
              <div v-if="envelope.targetAmount" class="env-row2">
                <span class="goal-bar"><span class="goal-fill" :style="{ width: Math.min(100, pct(envelope) || 0) + '%' }" /></span>
                <span class="num env-rest">reste {{ fmt(Math.max(0, Math.round((envelope.effectiveTarget - envelope.total) * 100) / 100)) }}</span>
              </div>

              <div v-if="openEnvelopeId === envelope.id" class="env-expand" @click.stop>
                <div v-for="c in contributions" :key="c.id" class="entry-row">
                  <span class="entry-date num">{{ c.date }}</span>
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
                <span class="ink">{{ fmt(envelope.total) }}</span><span v-if="envelope.targetAmount" class="meta"> / {{ fmt(envelope.targetAmount) }}</span>
                <span v-if="envelope.targetAmount" class="env-pct num">{{ pct(envelope) }} %</span>
              </span>
            </div>
            <div v-if="envelope.targetAmount" class="env-row2">
              <span class="goal-bar"><span class="goal-fill" :style="{ width: Math.min(100, pct(envelope) || 0) + '%' }" /></span>
              <span class="num env-rest">reste {{ fmt(Math.max(0, Math.round(((envelope.effectiveTarget ?? envelope.targetAmount) - envelope.total) * 100) / 100)) }}</span>
            </div>
            <div v-if="openEnvelopeId === envelope.id" class="env-expand" @click.stop>
              <div v-for="c in contributions" :key="c.id" class="entry-row">
                <span class="entry-date num">{{ c.date }}</span>
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
.page-sub { font-size: 13px; color: var(--c-ink-2); margin-top: 2px; }
.panel { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--r-container); }
.meta { color: var(--c-ink-3); font-weight: 400; }
.ink { color: var(--c-ink); }
.is-over { color: var(--c-over); }
.is-credit { color: var(--c-credit); }

/* ─── Patrimoine ─── */
.patri { display: flex; align-items: center; gap: var(--s-6); padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.synth-hero { display: flex; flex-direction: column; line-height: var(--lh-tight); }
.synth-solde { font-size: var(--t-hero); font-weight: 600; color: var(--c-ink); }
.synth-sub { font-size: var(--t-meta); color: var(--c-ink-3); margin-top: 2px; }
.has-tip { text-decoration: underline dotted var(--c-ink-3); text-underline-offset: 3px; cursor: help; }
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
.menu-wrap { position: relative; }
.menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 40;
  min-width: 230px;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-container);
  box-shadow: var(--shadow-overlay);
  padding: var(--s-2);
}
.menu-item {
  display: block; width: 100%; text-align: left;
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-control);
  font-size: 13px; color: var(--c-ink);
  cursor: pointer;
}
.menu-item:hover { background: var(--c-surface-hover); }
.menu-item.is-danger { color: var(--c-over); }
.menu-item.is-danger:hover { background: var(--c-over-soft); }
.menu-sep { height: 1px; background: var(--c-line); margin: var(--s-2) 0; }

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

/* ─── États vides ─── */
.empty-panel { text-align: center; padding: var(--s-8); font-size: 13px; color: var(--c-ink-2); display: flex; flex-direction: column; align-items: center; gap: var(--s-4); }

/* ─── Tags ─── */
.tag {
  display: inline-flex; align-items: center; gap: var(--s-1);
  height: 20px; padding: 0 var(--s-3);
  border-radius: var(--r-control);
  font-size: var(--t-tag); font-weight: 500;
  white-space: nowrap; flex-shrink: 0;
}
.tag-neutral { background: var(--c-surface-sunken); color: var(--c-ink-2); border: 1px solid var(--c-line); }
.tag-credit { background: var(--c-credit-soft); color: var(--c-credit); }
.tag-alert { background: var(--c-over-soft); color: var(--c-over); }

/* ─── Boutons, liens, champs (partagés avec les modales) ─── */
.btn-primary { height: 34px; padding: 0 var(--s-5); background: var(--c-accent); color: #fff; border-radius: var(--r-control); font-size: 13px; font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-primary:hover { background: var(--c-accent-hover); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { height: 30px; padding: 0 var(--s-4); background: var(--c-surface); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); color: var(--c-ink); font-size: var(--t-small); font-weight: 500; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-secondary:hover { background: var(--c-surface-hover); }
.btn-icon { width: 26px; height: 26px; border-radius: var(--r-control); display: inline-flex; align-items: center; justify-content: center; color: var(--c-ink-3); font-size: 13px; cursor: pointer; transition: background-color var(--dur-fast) var(--ease); }
.btn-icon:hover { background: var(--c-surface-hover); color: var(--c-ink); }
.btn-icon.is-danger:hover { background: var(--c-over-soft); color: var(--c-over); }
.btn-discret { display: inline-flex; align-items: center; gap: var(--s-1); color: var(--c-accent); font-size: var(--t-small); font-weight: 500; padding: var(--s-2) 0; cursor: pointer; }
.btn-discret:hover { color: var(--c-accent-hover); }
.link-accent { color: var(--c-accent); font-size: var(--t-small); font-weight: 500; cursor: pointer; }
.link-accent:hover { color: var(--c-accent-hover); text-decoration: underline; }
.link-danger { color: var(--c-over); font-size: var(--t-small); font-weight: 500; cursor: pointer; }
.link-danger:hover { text-decoration: underline; }
.link { color: var(--c-accent); font-size: var(--t-small); cursor: pointer; }
.link:hover { text-decoration: underline; }
.field { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); }
.input { padding: 6px var(--s-3); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); font-size: 13px; color: var(--c-ink); background: var(--c-surface); outline: none; font-family: var(--font-ui); }
.input:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.checkbox { display: flex; align-items: center; gap: var(--s-2); font-size: var(--t-small); color: var(--c-ink-2); cursor: pointer; }
.badge { display: inline-flex; align-items: center; font-size: var(--t-meta); font-weight: 500; padding: 1px var(--s-3); border-radius: var(--r-control); background: var(--c-surface-sunken); color: var(--c-ink-2); border: 1px solid var(--c-line); flex-shrink: 0; }

@keyframes reg-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

button:focus-visible, select:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); border-radius: var(--r-control); }

@media (max-width: 899px) {
  .acc-grid { grid-template-columns: 20px minmax(0, 1fr) 120px 72px; min-height: var(--h-row-touch); }
  .cell-envcount, .acc-head .colh:first-of-type { display: none; }
}
</style>
