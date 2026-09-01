<script setup>
import { ref, computed, onMounted } from 'vue'
import { getTemplateLines, createTemplateLine, updateTemplateLine, reorderTemplateLines, deleteTemplateLine, applyTemplateLineToMonth } from '@/api/template.js'
import { getCurrentMonth } from '@/api/months.js'
import { getCategories } from '@/api/categories.js'
import { getThemes } from '@/api/themes.js'
import { getAccounts } from '@/api/accounts.js'
import { getSettings } from '@/api/settings.js'
import AppModal from '@/components/AppModal.vue'

// ─── Data ────────────────────────────────────────────────
const lines = ref([])
const categories = ref([])
const themes = ref([])
const accounts = ref([])
const settings = ref(null)

const currentMonth = ref(null)   // mois ouvert du calendrier (cible de la propagation), ou null

async function load() {
  const [lRes, cRes, tRes, aRes, sRes, mRes] = await Promise.all([
    getTemplateLines(), getCategories(), getThemes(), getAccounts(), getSettings(), getCurrentMonth(),
  ])
  lines.value = lRes.data
  categories.value = cRes.data
  themes.value = tRes.data
  accounts.value = aRes.data
  settings.value = sRes.data
  currentMonth.value = mRes.data
}
onMounted(load)

// ─── Propagation vers le mois en cours ───────────────────
async function applyToCurrentMonth(line, { ask = true } = {}) {
  if (!currentMonth.value) return
  if (ask && !confirm(`Appliquer « ${line.label} » à ${currentMonth.value.name} ? (le réel du mois n'est pas touché)`)) return
  try {
    await applyTemplateLineToMonth(line.id, currentMonth.value.id)
  } catch (e) { apiError(e) }
}

function apiError(e) {
  alert(e.response?.data?.message || e.message)
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
  }
}

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
  }
}

async function submit() {
  if (!form.value.label.trim()) return
  try {
    if (typeof openLineId.value === 'string') {
      const { data: created } = await createTemplateLine(formData())
      // Nouvelle ligne : proposer de l'ajouter aussi au mois en cours (sinon elle n'apparaît qu'au prochain mois)
      if (currentMonth.value && confirm(`Ligne ajoutée au template. L'ajouter aussi à ${currentMonth.value.name} ?`)) {
        await applyToCurrentMonth(created, { ask: false })
      }
    } else {
      await updateTemplateLine(openLineId.value, formData())
    }
    closePanel()
    lines.value = (await getTemplateLines()).data
  } catch (e) { apiError(e) }
}

async function removeLineConfirm(line) {
  if (!confirm(`Supprimer la ligne « ${line.label} » du template ?`)) return
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
        <p class="text-[13px] text-gray-400 mt-0.5">La base dupliquée à chaque nouveau mois</p>
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
          <label v-if="!form.isPot" class="field"><span>Prévu (€)</span><input v-model="form.plannedAmount" type="number" step="0.01" class="input w-24" @keyup.enter="submit" /></label>
          <label class="field" :title="form.isPot ? 'Jour où vous réglez la cagnotte' : 'Date par défaut quand vous cochez « payé » dans le mois'"><span>Jour du mois</span><input v-model="form.recurringDay" type="number" min="1" max="31" class="input w-20" placeholder="—" /></label>
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

        <div class="flex flex-wrap gap-3 items-end">
          <label v-if="formCategoryType === 'revenu'" class="field"><span>Compte crédité</span>
            <select v-model="form.toAccountId" class="input w-40">
              <option value="">—</option>
              <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>
          <template v-else>
            <label class="field"><span>Depuis</span>
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
          <label v-if="sharingOn && !form.isPot" class="checkbox" title="Dépense commune (rattachée à une cagnotte)"><input v-model="form.isShared" type="checkbox" /><span>Partagé ½</span></label>
          <select v-if="sharingOn && !form.isPot && form.isShared && pots.length > 1" v-model="form.potLineId" class="input w-40" title="Cagnotte concernée">
            <option v-for="p in pots" :key="p.id" :value="p.id">{{ p.label }} · {{ p.potPartnerName }}</option>
          </select>
          <label class="checkbox" title="Partage avec quelqu'un : le prévu de la ligne est calculé chaque mois à partir des ½"><input v-model="form.isPot" type="checkbox" /><span>Cette ligne est une cagnotte</span></label>
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
