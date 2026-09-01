<script setup>
import { ref, computed, onMounted } from 'vue'
import { getTemplateLines, createTemplateLine, updateTemplateLine, reorderTemplateLines, deleteTemplateLine, applyTemplateLineToMonth, monthlyizeTemplateLine } from '@/api/template.js'
import { getCurrentMonth } from '@/api/months.js'
import { getCategories } from '@/api/categories.js'
import { getThemes } from '@/api/themes.js'
import { getAccounts } from '@/api/accounts.js'
import { getSettings } from '@/api/settings.js'
import { getEnvelopes, updateEnvelope } from '@/api/envelopes.js'
import AppModal from '@/components/AppModal.vue'
import HelpTip from '@/components/HelpTip.vue'
import { confirmDialog, apiError, toast } from '@/composables/useDialog.js'

// ─── Data ────────────────────────────────────────────────
const lines = ref([])
const categories = ref([])
const themes = ref([])
const accounts = ref([])
const settings = ref(null)

const currentMonth = ref(null)   // mois ouvert du calendrier (cible de la propagation), ou null
const envelopes = ref([])        // pour afficher / changer le compte hôte d'une ligne mensualisée

async function load() {
  const [lRes, cRes, tRes, aRes, sRes, mRes, eRes] = await Promise.all([
    getTemplateLines(), getCategories(), getThemes(), getAccounts(), getSettings(), getCurrentMonth(), getEnvelopes(),
  ])
  lines.value = lRes.data
  categories.value = cRes.data
  themes.value = tRes.data
  accounts.value = aRes.data
  settings.value = sRes.data
  currentMonth.value = mRes.data
  envelopes.value = eRes.data
}
const envelopeById = (id) => envelopes.value.find((e) => e.id === id) || null
onMounted(load)

// ─── Propagation vers le mois en cours ───────────────────
async function applyToCurrentMonth(line, { ask = true } = {}) {
  if (!currentMonth.value) return
  if (ask) {
    const ok = await confirmDialog({ title: `Appliquer à ${currentMonth.value.name}`, message: `La ligne « ${line.label} » sera copiée dans ${currentMonth.value.name} (ou sa copie mise à jour). Le réel du mois n'est pas touché.`, confirmLabel: 'Appliquer' })
    if (!ok) return
  }
  try {
    await applyTemplateLineToMonth(line.id, currentMonth.value.id)
    toast(`« ${line.label} » appliquée à ${currentMonth.value.name}`, 'success')
  } catch (e) { apiError(e) }
}

// ─── Helpers ─────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
const themeById = (id) => themes.value.find((t) => t.id === id) || null

// ─── Lignes groupées par catégorie ───────────────────────
const NO_CATEGORY = { id: null, name: 'Sans catégorie', type: 'depense', color: '#9ca3af' }

const groups = computed(() => {
  const result = categories.value.map((c) => ({
    category: c,
    lines: lines.value.filter((l) => l.categoryId === c.id),
  }))
  const orphans = lines.value.filter((l) => !l.categoryId || !categories.value.some((c) => c.id === l.categoryId))
  if (orphans.length) result.push({ category: NO_CATEGORY, lines: orphans })
  return result.map((g) => ({ ...g, total: g.lines.reduce((s, l) => s + (l.plannedAmount || 0), 0) }))
})

const groupsLeft = computed(() => groups.value.filter((_, i) => i % 2 === 0))
const groupsRight = computed(() => groups.value.filter((_, i) => i % 2 === 1))

// ─── Totaux prévisionnels (le type de la catégorie pilote) ─
const totals = computed(() => {
  const byType = { depense: 0, revenu: 0, epargne: 0, transfert: 0 }
  groups.value.forEach((g) => { byType[g.category.type] += g.total })
  return {
    ...byType,
    reste: byType.revenu - byType.depense - byType.epargne - byType.transfert,
  }
})

// ─── Édition (panneau déplié par ligne) ──────────────────
const openLineId = ref(null)   // id de ligne existante en édition, ou 'new-<catId>' pour un ajout
const form = ref({})

function defaultForm(category) {
  return {
    label: '',
    plannedAmount: '',
    categoryId: category.id,
    themeId: '',
    fromAccountId: category.type === 'revenu' ? '' : (accounts.value.find((a) => a.isMain)?.id || ''),
    toAccountId: '',
    paymentMethod: settings.value?.paymentMethods?.[0] || '',
    isShared: false,
    recurringDay: '',
    notes: '',
    potLineId: pots.value[0]?.id || '',
    isPot: false,
    potPartnerName: '',
    potPartnerPaid: '',
    potMyShare: 50,
    intervalMonths: 1,       // périodicité : tous les N mois
    anchorMonth: '',         // mois d'ancrage (si N > 1)
    monthlyize: false,       // mensualiser : enveloppe liée qui lisse la charge
    monthlyizeAccountId: '', // où l'argent attend (vide = compte principal, enveloppe virtuelle)
  }
}

const INTERVALS = [
  { value: 1, label: 'Chaque mois' },
  { value: 2, label: 'Tous les 2 mois' },
  { value: 3, label: 'Tous les 3 mois' },
  { value: 6, label: 'Tous les 6 mois' },
  { value: 12, label: 'Une fois par an' },
]
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const fmtDue = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// Modal de ligne (ajout et édition) — même composant que dans le Mois
const modalLine = ref(null)       // ligne en édition (null = ajout)
const modalCategory = ref(null)   // catégorie du « + ligne »
const modalOpen = computed(() => openLineId.value !== null)
const modalAdding = computed(() => typeof openLineId.value === 'string')
// « Vers » : catégorie à destination, virement (provision vers un de mes comptes / extérieur), ou ligne qui en a déjà un
const showVers = computed(() =>
  formCategoryType.value !== 'depense' || /virement/i.test(form.value.paymentMethod || '') || !!form.value.toAccountId
)

function openAdd(category) {
  openLineId.value = `new-${category.id}`
  modalLine.value = null
  modalCategory.value = category
  form.value = defaultForm(category)
}

function openEdit(line) {
  openLineId.value = line.id
  modalLine.value = line
  modalCategory.value = categories.value.find((c) => c.id === line.categoryId) || null
  form.value = {
    label: line.label,
    plannedAmount: line.plannedAmount ?? '',
    categoryId: line.categoryId,
    themeId: line.themeId || '',
    fromAccountId: line.fromAccountId || '',
    toAccountId: line.toAccountId || '',
    paymentMethod: line.paymentMethod || '',
    isShared: line.isShared,
    recurringDay: line.recurringDay || '',
    notes: line.notes || '',
    potLineId: line.potLineId || pots.value[0]?.id || '',
    isPot: line.isPot,
    potPartnerName: line.potPartnerName || '',
    potPartnerPaid: line.potPartnerPaid ?? '',
    potMyShare: line.potMyShare ?? 50,
    intervalMonths: line.intervalMonths || 1,
    anchorMonth: line.anchorMonth || '',
    monthlyize: !!line.envelopeId,
    monthlyizeAccountId: envelopeById(line.envelopeId)?.accountId || '',
  }
}

function closePanel() {
  openLineId.value = null
  modalLine.value = null
}

function formData() {
  const f = form.value
  return {
    label: f.label,
    plannedAmount: f.plannedAmount === '' ? 0 : parseFloat(f.plannedAmount),
    categoryId: f.categoryId || null,
    themeId: f.themeId || null,
    fromAccountId: f.fromAccountId || null,
    toAccountId: f.toAccountId || null,
    paymentMethod: f.paymentMethod || null,
    isShared: f.isShared,
    recurringDay: f.recurringDay === '' ? null : Number(f.recurringDay),
    notes: f.notes || null,
    potLineId: f.isShared ? (f.potLineId || null) : null,
    isPot: !!f.isPot,
    potPartnerName: f.isPot ? (f.potPartnerName || null) : null,
    potPartnerPaid: f.isPot && f.potPartnerPaid !== '' ? parseFloat(f.potPartnerPaid) : 0,
    potMyShare: f.isPot ? (Number(f.potMyShare) || 50) : 50,
    intervalMonths: Number(f.intervalMonths) || 1,
    anchorMonth: Number(f.intervalMonths) > 1 ? (Number(f.anchorMonth) || null) : null,
  }
}

async function submit() {
  if (!form.value.label.trim()) return
  const f = form.value
  if (Number(f.intervalMonths) > 1 && !f.anchorMonth) { toast("Indiquez le mois d'ancrage pour une ligne non mensuelle.", 'error'); return }
  try {
    let saved
    if (typeof openLineId.value === 'string') {
      saved = (await createTemplateLine(formData())).data
      // Nouvelle ligne : proposer de l'ajouter aussi au mois en cours (sinon elle n'apparaît qu'au prochain mois)
      if (currentMonth.value && Number(f.intervalMonths) <= 1) {
        const also = await confirmDialog({ title: 'Ligne ajoutée au template', message: `L'ajouter aussi à ${currentMonth.value.name} ? Sinon elle n'apparaîtra qu'à partir du prochain mois.`, confirmLabel: `Oui, ajouter à ${currentMonth.value.name}`, cancelLabel: 'Non, template seulement' })
        if (also) await applyToCurrentMonth(saved, { ask: false })
      }
    } else {
      saved = (await updateTemplateLine(openLineId.value, formData())).data
    }
    // Mensualisation : enveloppe liée créée / déliée selon la case ; compte hôte modifiable ensuite
    const wantMonthly = Number(f.intervalMonths) > 1 && f.monthlyize
    if (wantMonthly !== !!saved.envelopeId) {
      await monthlyizeTemplateLine(saved.id, wantMonthly, f.monthlyizeAccountId || null)
    } else if (wantMonthly && saved.envelopeId) {
      const env = envelopeById(saved.envelopeId)
      const wantedAccount = f.monthlyizeAccountId || accounts.value.find((a) => a.isMain)?.id || null
      if (env && (env.accountId || null) !== wantedAccount) {
        // L'enveloppe contient déjà de l'argent : il doit physiquement suivre → virement système confirmé
        let moveOk = true
        if (env.total > 0) {
          const name = (id) => accounts.value.find((a) => a.id === id)?.name || 'le compte principal'
          const oldHost = env.accountId || accounts.value.find((a) => a.isMain)?.id || null
          moveOk = await confirmDialog({
            title: 'Déplacer la mise de côté',
            message: `L'enveloppe « ${env.name} » contient ${fmt(env.total)} : un virement de ce montant sera enregistré de ${name(oldHost)} vers ${name(wantedAccount)} dans le mois en cours.`,
            confirmLabel: 'Déplacer et virer',
          })
        }
        if (moveOk) await updateEnvelope(env.id, { accountId: wantedAccount })
      }
    }
    closePanel()
    const [lRes, eRes] = await Promise.all([getTemplateLines(), getEnvelopes()])
    lines.value = lRes.data
    envelopes.value = eRes.data
  } catch (e) { apiError(e) }
}

async function removeLineConfirm(line) {
  const ok = await confirmDialog({
    title: 'Supprimer du template',
    message: `« ${line.label} » ne sera plus copiée dans les prochains mois. Les copies déjà présentes dans les mois restent (détachées du template)${line.envelopeId ? ' ; son enveloppe reste ouverte' : ''}.`,
    confirmLabel: 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteTemplateLine(line.id)
    if (openLineId.value === line.id) closePanel()
    lines.value = (await getTemplateLines()).data
  } catch (e) { apiError(e) }
}

// ─── Réordonnancement dans une catégorie ─────────────────
async function moveLine(group, index, delta) {
  const target = index + delta
  if (target < 0 || target >= group.lines.length) return
  const list = [...group.lines]
  ;[list[index], list[target]] = [list[target], list[index]]
  // L'ordre est global : on réécrit le sort_order de toutes les lignes, groupe par groupe
  const orders = []
  let order = 0
  groups.value.forEach((g) => {
    const groupLines = g.category.id === group.category.id ? list : g.lines
    groupLines.forEach((l) => orders.push({ id: l.id, order: order++ }))
  })
  try {
    lines.value = (await reorderTemplateLines(orders)).data
  } catch (e) { apiError(e) }
}

// Cagnottes du template : les ½ n'existent que s'il y en a au moins une
const pots = computed(() => lines.value.filter((l) => l.isPot))
const sharingOn = computed(() => pots.value.length > 0)

// Le type de la catégorie du formulaire (adapte les champs affichés)
const formCategoryType = computed(() => {
  const c = categories.value.find((x) => x.id === form.value.categoryId)
  return c?.type || 'depense'
})
</script>

<template>
  <div>
    <!-- ─── En-tête + totaux ─────────────────────────── -->
    <div class="flex items-start justify-between mb-5">
      <div>
        <h1 class="text-[22px] font-semibold">Template</h1>
        <p class="text-[13px] text-gray-400 mt-0.5 flex items-center gap-1.5">
          La base dupliquée à chaque nouveau mois
          <HelpTip wide text="Vos lignes récurrentes (loyer, salaire, courses, abonnements…) avec leur montant prévu. À chaque nouveau mois, elles sont copiées ; dans le mois vous saisissez le réel. Une modification ici ne touche que les mois suivants — « Appliquer à <mois> » pour le mois en cours." />
        </p>
      </div>
      <div class="flex gap-4 text-right">
        <div class="tile"><span class="tile-value text-emerald-600">{{ fmt(totals.revenu) }}</span><span class="tile-label">Revenus prévus</span></div>
        <div class="tile"><span class="tile-value text-red-500">{{ fmt(totals.depense) }}</span><span class="tile-label">Dépenses prévues</span></div>
        <div class="tile"><span class="tile-value text-violet-600">{{ fmt(totals.epargne) }}</span><span class="tile-label">Épargne prévue</span></div>
        <div class="tile" title="Revenus − dépenses − épargne − transferts">
          <span class="tile-value" :class="totals.reste >= 0 ? 'text-gray-900' : 'text-red-500'">{{ fmt(totals.reste) }}</span>
          <span class="tile-label">Reste théorique</span>
        </div>
      </div>
    </div>

    <!-- ─── Ligne du template (modal : ajout et édition) ── -->
    <AppModal :open="modalOpen" :title="modalAdding ? 'Nouvelle ligne — ' + (modalCategory?.name || '') : 'Modifier « ' + (modalLine?.label || '') + ' »'" wide @close="closePanel">
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap gap-3 items-end">
          <label class="field"><span>Libellé</span><input v-model="form.label" type="text" class="input w-44" placeholder="Loyer, Courses…" @keyup.enter="submit" /></label>
          <label v-if="!form.isPot" class="field"><span class="flex items-center gap-1">Prévu (€) <HelpTip text="Le montant attendu chaque mois. Dans le mois, une ligne avec un prévu et aucune entrée a une case ☐ : cocher = payé au prévu. Dès qu'une entrée existe, le réel remplace le prévu." /></span><input v-model="form.plannedAmount" type="number" step="0.01" class="input w-24" @keyup.enter="submit" /></label>
          <label class="field"><span class="flex items-center gap-1">Jour du mois <HelpTip :text="form.isPot ? 'Jour où vous réglez la cagnotte : date par défaut du ☐ payé.' : 'Jour du prélèvement : date par défaut quand vous cochez ☐ payé dans le mois.'" /></span><input v-model="form.recurringDay" type="number" min="1" max="31" class="input w-20" placeholder="—" /></label>
          <label v-if="!modalAdding" class="field"><span>Catégorie</span>
            <select v-model="form.categoryId" class="input w-40">
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <label v-if="themes.length" class="field"><span>Thème</span>
            <select v-model="form.themeId" class="input w-32">
              <option value="">—</option>
              <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </label>
        </div>

        <!-- Périodicité et mensualisation -->
        <div v-if="!form.isPot" class="flex flex-wrap gap-3 items-end">
          <label class="field"><span class="flex items-center gap-1">Périodicité <HelpTip text="Chaque mois, ou tous les N mois à partir d'un mois d'ancrage (ex. une fois par an en juillet, tous les 6 mois en mars et septembre). La ligne n'apparaît que les mois du cycle." /></span>
            <select v-model="form.intervalMonths" class="input w-40">
              <option v-for="i in INTERVALS" :key="i.value" :value="i.value">{{ i.label }}</option>
            </select>
          </label>
          <label v-if="Number(form.intervalMonths) > 1" class="field"><span>Mois d'ancrage</span>
            <select v-model="form.anchorMonth" class="input w-36">
              <option value="">—</option>
              <option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option>
            </select>
          </label>
          <template v-if="Number(form.intervalMonths) > 1">
            <label class="checkbox self-end"><input v-model="form.monthlyize" type="checkbox" /><span>Mensualiser</span><HelpTip wide text="Lisse une charge non mensuelle : une enveloppe du même nom est créée (cible = le montant, échéance = la prochaine occurrence) et suggère chaque mois la part à mettre de côté — ☐ versé dans le mois. Le jour J, ☐ payé sort le montant de l'enveloppe et le cycle repart. L'enveloppe démarre à 0 : les premières mensualités sont plus grosses." /></label>
            <label v-if="form.monthlyize" class="field" title="Compte hôte de l'enveloppe : c'est là que les mensualités s'accumulent, et de là que le paiement partira le jour J"><span>Mise de côté sur</span>
              <select v-model="form.monthlyizeAccountId" class="input w-44">
                <option value="">Compte principal (virtuelle)</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
          </template>
        </div>
        <p v-if="Number(form.intervalMonths) > 1" class="text-[11.5px] text-gray-400 -mt-2">
          Apparaît {{ form.anchorMonth ? (Number(form.intervalMonths) === 12 ? 'chaque ' + MONTHS[form.anchorMonth - 1] : 'en ' + MONTHS[form.anchorMonth - 1] + ' puis tous les ' + form.intervalMonths + ' mois') : 'les mois du cycle' }}.
          <template v-if="form.monthlyize && modalLine?.envelopeId && envelopeById(modalLine.envelopeId)">
            Enveloppe « {{ envelopeById(modalLine.envelopeId).name }} » : {{ fmt(envelopeById(modalLine.envelopeId).total) }} / {{ fmt(envelopeById(modalLine.envelopeId).targetAmount) }}, ≈ {{ fmt(envelopeById(modalLine.envelopeId).monthlySuggestion) }}/mois.
          </template>
          <template v-else-if="form.monthlyize">L'enveloppe « {{ form.label || '…' }} » sera créée à 0.</template>
        </p>

        <div class="flex flex-wrap gap-3 items-end">
          <label v-if="formCategoryType === 'revenu'" class="field"><span>Compte crédité</span>
            <select v-model="form.toAccountId" class="input w-40">
              <option value="">—</option>
              <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <template v-else>
            <label class="field"><span class="flex items-center gap-1">Depuis <HelpTip text="Le compte débité par défaut. « Vers » n'apparaît que si l'argent va sur un autre de vos comptes (épargne, virement, provision) ; pour un paiement à un tiers, laissez « extérieur »." /></span>
              <select v-model="form.fromAccountId" class="input w-40">
                <option value="">— aucun</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
            <label class="field"><span>Moyen de paiement</span>
              <select v-model="form.paymentMethod" class="input w-32">
                <option value="">—</option>
                <option v-for="m in settings?.paymentMethods || []" :key="m" :value="m">{{ m }}</option>
              </select>
            </label>
            <label v-if="showVers" class="field" :title="formCategoryType === 'depense' ? 'Provision : l\'argent part vers un de vos comptes' : 'Compte destination'"><span>Vers</span>
              <select v-model="form.toAccountId" class="input w-44">
                <option value="">{{ formCategoryType === 'depense' ? '— extérieur (quelqu\'un d\'autre)' : '— compte destination' }}</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </label>
          </template>
        </div>

        <div v-if="formCategoryType !== 'revenu'" class="flex flex-wrap gap-3 items-end">
          <label v-if="sharingOn && !form.isPot" class="checkbox"><input v-model="form.isShared" type="checkbox" /><span>Partagé ½</span><HelpTip text="Dépense commune avec le partenaire d'une cagnotte : elle entre dans le calcul de ce que vous vous devez." /></label>
          <select v-if="sharingOn && !form.isPot && form.isShared && pots.length > 1" v-model="form.potLineId" class="input w-40" title="Cagnotte concernée">
            <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.potPartnerName }}</option>
          </select>
          <label class="checkbox"><input v-model="form.isPot" type="checkbox" /><span>Cette ligne est une cagnotte</span><HelpTip wide text="Une cagnotte égalise des dépenses communes avec quelqu'un (loyer avec votre conjoint, vacances avec un ami). Vous indiquez ce que l'autre paie et votre part ; les lignes et entrées marquées ½ sont les vôtres. Le prévu de la cagnotte est calculé : ce que vous devez envoyer (ou recevoir). ☐ payé le jour du virement." /></label>
          <template v-if="form.isPot">
            <label class="field"><span>Partenaire</span><input v-model="form.potPartnerName" type="text" class="input w-28" placeholder="Prénom" /></label>
            <label class="field"><span>Il/elle paie (€/mois)</span><input v-model="form.potPartnerPaid" type="number" step="0.01" class="input w-24" placeholder="0" /></label>
            <label class="field"><span>Ma part (%)</span><input v-model="form.potMyShare" type="number" min="0" max="100" class="input w-16" /></label>
          </template>
        </div>
      </div>
      <template #footer>
        <button class="btn-primary" @click="submit">{{ modalAdding ? 'Ajouter' : 'Sauver' }}</button>
        <button class="btn-secondary" @click="closePanel">Annuler</button>
        <template v-if="!modalAdding && modalLine">
          <button v-if="currentMonth" class="link text-xs" title="Copie ou met à jour cette ligne dans le mois en cours (sauvez d'abord vos modifications)" @click="applyToCurrentMonth(modalLine)">Appliquer à {{ currentMonth.name }}</button>
          <button class="btn-danger ml-auto" @click="removeLineConfirm(modalLine)">Supprimer</button>
        </template>
      </template>
    </AppModal>

    <!-- ─── Aucune catégorie ─────────────────────────── -->
    <div v-if="!categories.length" class="text-center py-16 text-gray-400">
      <p class="mb-3">Créez d'abord vos catégories dans les Paramètres.</p>
      <router-link to="/parametres" class="btn-primary inline-block">Aller aux Paramètres</router-link>
    </div>

    <!-- ─── Catégories en 2 colonnes ─────────────────── -->
    <div v-else class="grid grid-cols-2 gap-4 items-start">
      <div v-for="column in [groupsLeft, groupsRight]" :key="column === groupsLeft ? 'L' : 'R'" class="flex flex-col gap-4">
        <div v-for="group in column" :key="group.category.id ?? 'none'" class="card p-0 overflow-hidden">

          <!-- En-tête catégorie -->
          <div class="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: group.category.color }" />
            <span class="font-semibold text-[13.5px]">{{ group.category.name }}</span>
            <span class="badge" :class="{
              'bg-red-50 text-red-600': group.category.type === 'depense',
              'bg-emerald-50 text-emerald-700': group.category.type === 'revenu',
              'bg-violet-50 text-violet-700': group.category.type === 'epargne',
              'bg-gray-100 text-gray-500': group.category.type === 'transfert',
            }">{{ { depense: 'dépense', revenu: 'revenu', epargne: 'épargne', transfert: 'transfert' }[group.category.type] }}</span>
            <span class="ml-auto text-[13px] font-semibold">{{ fmt(group.total) }}</span>
          </div>

          <!-- Lignes -->
          <div v-for="(line, i) in group.lines" :key="line.id">
            <div class="line-row" :class="{ 'line-row--pot': line.isPot }" @click="openEdit(line)">
              <span class="text-[13px] font-medium truncate">{{ line.label }}</span>
              <span v-if="line.recurringDay" class="badge bg-blue-50 text-blue-600" title="Jour du mois (date par défaut du « payé »)">le {{ line.recurringDay }}</span>
              <span v-if="line.intervalMonths > 1" class="badge bg-cyan-50 text-cyan-700" :title="'N\'apparaît que les mois du cycle · prochaine échéance ' + fmtDue(line.nextDue)">
                {{ line.intervalMonths === 12 ? 'annuel' : 'tous les ' + line.intervalMonths + ' mois' }} · {{ fmtDue(line.nextDue) }}
              </span>
              <span v-if="line.envelopeId" class="badge bg-violet-50 text-violet-700" title="Mensualisée : une enveloppe lisse la charge, le ☐ payé en sortira">mensualisée</span>
              <span v-if="line.isPot" class="badge bg-amber-50 text-amber-600" title="Cagnotte : le prévu est calculé chaque mois">cagnotte · {{ line.potPartnerName || '?' }} paie {{ fmt(line.potPartnerPaid) }}</span>
              <span v-if="sharingOn && line.isShared && !line.isPot" class="badge bg-amber-50 text-amber-600" :title="'Cagnotte : ' + (pots.find((p) => p.id === line.potLineId) || pots[0]).label">
                ½{{ pots.length > 1 ? ' ' + ((pots.find((p) => p.id === line.potLineId) || pots[0]).potPartnerName || '') : '' }}
              </span>
              <span v-if="themeById(line.themeId)" class="badge" :style="{ background: themeById(line.themeId).color + '22', color: themeById(line.themeId).color }">
                {{ themeById(line.themeId).name }}
              </span>
              <span class="ml-auto text-[13px] font-semibold shrink-0" :class="{ 'text-gray-400 font-normal text-[11px]': line.isPot }">{{ line.isPot ? 'calculé' : fmt(line.plannedAmount) }}</span>
              <span class="flex flex-col shrink-0" @click.stop>
                <button class="order-btn" :disabled="i === 0" @click="moveLine(group, i, -1)">▲</button>
                <button class="order-btn" :disabled="i === group.lines.length - 1" @click="moveLine(group, i, 1)">▼</button>
              </span>
            </div>

          </div>

          <p v-if="!group.lines.length" class="text-xs text-gray-400 px-4 py-2.5">Aucune ligne.</p>
          <button class="link text-xs px-4 py-2 block" @click="openAdd(group.category)">+ ligne</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/style.css";

.card { @apply bg-white rounded-xl border border-stone-200; }
.tile { @apply flex flex-col items-end; }
.tile-value { @apply text-[17px] font-bold tracking-tight; }
.tile-label { @apply text-[11px] text-gray-400 font-medium; }
.badge { @apply text-[10.5px] font-semibold px-1.5 py-px rounded-full shrink-0; }
.line-row { @apply flex items-center gap-1.5 px-4 py-2 border-b border-stone-50 cursor-pointer hover:bg-stone-50; }
.line-row--pot { @apply bg-amber-50/60 hover:bg-amber-50 border-l-2 border-l-amber-400; }
.edit-panel { @apply px-4 py-3 bg-stone-50 border-b border-stone-100; }
.field { @apply flex flex-col gap-1 text-[11px] font-medium text-gray-500; }
.input { @apply py-1.5 px-2 border border-stone-200 rounded-md text-[13px] text-gray-900 bg-white outline-none focus:border-violet-400; }
.checkbox { @apply flex items-center gap-1.5 text-[12.5px] text-gray-600 cursor-pointer; }
.btn-primary { @apply py-1.5 px-3 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-[12.5px] font-medium cursor-pointer; }
.btn-secondary { @apply py-1.5 px-3 bg-white border border-stone-200 hover:bg-stone-100 text-gray-600 rounded-md text-[12.5px] font-medium cursor-pointer; }
.btn-danger { @apply py-1.5 px-3 bg-white border border-red-200 hover:bg-red-50 text-red-500 rounded-md text-[12.5px] font-medium cursor-pointer; }
.order-btn { @apply text-[8px] leading-3 text-gray-300 hover:text-gray-600 cursor-pointer disabled:opacity-20 disabled:cursor-default; }
.link { @apply text-violet-600 hover:underline cursor-pointer; }
</style>
