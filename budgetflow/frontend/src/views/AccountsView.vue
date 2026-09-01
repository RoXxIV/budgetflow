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
const fmt = (n) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const pct = (e) => (e.effectiveTarget ? Math.min(100, Math.round((e.total / e.effectiveTarget) * 100)) : null)

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
        <p class="text-[13px] text-gray-400 mt-0.5 flex items-center gap-1.5">
          Vos comptes bancaires et vos projets d'épargne
          <HelpTip wide text="Un compte = un vrai compte (courant, livret, PEA…). Une enveloppe = de l'argent réservé pour un projet (Japon, matelas de sécurité…), hébergée sur un compte ou virtuelle. Le solde d'un compte = ses enveloppes + le « hors enveloppes ». Un compte épargne créé avec un solde initial reçoit automatiquement une enveloppe du même nom." />
        </p>
      </div>
      <div class="flex gap-2">
        <button class="btn-secondary" @click="openAddEnvelope()">+ Enveloppe</button>
        <button class="btn-primary" @click="openAddAccount">+ Compte</button>
      </div>
    </div>

    <p v-if="error" class="mb-4 text-[13px] text-red-600 bg-red-50 rounded-lg px-4 py-2.5">
      Backend injoignable : {{ error }}
    </p>

    <!-- ─── Patrimoine ───────────────────────────────── -->
    <div v-if="netWorth && accounts.length" class="card mb-5 flex items-center gap-6">
      <div>
        <span class="block text-[24px] font-bold tracking-tight">{{ fmt(netWorth.total) }}</span>
        <span class="block text-[11.5px] text-gray-400 font-medium">Patrimoine total<span v-if="netWorth.monthPeriod"> · soldes de {{ netWorth.monthPeriod }}</span></span>
      </div>
      <p class="text-[11.5px] text-gray-400 max-w-md">
        Somme des comptes inclus, au solde du mois en cours. Pour un compte investissement dont les actifs sont valorisés,
        la valeur de marché remplace le solde.
      </p>
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
    <div v-if="!accounts.length && !virtualEnvelopes.length" class="text-center py-16 text-gray-400">
      <p class="mb-4">Aucun compte pour l'instant.</p>
      <button class="btn-primary" @click="openAddAccount">Créer le premier compte</button>
    </div>

    <!-- ─── Comptes ──────────────────────────────────── -->
    <div class="grid grid-cols-2 gap-4">
      <div v-for="account in activeAccounts" :key="account.id" class="card">
        <div class="flex items-center gap-2 mb-1">
          <span class="font-semibold text-[15px]">{{ account.name }}</span>
          <span class="badge" :class="TYPE_COLORS[account.type]">{{ TYPE_LABELS[account.type] }}</span>
          <span v-if="account.isMain" class="badge bg-violet-100 text-violet-700" title="Compte principal">★ principal</span>
          <span v-if="!account.includeInNetWorth" class="badge bg-gray-100 text-gray-500">hors patrimoine</span>
          <span v-if="netWorthOf(account.id)?.used != null" class="text-[13px] font-semibold ml-1" :title="netWorthOf(account.id).marketValue != null ? 'Valeur de marché (solde ' + fmt(netWorthOf(account.id).balance) + ')' : 'Solde du mois en cours'">
            {{ fmt(netWorthOf(account.id).used) }}<span v-if="netWorthOf(account.id).marketValue != null" class="text-[10.5px] text-gray-400 font-normal"> marché</span>
          </span>
          <div class="ml-auto flex gap-1">
            <button class="icon-btn" title="Modifier" @click="openEditAccount(account)">✎</button>
            <button class="icon-btn" title="Désactiver — le compte sort des saisies et du bilan, l'historique reste, réactivable" @click="deactivateConfirm(account)">⏻</button>
            <button class="icon-btn text-red-400 hover:text-red-600" title="Supprimer définitivement (seulement sans historique)" @click="removeAccountConfirm(account)">🗑</button>
          </div>
        </div>

        <!-- Enveloppes hébergées -->
        <div v-if="account.envelopes.length" class="mt-3 flex flex-col gap-2">
          <div v-for="envelope in account.envelopes" :key="envelope.id" class="envelope-row" :class="{ 'opacity-50': envelope.isClosed }">
            <div class="flex items-center gap-2 cursor-pointer" @click="toggleContribs(envelope)">
              <span class="text-[13.5px] font-medium">{{ envelope.name }}</span>
              <span v-if="envelope.isClosed" class="badge bg-gray-100 text-gray-500">clôturée</span>
              <span class="ml-auto text-[13.5px] font-semibold">{{ fmt(envelope.total) }}</span>
              <span v-if="envelope.targetAmount" class="text-xs text-gray-400" :title="envelope.spentInTarget ? fmt(envelope.targetAmount) + ' − ' + fmt(envelope.spentInTarget) + ' déjà dépensés pour le projet' : ''">/ {{ fmt(envelope.effectiveTarget) }}<span v-if="envelope.spentInTarget"> · {{ fmt(envelope.spentInTarget) }} dépensés</span></span>
            </div>
            <div v-if="envelope.targetAmount" class="progress mt-1.5">
              <div class="progress-bar" :style="{ width: pct(envelope) + '%' }" />
            </div>

            <!-- Contributions dépliées -->
            <div v-if="openEnvelopeId === envelope.id" class="mt-3 border-t border-stone-100 pt-3">
              <div v-for="c in contributions" :key="c.id" class="flex items-center gap-2 text-[12.5px] py-1">
                <span class="text-gray-400 w-20 shrink-0">{{ c.date }}</span>
                <span :class="c.amount >= 0 ? 'text-emerald-600' : 'text-red-500'" class="font-medium w-24">{{ fmt(c.amount) }}</span>
                <span v-if="KIND_LABELS[c.kind]" class="badge bg-stone-100 text-gray-500">{{ KIND_LABELS[c.kind] }}</span>
                <span class="text-gray-400 truncate">{{ c.notes }}</span>
                <button class="icon-btn ml-auto text-red-300 hover:text-red-500" @click="deleteContribution(envelope, c.id)">×</button>
              </div>
              <p v-if="!contributions.length" class="text-xs text-gray-400 py-1">Aucune contribution.</p>
              <div v-if="!envelope.isClosed" class="flex gap-2 mt-2">
                <input v-model="contribForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="submitContribution(envelope)" />
                <input v-model="contribForm.date" type="date" class="input w-36" />
                <input v-model="contribForm.notes" type="text" class="input flex-1" placeholder="Note (optionnelle)" />
                <button class="btn-secondary" @click="submitContribution(envelope)">Ajouter</button>
              </div>
              <!-- Réaffecter vers une autre enveloppe du compte (aucun mouvement bancaire) -->
              <div v-if="!envelope.isClosed && reallocTargets(envelope).length" class="flex gap-2 mt-2 items-center text-xs">
                <span class="text-gray-400">Réaffecter</span>
                <input v-model="reallocForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="doReallocate(envelope)" />
                <span class="text-gray-400">vers</span>
                <select v-model="reallocForm.toEnvelopeId" class="input w-40">
                  <option value="">— enveloppe</option>
                  <option v-for="t in reallocTargets(envelope)" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
                <button class="btn-secondary" @click="doReallocate(envelope)">OK</button>
              </div>
              <div class="flex gap-3 mt-2 text-xs">
                <button class="link" @click="openEditEnvelope(envelope)">Modifier</button>
                <button class="link" @click="toggleClosed(envelope)">{{ envelope.isClosed ? 'Rouvrir' : 'Clôturer' }}</button>
                <button class="link text-red-400" @click="removeEnvelopeConfirm(envelope)">Supprimer</button>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="text-xs text-gray-400 mt-2">Aucune enveloppe sur ce compte.</p>
        <button class="link text-xs mt-2" @click="openAddEnvelope(account.id)">+ enveloppe sur ce compte</button>
      </div>
    </div>

    <!-- ─── Comptes désactivés ───────────────────────── -->
    <div v-if="inactiveAccounts.length" class="mt-6">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Comptes désactivés</p>
      <div class="grid grid-cols-2 gap-4">
        <div v-for="account in inactiveAccounts" :key="account.id" class="card opacity-60">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-[15px]">{{ account.name }}</span>
            <span class="badge" :class="TYPE_COLORS[account.type]">{{ TYPE_LABELS[account.type] }}</span>
            <span class="badge bg-gray-100 text-gray-500">désactivé</span>
            <div class="ml-auto flex gap-2 items-center">
              <button class="link text-xs" @click="reactivate(account)">Réactiver</button>
              <button class="icon-btn text-red-400 hover:text-red-600" title="Supprimer définitivement (seulement sans historique)" @click="removeAccountConfirm(account)">🗑</button>
            </div>
          </div>
          <p class="text-xs text-gray-400 mt-1">Hors saisies, bilan et patrimoine. L'historique est conservé.</p>
        </div>
      </div>
    </div>

    <!-- ─── Enveloppes virtuelles (sans compte) ──────── -->
    <div v-if="virtualEnvelopes.length" class="mt-6">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Enveloppes virtuelles</p>
      <div class="grid grid-cols-2 gap-4">
        <div v-for="envelope in virtualEnvelopes" :key="envelope.id" class="card envelope-row" :class="{ 'opacity-50': envelope.isClosed }">
          <div class="flex items-center gap-2 cursor-pointer" @click="toggleContribs(envelope)">
            <span class="text-[13.5px] font-medium">{{ envelope.name }}</span>
            <span v-if="envelope.isClosed" class="badge bg-gray-100 text-gray-500">clôturée</span>
            <span class="ml-auto text-[13.5px] font-semibold">{{ fmt(envelope.total) }}</span>
            <span v-if="envelope.targetAmount" class="text-xs text-gray-400">/ {{ fmt(envelope.targetAmount) }}</span>
          </div>
          <div v-if="envelope.targetAmount" class="progress mt-1.5">
            <div class="progress-bar" :style="{ width: pct(envelope) + '%' }" />
          </div>
          <div v-if="openEnvelopeId === envelope.id" class="mt-3 border-t border-stone-100 pt-3">
            <div v-for="c in contributions" :key="c.id" class="flex items-center gap-2 text-[12.5px] py-1">
              <span class="text-gray-400 w-20 shrink-0">{{ c.date }}</span>
              <span :class="c.amount >= 0 ? 'text-emerald-600' : 'text-red-500'" class="font-medium w-24">{{ fmt(c.amount) }}</span>
              <span v-if="KIND_LABELS[c.kind]" class="badge bg-stone-100 text-gray-500">{{ KIND_LABELS[c.kind] }}</span>
              <span class="text-gray-400 truncate">{{ c.notes }}</span>
              <button class="icon-btn ml-auto text-red-300 hover:text-red-500" @click="deleteContribution(envelope, c.id)">×</button>
            </div>
            <p v-if="!contributions.length" class="text-xs text-gray-400 py-1">Aucune contribution.</p>
            <div v-if="!envelope.isClosed" class="flex gap-2 mt-2">
              <input v-model="contribForm.amount" type="number" step="0.01" class="input w-24" placeholder="Montant" @keyup.enter="submitContribution(envelope)" />
              <input v-model="contribForm.date" type="date" class="input w-36" />
              <input v-model="contribForm.notes" type="text" class="input flex-1" placeholder="Note (optionnelle)" />
              <button class="btn-secondary" @click="submitContribution(envelope)">Ajouter</button>
            </div>
            <div class="flex gap-3 mt-2 text-xs">
              <button class="link" @click="openEditEnvelope(envelope)">Modifier</button>
              <button class="link" @click="toggleClosed(envelope)">{{ envelope.isClosed ? 'Rouvrir' : 'Clôturer' }}</button>
              <button class="link text-red-400" @click="removeEnvelopeConfirm(envelope)">Supprimer</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/style.css";

.card { @apply bg-white rounded-xl border border-stone-200 px-5 py-4; }
.form-title { @apply text-[14px] font-semibold mb-3; }
.field { @apply flex flex-col gap-1 text-xs font-medium text-gray-500; }
.input { @apply py-1.5 px-2.5 border border-stone-200 rounded-md text-[13px] text-gray-900 bg-stone-50 outline-none focus:border-violet-400; }
.checkbox { @apply flex items-center gap-1.5 text-[13px] text-gray-600 cursor-pointer pb-1.5; }
.btn-primary { @apply py-2 px-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[13px] font-medium cursor-pointer; }
.btn-secondary { @apply py-2 px-3.5 bg-white border border-stone-200 hover:bg-stone-50 text-gray-600 rounded-lg text-[13px] font-medium cursor-pointer; }
.icon-btn { @apply w-7 h-7 rounded-md hover:bg-stone-100 text-gray-400 cursor-pointer text-[13px]; }
.badge { @apply text-[11px] font-semibold px-2 py-0.5 rounded-full; }
.envelope-row { @apply bg-stone-50 rounded-lg px-3 py-2.5; }
.card.envelope-row { @apply bg-white px-5 py-4; }
.progress { @apply h-1.5 bg-stone-200 rounded-full overflow-hidden; }
.progress-bar { @apply h-full bg-violet-500 rounded-full; }
.link { @apply text-violet-600 hover:underline cursor-pointer; }
</style>
