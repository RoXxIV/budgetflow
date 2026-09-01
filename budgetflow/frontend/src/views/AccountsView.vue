<script setup>
import { ref, computed, onMounted } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { getAccounts, createAccount, updateAccount, deleteAccount, getNetWorth } from '@/api/accounts.js'
import {
  getEnvelopes, createEnvelope, updateEnvelope, deleteEnvelope,
  getContributions, addContribution, removeContribution,
  getRecalibration, recalibrateEnvelope,
} from '@/api/envelopes.js'

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

// ─── Recalage d'une enveloppe sur le solde réel du compte ─
const recal = ref(null) // aperçu { accountBalance, envelopesTotal, delta } de l'enveloppe ouverte

async function loadRecalibration(envelope) {
  recal.value = null
  if (!envelope.accountId || envelope.isClosed) return
  try { recal.value = (await getRecalibration(envelope.id)).data } catch { recal.value = null }
}

async function doRecalibrate(envelope) {
  const d = recal.value?.delta
  if (!d) return
  const notes = prompt(
    `Poser ${fmt(d)} en contribution d'ajustement sur « ${envelope.name} » pour l'aligner sur le solde de ${recal.value.accountName} (${fmt(recal.value.accountBalance)}).\n\nNote (optionnelle) :`,
    d < 0 ? 'Sortie non enregistrée' : 'Intérêts / arrondis'
  )
  if (notes === null) return
  try {
    await addContributionRecal(envelope, notes)
  } catch (e) { apiError(e) }
}
async function addContributionRecal(envelope, notes) {
  await recalibrateEnvelope(envelope.id, notes || null)
  contributions.value = (await getContributions(envelope.id)).data
  await load()
  await loadRecalibration(envelope)
}

// Enveloppes sans compte hôte (virtuelles) — les autres sont affichées dans leur compte
const virtualEnvelopes = computed(() => envelopes.value.filter((e) => !e.accountId))

// ─── Helpers ─────────────────────────────────────────────
const TYPE_LABELS = { courant: 'Courant', epargne: 'Épargne', investissement: 'Investissement', especes: 'Espèces' }
const TYPE_COLORS = {
  courant: 'bg-blue-50 text-blue-700',
  epargne: 'bg-emerald-50 text-emerald-700',
  investissement: 'bg-violet-50 text-violet-700',
  especes: 'bg-amber-50 text-amber-700',
}
const fmt = (n) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const pct = (e) => (e.targetAmount ? Math.min(100, Math.round((e.total / e.targetAmount) * 100)) : null)

function apiError(e) {
  alert(e.response?.data?.message || e.message)
}

// ─── Formulaire compte (ajout / édition) ─────────────────
const accountFormOpen = ref(false)
const editingAccountId = ref(null)
const accountForm = ref(defaultAccountForm())

function defaultAccountForm() {
  return { name: '', type: 'courant', isMain: false, includeInNetWorth: true, multiProjects: false, initialBalance: '' }
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
        name: f.name, type: f.type, isMain: f.isMain, includeInNetWorth: f.includeInNetWorth,
      })
    } else {
      await createAccount({
        name: f.name, type: f.type, isMain: f.isMain, includeInNetWorth: f.includeInNetWorth,
        multiProjects: f.multiProjects,
        initialBalance: f.initialBalance === '' ? null : parseFloat(f.initialBalance),
      })
    }
    accountFormOpen.value = false
    await load()
  } catch (e) { apiError(e) }
}

async function removeAccountConfirm(account) {
  const hosted = account.envelopes.length
  const msg = hosted
    ? `Supprimer le compte « ${account.name} » ? Ses ${hosted} enveloppe(s) deviendront virtuelles (sans compte).`
    : `Supprimer le compte « ${account.name} » ?`
  if (!confirm(msg)) return
  try { await deleteAccount(account.id); await load() } catch (e) { apiError(e) }
}

// ─── Formulaire enveloppe (ajout / édition) ──────────────
const envelopeFormOpen = ref(false)
const editingEnvelopeId = ref(null)
const envelopeForm = ref(defaultEnvelopeForm())

function defaultEnvelopeForm() {
  return { name: '', accountId: '', targetAmount: '', deadline: '', initialAmount: '' }
}

function openAddEnvelope(accountId = '') {
  editingEnvelopeId.value = null
  envelopeForm.value = { ...defaultEnvelopeForm(), accountId }
  envelopeFormOpen.value = true
}

function openEditEnvelope(envelope) {
  editingEnvelopeId.value = envelope.id
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
      await updateEnvelope(editingEnvelopeId.value, data)
    } else {
      await createEnvelope({ ...data, initialAmount: f.initialAmount === '' ? null : parseFloat(f.initialAmount) })
    }
    envelopeFormOpen.value = false
    await load()
  } catch (e) { apiError(e) }
}

async function toggleClosed(envelope) {
  try { await updateEnvelope(envelope.id, { isClosed: !envelope.isClosed }); await load() } catch (e) { apiError(e) }
}

async function removeEnvelopeConfirm(envelope) {
  if (!confirm(`Supprimer l'enveloppe « ${envelope.name} » ?`)) return
  try { await deleteEnvelope(envelope.id); await load() } catch (e) { apiError(e) }
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
  await loadRecalibration(envelope)
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

const KIND_LABELS = { normale: '', initiale: 'initiale', ajustement: 'ajustement', reaffectation: 'réaffectation' }
</script>

<template>
  <div>
    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold">Comptes &amp; enveloppes</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Vos comptes et vos projets d'épargne</p>
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
          <span>Type</span>
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
          </label>
        </template>
        <label class="checkbox">
          <input v-model="accountForm.isMain" type="checkbox" />
          <span>Compte principal</span>
        </label>
        <label class="checkbox">
          <input v-model="accountForm.includeInNetWorth" type="checkbox" />
          <span>Inclus dans le patrimoine</span>
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
          <span>Compte hôte (optionnel)</span>
          <select v-model="envelopeForm.accountId" class="input w-44">
            <option value="">— Aucun (virtuelle)</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Cible (optionnelle)</span>
          <input v-model="envelopeForm.targetAmount" type="number" step="0.01" class="input w-32" placeholder="4500" />
        </label>
        <label class="field">
          <span>Échéance (optionnelle)</span>
          <input v-model="envelopeForm.deadline" type="date" class="input w-40" />
        </label>
        <label v-if="!editingEnvelopeId" class="field">
          <span>Montant initial</span>
          <input v-model="envelopeForm.initialAmount" type="number" step="0.01" class="input w-32" placeholder="0.00" />
        </label>
      </div>
      <template #footer>
        <button class="btn-primary" @click="submitEnvelope">{{ editingEnvelopeId ? 'Sauver' : 'Créer' }}</button>
        <button class="btn-secondary" @click="envelopeFormOpen = false">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Aucun compte ─────────────────────────────── -->
    <div v-if="!accounts.length && !virtualEnvelopes.length" class="text-center py-16 text-gray-400">
      <p class="mb-4">Aucun compte pour l'instant.</p>
      <button class="btn-primary" @click="openAddAccount">Créer le premier compte</button>
    </div>

    <!-- ─── Comptes ──────────────────────────────────── -->
    <div class="grid grid-cols-2 gap-4">
      <div v-for="account in accounts" :key="account.id" class="card">
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
            <button class="icon-btn text-red-400 hover:text-red-600" title="Supprimer" @click="removeAccountConfirm(account)">🗑</button>
          </div>
        </div>

        <!-- Enveloppes hébergées -->
        <div v-if="account.envelopes.length" class="mt-3 flex flex-col gap-2">
          <div v-for="envelope in account.envelopes" :key="envelope.id" class="envelope-row" :class="{ 'opacity-50': envelope.isClosed }">
            <div class="flex items-center gap-2 cursor-pointer" @click="toggleContribs(envelope)">
              <span class="text-[13.5px] font-medium">{{ envelope.name }}</span>
              <span v-if="envelope.isClosed" class="badge bg-gray-100 text-gray-500">clôturée</span>
              <span class="ml-auto text-[13.5px] font-semibold">{{ fmt(envelope.total) }}</span>
              <span v-if="envelope.targetAmount" class="text-xs text-gray-400">/ {{ fmt(envelope.targetAmount) }}</span>
            </div>
            <div v-if="envelope.targetAmount" class="progress mt-1.5">
              <div class="progress-bar" :style="{ width: pct(envelope) + '%' }" />
            </div>

            <!-- Contributions dépliées -->
            <div v-if="openEnvelopeId === envelope.id" class="mt-3 border-t border-stone-100 pt-3">
              <!-- Recalage : l'enveloppe vs le solde réel du compte -->
              <div v-if="recal && recal.delta" class="flex items-center gap-2 text-[12px] mb-2 px-2.5 py-2 rounded-lg" :class="recal.delta < 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'">
                <span>{{ recal.accountName }} : {{ fmt(recal.accountBalance) }} · enveloppes {{ fmt(recal.envelopesTotal) }} · écart <b>{{ recal.delta > 0 ? '+' : '' }}{{ fmt(recal.delta) }}</b></span>
                <button class="ml-auto btn-secondary" title="Contribution d'ajustement tracée, l'historique reste" @click.stop="doRecalibrate(envelope)">Recaler sur le compte</button>
              </div>
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
        <p v-else class="text-xs text-gray-400 mt-2">Aucune enveloppe sur ce compte.</p>
        <button class="link text-xs mt-2" @click="openAddEnvelope(account.id)">+ enveloppe sur ce compte</button>
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
