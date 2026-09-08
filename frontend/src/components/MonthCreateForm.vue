<script setup>
// La création d'un mois : la période, les soldes de début, et le recalage des enveloppes.
//
// POURQUOI C'EST UN COMPOSANT — ce formulaire ne partage rien avec le reste de la page
// Mois : son état ne vit que le temps de la fenêtre, et il ne lit aucun chiffre du mois
// affiché. Il a besoin des comptes actifs et de la liste des mois, il rend le mois créé.
//
// LE PRINCIPE DE L'ÉCRAN — tout y est une PROPOSITION à corriger. Le serveur suggère le
// solde de fin du mois précédent ; la banque, elle, aura arrondi, versé des intérêts,
// ou passé une opération oubliée. C'est le moment où l'application se confronte au
// relevé, et le seul endroit où l'ancrage réel se pose. Reporter ces chiffres
// automatiquement ferait dériver tout le reste, mois après mois.
//
// L'ÉCART EST AFFICHÉ, pas caché : « +2,14 € non expliqué » à côté d'un compte, et
// « −5,00 € d'ajustement » à côté d'une enveloppe. C'est ce qui permet de repérer une
// erreur de saisie plutôt que de l'entériner.
import { ref, computed } from 'vue'
import { getMonthPrefill, createMonth } from '@/api/months.js'
import AppModal from '@/components/AppModal.vue'
import { apiError } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

const props = defineProps({
  accounts: { type: Array, default: () => [] },  // les comptes actifs
  months: { type: Array, default: () => [] },    // pour refuser une période déjà prise
})
const emit = defineEmits(['created'])

const fmt = eur
const open = ref(false)
const newMonth = ref({ period: '', snapshots: {} })
const suggested = ref({})       // solde live de fin du mois précédent, par compte (suggestion)
const previousPeriod = ref(null)
const newEnvelopes = ref([])    // [{ id, name, accountId, accountName, total (cumul), value (saisie) }]

// Écart entre le cumul connu d'une enveloppe et le montant saisi au recalage ;
// null quand il n'y a rien à recaler
const envelopeDelta = (e) => {
  if (e.value === '' || e.value == null) return null
  const d = Math.round((parseFloat(e.value) - e.total) * 100) / 100
  return d === 0 ? null : d
}

// « = compte » : recopie le solde saisi pour le compte hôte (enveloppe seule sur son compte)
const envelopesOnAccount = (accountId) => newEnvelopes.value.filter((e) => e.accountId === accountId).length

/**
 * Recopie le solde saisi du compte dans son enveloppe.
 *
 * Raccourci pour le cas fréquent d'une enveloppe seule sur son compte : les deux
 * valeurs sont alors identiques, autant ne les saisir qu'une fois.
 *
 * @param {object} e L'enveloppe du formulaire de création.
 */
function copyAccountBalance(e) {
  const v = newMonth.value.snapshots[e.accountId]
  if (v !== '' && v != null) e.value = v
}

// Écart entre le solde proposé (fin du mois précédent) et celui qui est saisi :
// c'est l'ajustement bancaire du mois, intérêts et arrondis compris
const suggestionDelta = (accountId) => {
  const s = suggested.value[accountId]
  const v = newMonth.value.snapshots[accountId]
  if (s == null || v === '' || v == null) return null
  const d = Math.round((parseFloat(v) - s) * 100) / 100
  return d === 0 ? null : d
}

const newMonthTaken = computed(() => props.months.some((m) => m.period === newMonth.value.period))
const newMonthName = computed(() => {
  if (!newMonth.value.period) return ''
  const [y, m] = newMonth.value.period.split('-').map(Number)
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return label.charAt(0).toUpperCase() + label.slice(1)
})

/**
 * Ouvre la création de mois, pré-remplie par le serveur.
 *
 * Les soldes proposés sont ceux de fin du mois précédent : une suggestion à corriger,
 * pas une vérité. Les enveloppes sont proposées à leur cumul actuel, à recaler de la
 * même façon.
 */
async function ouvrir() {
  try {
    const { data } = await getMonthPrefill()
    const map = {}
    const sug = {}
    props.accounts.forEach((a) => {
      const s = data.snapshots.find((x) => x.accountId === a.id)
      map[a.id] = s?.balance ?? ''
      if (s) sug[a.id] = s.balance
    })
    newMonth.value = { period: data.period, snapshots: map }
    suggested.value = sug
    previousPeriod.value = data.previousPeriod
    newEnvelopes.value = (data.envelopes || []).map((e) => ({ ...e, value: e.total }))
    open.value = true
  } catch (e) { apiError(e) }
}
// La vue parente ouvre la fenêtre depuis le sélecteur de mois, et lit l'état d'ouverture
// pour masquer son écran « aucun mois » pendant que la fenêtre est posée dessus.
defineExpose({ ouvrir, open })

/**
 * Crée le mois : soldes de départ, recalage des enveloppes, et copie du Template.
 *
 * Seules les enveloppes réellement modifiées sont envoyées (`envelopeDelta` non nul) :
 * renvoyer les autres poserait des ajustements à zéro dans leur historique.
 */
async function submitCreate() {
  if (!newMonth.value.period || newMonthTaken.value) return
  const snapshotList = Object.entries(newMonth.value.snapshots)
    .filter(([, v]) => v !== '' && v !== null)
    .map(([accountId, balance]) => ({ accountId: Number(accountId), balance: parseFloat(balance) }))
  const envelopeList = newEnvelopes.value
    .filter((e) => envelopeDelta(e) !== null)
    .map((e) => ({ envelopeId: e.id, total: parseFloat(e.value) }))
  try {
    const { data: created } = await createMonth({ period: newMonth.value.period, snapshots: snapshotList, envelopes: envelopeList })
    open.value = false
    emit('created', created)
  } catch (e) { apiError(e) }
}
</script>

<template>
  <AppModal :open="open" title="Nouveau mois" @close="open = false">
    <!-- Un mois suit des soldes : sans compte actif, on guide vers la page Comptes -->
    <div v-if="!accounts.length" class="flex flex-col gap-3 text-[13px]">
      <p>Un mois suit les soldes de vos comptes — il en faut au moins un.</p>
      <p class="text-gray-400 text-[12px]">Créez d'abord votre compte principal (celui de vos dépenses courantes), vous reviendrez ici juste après.</p>
      <router-link to="/comptes" class="btn-primary self-start inline-flex items-center" @click="open = false">Créer mon premier compte</router-link>
    </div>
    <template v-else>
      <div class="flex items-center gap-3 mb-3">
        <input v-model="newMonth.period" type="month" class="input" title="Mois à créer" />
        <span v-if="newMonthName && !newMonthTaken" class="text-[13px] font-medium text-violet-600">→ {{ newMonthName }}</span>
        <span v-if="newMonthTaken" class="text-[12.5px] font-medium text-red-500">Un mois existe déjà pour {{ newMonthName }}</span>
      </div>

      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Solde de début de mois (recalage par compte)</p>
      <p v-if="previousPeriod" class="text-[11.5px] text-gray-400 mb-2">
        Pré-rempli avec le solde de fin de {{ previousPeriod }} calculé par l'app — corrigez avec le vrai solde de la banque, l'écart s'affiche à titre d'info.
      </p>
      <div class="flex flex-col gap-1.5 mb-4">
        <div v-for="a in accounts" :key="a.id" class="flex items-center gap-2.5">
          <span class="text-[13px] text-gray-600 w-36 shrink-0">{{ a.name }}</span>
          <input v-model="newMonth.snapshots[a.id]" type="number" step="0.01" class="input w-28" placeholder="—" :title="'Solde de début pour ' + a.name" @keyup.enter="submitCreate" />
          <span v-if="suggestionDelta(a.id) !== null" class="num text-[11px]" :class="suggestionDelta(a.id) > 0 ? 'text-emerald-600' : 'text-amber-600'" :title="'Suggéré : ' + fmt(suggested[a.id])">
            {{ suggestionDelta(a.id) > 0 ? '+' : '' }}{{ fmt(suggestionDelta(a.id)) }} non expliqué
          </span>
        </div>
      </div>

      <!-- Recalage des enveloppes -->
      <template v-if="newEnvelopes.length">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Enveloppes (montant réel)</p>
        <p class="text-[11.5px] text-gray-400 mb-2">
          Pré-rempli avec le cumul des contributions. Si l'argent réellement mis de côté diffère, corrigez : l'écart devient une contribution d'ajustement datée du mois.
        </p>
        <div class="flex flex-col gap-1.5 mb-4">
          <div v-for="e in newEnvelopes" :key="e.id" class="flex items-center gap-2.5">
            <span class="text-[13px] text-gray-600 w-36 shrink-0 truncate" :title="e.accountName ? 'sur ' + e.accountName : 'virtuelle'">{{ e.name }}</span>
            <input v-model="e.value" type="number" step="0.01" class="input w-28" :title="'Montant réel de ' + e.name" @keyup.enter="submitCreate" />
            <button
              v-if="e.accountId && newMonth.snapshots[e.accountId] !== '' && envelopesOnAccount(e.accountId) === 1"
              class="link text-[11px]"
              :title="'Recopier le solde saisi pour ' + e.accountName"
              @click="copyAccountBalance(e)"
            >= {{ e.accountName }}</button>
            <span v-if="envelopeDelta(e) !== null" class="num text-[11px]" :class="envelopeDelta(e) > 0 ? 'text-emerald-600' : 'text-amber-600'">
              {{ envelopeDelta(e) > 0 ? '+' : '' }}{{ fmt(envelopeDelta(e)) }} d'ajustement
            </span>
          </div>
        </div>
      </template>
    </template>

    <template #footer>
      <button v-if="accounts.length" class="btn-primary" :disabled="!newMonth.period || newMonthTaken" @click="submitCreate">Créer depuis le template</button>
      <button class="btn-secondary" @click="open = false">Annuler</button>
    </template>
  </AppModal>
</template>
