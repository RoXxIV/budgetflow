<script setup>
import { ref, computed, onMounted } from 'vue'
import { getSettings, updateSettings } from '@/api/settings.js'
import { getCategories, createCategory, updateCategory, reorderCategories, deleteCategory } from '@/api/categories.js'
import { getThemes, createTheme, updateTheme, deleteTheme, mergeTheme } from '@/api/themes.js'
import { getTemplateLines } from '@/api/template.js'
import { getCalculators, createCalculator, updateCalculator, deleteCalculator, checkFormula } from '@/api/calculators.js'
import AppModal from '@/components/AppModal.vue'
import { confirmDialog, apiError, toast } from '@/composables/useDialog.js'
import { eur } from '@/lib/format.js'

// Autofocus des champs d'édition en place (curseur en fin de texte)
const vFocus = {
  mounted: (el) => { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length) } catch { /* type number */ } },
}

// ─── Data ────────────────────────────────────────────────
const settings = ref(null)
const categories = ref([])
const themes = ref([])
const templateLines = ref([])
const calculators = ref([])

async function load() {
  const [setRes, catRes, themeRes, tlRes, calcRes] = await Promise.all([
    getSettings(), getCategories(), getThemes(), getTemplateLines(), getCalculators(),
  ])
  settings.value = setRes.data
  categories.value = catRes.data
  themes.value = themeRes.data
  templateLines.value = tlRes.data
  calculators.value = calcRes.data
}
onMounted(load)

const fmt = eur
// Première lettre en majuscule à la saisie (les sigles courts restent tels quels)
const capFirst = (s) => (s.length <= 3 && s === s.toUpperCase() ? s : s.charAt(0).toUpperCase() + s.slice(1))

// ─── Un seul modèle d'enregistrement : au blur, indicateur « Enregistré » 2 s ───
const savedIn = ref('')
let savedTimer = null
function flashSaved(panel) {
  savedIn.value = panel
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => { savedIn.value = '' }, 2000)
}

// ─── Édition en place : une ligne se lit comme du texte, devient un champ au clic ───
const edit = ref({ key: null, val: '' })
function startEdit(key, val) { edit.value = { key, val: String(val ?? '') } }
function cancelEdit() { edit.value = { key: null, val: '' } }

// ─── Menus ⋯ ─────────────────────────────────────────────
const menuKey = ref(null)

// ─── Général ─────────────────────────────────────────────
const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']
const currencyOptions = computed(() => {
  const c = settings.value?.currency
  return c && !CURRENCIES.includes(c) ? [c, ...CURRENCIES] : CURRENCIES
})
async function saveGeneral(patch) {
  try {
    settings.value = (await updateSettings(patch)).data
    flashSaved('general')
  } catch (e) { apiError(e); settings.value = (await getSettings()).data }
}
async function commitRate() {
  if (edit.value.key !== 'rate') return
  const v = Math.min(100, Math.max(0, parseFloat(String(edit.value.val).replace(',', '.')) || 0))
  cancelEdit()
  if (v !== settings.value.savingRate) await saveGeneral({ savingRate: v })
}
// « 40 % de 2 418,00 € = 967,20 € par mois » — sur les revenus prévus du template
const revenusPrevus = computed(() => {
  const revCats = new Set(categories.value.filter((c) => c.type === 'revenu').map((c) => c.id))
  return templateLines.value.reduce((s, l) => s + (revCats.has(l.categoryId) ? (l.plannedAmount || 0) : 0), 0)
})
const savingsPhrase = computed(() => {
  const rate = settings.value?.savingRate || 0
  if (!rate || !revenusPrevus.value) return ''
  return `${rate} % de ${fmt(revenusPrevus.value)} = ${fmt(Math.round(revenusPrevus.value * rate) / 100)} par mois.`
})

const newPaymentMethod = ref('')
async function addPaymentMethod() {
  const v = capFirst(newPaymentMethod.value.trim())
  if (!v || settings.value.paymentMethods.includes(v)) return
  newPaymentMethod.value = ''
  await saveGeneral({ paymentMethods: [...settings.value.paymentMethods, v] })
}
async function removePaymentMethod(m) {
  await saveGeneral({ paymentMethods: settings.value.paymentMethods.filter((x) => x !== m) })
}
const newInvestmentType = ref('')
async function addInvestmentType() {
  const v = capFirst(newInvestmentType.value.trim())
  if (!v || settings.value.investmentTypes.includes(v)) return
  newInvestmentType.value = ''
  await saveGeneral({ investmentTypes: [...settings.value.investmentTypes, v] })
}
async function removeInvestmentType(t) {
  await saveGeneral({ investmentTypes: settings.value.investmentTypes.filter((x) => x !== t) })
}

// ─── Catégories ──────────────────────────────────────────
const CATEGORY_TYPES = [
  { value: 'depense', label: 'Dépense' },
  { value: 'revenu', label: 'Revenu' },
  { value: 'epargne', label: 'Épargne' },
  { value: 'transfert', label: 'Transfert' },
]
const TYPE_HINTS = {
  depense: 'comptée dans les dépenses et les stats',
  revenu: 'comptée dans les revenus du mois',
  epargne: 'comptée dans « mis de côté », pas dans les dépenses',
  transfert: 'bouge les soldes, exclue des stats de dépenses',
}
// Palette fermée : les 12 seules couleurs possibles (mêmes valeurs que --cat-1..12)
const PALETTE = [
  '#3B6EA5', '#4B8A6E', '#C97B2C', '#A05270',
  '#6E7A88', '#B04A3F', '#7C6BB0', '#2F8C8C',
  '#8C7A3F', '#5A7D3F', '#96566B', '#55606B',
]
const nextColor = () => PALETTE.find((p) => !categories.value.some((c) => c.color === p)) || PALETTE[categories.value.length % 12]
const colorPickerFor = ref(null) // id de la catégorie dont la palette est ouverte ('new' pour l'ajout)

const newCategory = ref({ name: '', type: 'depense', color: null })
async function addCategory() {
  const name = capFirst(newCategory.value.name.trim())
  if (!name) return
  try {
    await createCategory({ name, type: newCategory.value.type, color: newCategory.value.color || nextColor() })
    newCategory.value = { name: '', type: 'depense', color: null }
    categories.value = (await getCategories()).data
    flashSaved('categories')
  } catch (e) { apiError(e) }
}
async function commitCatName(category) {
  if (edit.value.key !== 'cat' + category.id) return
  const name = edit.value.val.trim()
  cancelEdit()
  if (!name || name === category.name) return
  try {
    await updateCategory(category.id, { name })
    categories.value = (await getCategories()).data
    flashSaved('categories')
  } catch (e) { apiError(e); categories.value = (await getCategories()).data }
}
async function setCatType(category) {
  try { await updateCategory(category.id, { type: category.type }); flashSaved('categories') }
  catch (e) { apiError(e); categories.value = (await getCategories()).data }
}
async function setCatColor(category, color) {
  colorPickerFor.value = null
  if (color === category.color) return
  try {
    await updateCategory(category.id, { color })
    categories.value = (await getCategories()).data
    flashSaved('categories')
  } catch (e) { apiError(e) }
}

const catUsage = (c) => (c.templateLines || 0) + (c.monthLines || 0)
async function removeCategoryConfirm(category) {
  const used = catUsage(category)
  const ok = await confirmDialog({
    title: 'Supprimer la catégorie',
    message: used
      ? `Supprimer « ${category.name} » ?\n${category.templateLines} ligne(s) du template et ${category.monthLines} ligne(s) de mois y sont rattachées : elles passeront en « Sans catégorie ».`
      : `Supprimer « ${category.name} » ? Elle n'est utilisée nulle part.`,
    confirmLabel: 'Supprimer la catégorie', danger: true,
  })
  if (!ok) return
  try {
    await deleteCategory(category.id, used > 0)
    categories.value = (await getCategories()).data
  } catch (e) { apiError(e) }
}

// Réordonnancement : poignée de glissement + Alt+↑/↓ au clavier (annoncé en aria-live)
const ariaMsg = ref('')
const dragId = ref(null)      // catégorie en cours de glissement
const dragArmed = ref(null)   // poignée pressée : la ligne devient draggable
function onDragStart(category) { dragId.value = category.id }
function onDragOver(category) {
  if (dragId.value === null || dragId.value === category.id) return
  const list = [...categories.value]
  const from = list.findIndex((c) => c.id === dragId.value)
  const to = list.findIndex((c) => c.id === category.id)
  list.splice(to, 0, list.splice(from, 1)[0])
  categories.value = list
}
async function onDragEnd() {
  dragId.value = null
  dragArmed.value = null
  try { await reorderCategories(categories.value.map((c, i) => ({ id: c.id, order: i }))); flashSaved('categories') }
  catch (e) { apiError(e); categories.value = (await getCategories()).data }
}
async function moveCategory(index, delta) {
  const target = index + delta
  if (target < 0 || target >= categories.value.length) return
  const list = [...categories.value]
  ;[list[index], list[target]] = [list[target], list[index]]
  categories.value = list
  ariaMsg.value = `« ${list[target].name} » déplacée en position ${target + 1} sur ${list.length}`
  try { await reorderCategories(list.map((c, i) => ({ id: c.id, order: i }))); flashSaved('categories') }
  catch (e) { apiError(e) }
}

// Presets proposés quand la liste est vide (couleurs prises dans la palette fermée)
const PRESETS = [
  { name: 'Factures', type: 'depense', color: '#3B6EA5' },
  { name: 'Abonnements', type: 'depense', color: '#7C6BB0' },
  { name: 'Courses & quotidien', type: 'depense', color: '#4B8A6E' },
  { name: 'Loisirs', type: 'depense', color: '#C97B2C' },
  { name: 'Revenus', type: 'revenu', color: '#5A7D3F' },
  { name: 'Épargne', type: 'epargne', color: '#2F8C8C' },
  { name: 'Virements', type: 'transfert', color: '#6E7A88' },
]
async function applyPresets() {
  try {
    for (const p of PRESETS) await createCategory(p)
    categories.value = (await getCategories()).data
  } catch (e) { apiError(e) }
}

// ─── Thèmes : plus de couleur stockée à la saisie, recherche, tri, fusion via menu ───
const themeSearch = ref('')
const themeSort = ref('alpha') // 'alpha' | 'usage'
const themeUsage = (t) => (t.lines || 0) + (t.entries || 0)
const sortedThemes = computed(() => {
  const q = themeSearch.value.trim().toLowerCase()
  const list = themes.value.filter((t) => !q || t.name.toLowerCase().includes(q))
  return themeSort.value === 'usage'
    ? [...list].sort((a, b) => themeUsage(a) - themeUsage(b) || a.name.localeCompare(b.name, 'fr'))
    : list
})
const newTheme = ref('')
async function addTheme() {
  const name = capFirst(newTheme.value.trim())
  if (!name) return
  try {
    await createTheme({ name })
    newTheme.value = ''
    themes.value = (await getThemes()).data
    flashSaved('themes')
  } catch (e) { apiError(e) }
}
async function commitThemeName(theme) {
  if (edit.value.key !== 'theme' + theme.id) return
  const name = edit.value.val.trim()
  cancelEdit()
  if (!name || name === theme.name) return
  try {
    await updateTheme(theme.id, { name })
    themes.value = (await getThemes()).data
    flashSaved('themes')
  } catch (e) { apiError(e); themes.value = (await getThemes()).data }
}
async function removeThemeConfirm(theme) {
  const used = themeUsage(theme)
  const ok = await confirmDialog({
    title: 'Supprimer le thème',
    message: used
      ? `Supprimer « ${theme.name} » ?\n${theme.lines} ligne(s) et ${theme.entries} entrée(s) y sont rattachées : elles passeront en « sans thème ». Pour garder l'historique, préférez la fusion dans un autre thème.`
      : `Supprimer « ${theme.name} » ? Il n'est utilisé nulle part.`,
    confirmLabel: used ? 'Supprimer quand même' : 'Supprimer', danger: true,
  })
  if (!ok) return
  try {
    await deleteTheme(theme.id, used > 0)
    themes.value = (await getThemes()).data
  } catch (e) { apiError(e) }
}
// Fusion (l'ancien select anonyme, désormais nommée et confirmée)
const mergeFor = ref(null)     // thème source
const mergeTargetId = ref('')
function openMerge(theme) {
  mergeFor.value = theme
  mergeTargetId.value = ''
}
async function confirmMerge() {
  if (!mergeFor.value || !mergeTargetId.value) return
  try {
    const { data } = await mergeTheme(mergeFor.value.id, mergeTargetId.value)
    toast(data.message, 'success')
    mergeFor.value = null
    themes.value = (await getThemes()).data
  } catch (e) { apiError(e) }
}

// ─── Calculateurs ────────────────────────────────────────
const calcForm = ref(null)      // éditeur ouvert (null = fermé)
const calcCheck = ref(null)     // résultat du test de formule { ok, value | error }
let calcCheckTimer = null

function emptyCalculator() {
  return { id: null, name: '', formula: '', lineId: '', themeId: '', params: [], readings: [] }
}
// Preset : pas un module EDF en dur, juste un exemple pré-rempli que l'utilisateur adapte
function exampleCalculator() {
  return {
    id: null,
    name: 'Électricité',
    formula: '(hp × prixHP + hc × prixHC) × (1 + tva / 100) + abo',
    lineId: '',
    themeId: '',
    params: [
      { symbol: 'prixHP', label: 'Prix heure pleine', value: 0.27, unit: '€/kWh' },
      { symbol: 'prixHC', label: 'Prix heure creuse', value: 0.20, unit: '€/kWh' },
      { symbol: 'abo', label: 'Abonnement', value: 12.5, unit: '€' },
      { symbol: 'tva', label: 'TVA', value: 20, unit: '%' },
    ],
    readings: [
      { symbol: 'hp', label: 'Heures pleines', kind: 'index', unit: 'kWh' },
      { symbol: 'hc', label: 'Heures creuses', kind: 'index', unit: 'kWh' },
    ],
  }
}
function openCalculator(calc) {
  calcForm.value = calc ? JSON.parse(JSON.stringify({ ...calc, lineId: calc.lineId || '', themeId: calc.themeId || '' })) : emptyCalculator()
  calcCheck.value = null
  scheduleCheck()
}
function openExample() {
  calcForm.value = exampleCalculator()
  calcCheck.value = null
  scheduleCheck()
}
function closeCalculator() { calcForm.value = null }

function addParam() { calcForm.value.params.push({ symbol: '', label: '', value: 0, unit: '' }) }
function addReading() { calcForm.value.readings.push({ symbol: '', label: '', kind: 'index', unit: '' }) }

const calcSymbols = computed(() => {
  if (!calcForm.value) return []
  return [
    ...calcForm.value.params.map((p) => ({ symbol: p.symbol, value: p.value, kind: 'param' })),
    ...calcForm.value.readings.map((r) => ({ symbol: r.symbol, value: 1, kind: r.kind })),
  ].filter((s) => s.symbol)
})
function insertSymbol(symbol) {
  const f = calcForm.value
  f.formula = (f.formula || '').trimEnd() + (f.formula ? ' ' : '') + symbol + ' '
  scheduleCheck()
}
function scheduleCheck() {
  clearTimeout(calcCheckTimer)
  calcCheckTimer = setTimeout(async () => {
    if (!calcForm.value) return
    if (!calcForm.value.formula.trim()) { calcCheck.value = null; return }
    try {
      calcCheck.value = (await checkFormula(calcForm.value.formula, calcSymbols.value)).data
    } catch (e) { calcCheck.value = { ok: false, error: e.message } }
  }, 300)
}
async function saveCalculator() {
  const f = calcForm.value
  if (!f.name.trim()) return
  const data = {
    name: f.name,
    formula: f.formula,
    lineId: f.lineId || null,
    themeId: f.themeId || null,
    params: f.params.filter((p) => p.symbol.trim()).map((p) => ({ ...p, symbol: p.symbol.trim(), value: Number(p.value) || 0 })),
    readings: f.readings.filter((r) => r.symbol.trim()).map((r) => ({ ...r, symbol: r.symbol.trim() })),
  }
  try {
    if (f.id) await updateCalculator(f.id, data)
    else await createCalculator(data)
    calculators.value = (await getCalculators()).data
    calcForm.value = null
    flashSaved('calculators')
  } catch (e) { apiError(e) }
}
async function removeCalculatorConfirm(calc) {
  const ok = await confirmDialog({ title: 'Supprimer le calculateur', message: `« ${calc.name} » et tous ses relevés mensuels seront supprimés. Les régularisations déjà posées dans les mois restent.`, confirmLabel: 'Supprimer', danger: true })
  if (!ok) return
  try {
    await deleteCalculator(calc.id)
    calculators.value = (await getCalculators()).data
    if (calcForm.value?.id === calc.id) calcForm.value = null
  } catch (e) { apiError(e) }
}
const templateLineLabel = (id) => templateLines.value.find((l) => l.id === id)?.label || null
</script>

<template>
  <div v-if="settings" @click="menuKey = null; colorPickerFor = null">
    <div class="sr-only" aria-live="polite">{{ ariaMsg }}</div>

    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="mb-6">
      <h1 class="text-[22px] font-semibold">Paramètres</h1>
      <p class="page-sub">Catégories, thèmes et réglages généraux</p>
    </div>

    <!-- ─── Général — §7 : le bloc fondamental passe en premier ── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Général</h2>
        <span v-if="savedIn === 'general'" class="saved-note">Enregistré</span>
      </div>
      <div class="gen-grid">
        <label class="field">
          <span>Devise</span>
          <span class="select-wrap">
            <select :value="settings.currency" class="select w-24" @change="saveGeneral({ currency: $event.target.value })">
              <option v-for="c in currencyOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </span>
        </label>
        <div class="field">
          <span>Objectif d'épargne <span class="meta">(% du revenu du mois)</span></span>
          <button v-if="edit.key !== 'rate'" class="edit-text num" @click.stop="startEdit('rate', settings.savingRate)">{{ settings.savingRate }} %</button>
          <span v-else class="rate-edit">
            <input v-focus v-model="edit.val" type="text" inputmode="decimal" class="input w-16 num text-right" @click.stop @blur="commitRate" @keyup.enter="$event.target.blur()" @keydown.esc="cancelEdit" />
            <span class="rate-suffix">%</span>
          </span>
          <span v-if="savingsPhrase" class="meta text-[12px]">{{ savingsPhrase }}</span>
        </div>
      </div>
      <div class="gen-block">
        <p class="gen-label">Moyens de paiement</p>
        <div class="chips">
          <span v-for="m in settings.paymentMethods" :key="m" class="tag tag-neutral">
            {{ m }}
            <button class="tag-x" :title="'Retirer ' + m" @click="removePaymentMethod(m)">×</button>
          </span>
          <input v-model="newPaymentMethod" type="text" class="input w-32" placeholder="Ajouter…" @keyup.enter="addPaymentMethod" />
        </div>
      </div>
      <div class="gen-block">
        <p class="gen-label">Types d'investissement</p>
        <div class="chips">
          <span v-for="t in settings.investmentTypes" :key="t" class="tag tag-neutral">
            {{ t }}
            <button class="tag-x" :title="'Retirer ' + t" @click="removeInvestmentType(t)">×</button>
          </span>
          <input v-model="newInvestmentType" type="text" class="input w-32" placeholder="Ajouter…" @keyup.enter="addInvestmentType" />
        </div>
      </div>
    </div>

    <!-- ─── Catégories — §4 ─────────────────────────── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Catégories <span class="panel-count num">{{ categories.length }}</span></h2>
        <span v-if="savedIn === 'categories'" class="saved-note">Enregistré</span>
      </div>
      <p class="panel-sub">Les blocs de votre mois. Leur type pilote les calculs.</p>

      <div v-if="!categories.length" class="empty-block">
        <p class="mb-3">Aucune catégorie pour l'instant.</p>
        <button class="btn-primary" @click="applyPresets">Partir d'un jeu de base</button>
        <p class="meta text-[11.5px] mt-2">Factures, Abonnements, Courses… — renommez ou supprimez ensuite.</p>
      </div>

      <div v-for="(category, i) in categories" :key="category.id"
        class="cat-grid cat-row" tabindex="0"
        :class="{ 'is-dragging': dragId === category.id }"
        :draggable="dragArmed === category.id"
        @dragstart="onDragStart(category)" @dragover.prevent="onDragOver(category)" @dragend="onDragEnd" @drop.prevent
        @keydown.alt.up.prevent="moveCategory(i, -1)" @keydown.alt.down.prevent="moveCategory(i, 1)">
        <span class="drag-handle" title="Glisser pour réordonner (ou Alt + ↑/↓)" @mousedown="dragArmed = category.id" @mouseup="dragArmed = null">⠿</span>
        <span class="swatch-wrap" @click.stop>
          <button class="swatch" :style="{ background: category.color }" :title="'Couleur de « ' + category.name + ' »'" @click="colorPickerFor = colorPickerFor === category.id ? null : category.id" />
          <div v-if="colorPickerFor === category.id" class="palette">
            <button v-for="p in PALETTE" :key="p" class="swatch" :class="{ 'is-current': p === category.color }" :style="{ background: p }" @click="setCatColor(category, p)" />
          </div>
        </span>
        <span class="cell-name">
          <button v-if="edit.key !== 'cat' + category.id" class="edit-text" @click.stop="startEdit('cat' + category.id, category.name)">{{ category.name }}</button>
          <input v-else v-focus v-model="edit.val" type="text" class="input edit-input" @click.stop
            @blur="commitCatName(category)" @keyup.enter="$event.target.blur()" @keydown.esc="cancelEdit" />
        </span>
        <span class="select-wrap" @click.stop>
          <select v-model="category.type" class="select w-full" :title="'Leur type pilote les calculs — ' + TYPE_HINTS[category.type]" @change="setCatType(category)">
            <option v-for="t in CATEGORY_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </span>
        <span class="cell-usage" :class="{ 'is-warn': !catUsage(category) }" :title="category.templateLines + ' ligne(s) du template · ' + category.monthLines + ' ligne(s) de mois'">
          {{ catUsage(category) ? 'utilisée par ' + catUsage(category) + ' ligne' + (catUsage(category) > 1 ? 's' : '') : 'inutilisée' }}
        </span>
        <span class="cell-actions" @click.stop>
          <span class="menu-wrap">
            <button class="btn-icon" title="Actions" @click="menuKey = menuKey === 'cat' + category.id ? null : 'cat' + category.id">⋯</button>
            <div v-if="menuKey === 'cat' + category.id" class="menu">
              <button class="menu-item" :disabled="i === 0" @click="menuKey = null; moveCategory(i, -1)">Monter</button>
              <button class="menu-item" :disabled="i === categories.length - 1" @click="menuKey = null; moveCategory(i, 1)">Descendre</button>
              <div class="menu-sep" />
              <button class="menu-item is-danger" @click="menuKey = null; removeCategoryConfirm(category)">Supprimer</button>
            </div>
          </span>
        </span>
      </div>

      <!-- Ligne d'ajout : même grille que les autres -->
      <div class="cat-grid cat-add">
        <span></span>
        <span class="swatch-wrap" @click.stop>
          <button class="swatch" :style="{ background: newCategory.color || nextColor() }" title="Couleur" @click="colorPickerFor = colorPickerFor === 'new' ? null : 'new'" />
          <div v-if="colorPickerFor === 'new'" class="palette">
            <button v-for="p in PALETTE" :key="p" class="swatch" :class="{ 'is-current': p === (newCategory.color || nextColor()) }" :style="{ background: p }" @click="newCategory.color = p; colorPickerFor = null" />
          </div>
        </span>
        <input v-model="newCategory.name" type="text" class="input" placeholder="Nouvelle catégorie" @keyup.enter="addCategory" />
        <span class="select-wrap">
          <select v-model="newCategory.type" class="select w-full" :title="TYPE_HINTS[newCategory.type]">
            <option v-for="t in CATEGORY_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </span>
        <span class="cell-usage"></span>
        <span class="cell-actions"><button class="btn-secondary" @click="addCategory">Ajouter</button></span>
      </div>
    </div>

    <!-- ─── Thèmes — §5 : grille compacte, recherche, plus de couleur ── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Thèmes <span class="panel-count num">{{ themes.length }}</span></h2>
        <div class="panel-tools">
          <span v-if="savedIn === 'themes'" class="saved-note">Enregistré</span>
          <span class="view-tabs">
            <button class="view-tab" :class="{ 'is-active': themeSort === 'alpha' }" @click="themeSort = 'alpha'">A–Z</button>
            <button class="view-tab" :class="{ 'is-active': themeSort === 'usage' }" title="Les moins utilisés d'abord, pour faire le ménage" @click="themeSort = 'usage'">par usage</button>
          </span>
          <input v-model="themeSearch" type="text" class="input w-44" placeholder="Rechercher un thème…" />
        </div>
      </div>
      <p class="panel-sub">Étiquettes d'analyse facultatives, modifiables sur chaque entrée.</p>

      <div v-if="themes.length" class="themes-grid">
        <div v-for="theme in sortedThemes" :key="theme.id" class="theme-item">
          <span class="cell-name">
            <button v-if="edit.key !== 'theme' + theme.id" class="edit-text" @click.stop="startEdit('theme' + theme.id, theme.name)">{{ theme.name }}</button>
            <input v-else v-focus v-model="edit.val" type="text" class="input edit-input" @click.stop
              @blur="commitThemeName(theme)" @keyup.enter="$event.target.blur()" @keydown.esc="cancelEdit" />
          </span>
          <span class="cell-usage" :class="{ 'is-warn': !themeUsage(theme) }" :title="(theme.lines || 0) + ' ligne(s) · ' + (theme.entries || 0) + ' entrée(s)'">
            {{ themeUsage(theme) ? themeUsage(theme) : 'inutilisé' }}
          </span>
          <span class="cell-actions" @click.stop>
            <span class="menu-wrap">
              <button class="btn-icon" title="Actions" @click="menuKey = menuKey === 'theme' + theme.id ? null : 'theme' + theme.id">⋯</button>
              <div v-if="menuKey === 'theme' + theme.id" class="menu">
                <button v-if="themes.length > 1" class="menu-item" @click="menuKey = null; openMerge(theme)">Fusionner dans un autre thème…</button>
                <div v-if="themes.length > 1" class="menu-sep" />
                <button class="menu-item is-danger" @click="menuKey = null; removeThemeConfirm(theme)">Supprimer</button>
              </div>
            </span>
          </span>
        </div>
      </div>
      <p v-else class="empty-line">Aucun thème — l'app fonctionne aussi sans (le champ n'apparaîtra pas à la saisie).</p>

      <div class="theme-add">
        <input v-model="newTheme" type="text" class="input w-72" placeholder="Nouveau thème (IA, Restaurants…)" @keyup.enter="addTheme" />
        <button class="btn-secondary" @click="addTheme">Ajouter</button>
      </div>
    </div>

    <!-- ─── Fusion de thèmes ─────────────────────────── -->
    <AppModal :open="!!mergeFor" title="Fusionner deux thèmes" @close="mergeFor = null">
      <div v-if="mergeFor" class="flex flex-col gap-3 text-[13px]">
        <p>
          Toutes les lignes et entrées de « <b>{{ mergeFor.name }}</b> »
          ({{ mergeFor.lines || 0 }} ligne{{ (mergeFor.lines || 0) > 1 ? 's' : '' }}, {{ mergeFor.entries || 0 }} entrée{{ (mergeFor.entries || 0) > 1 ? 's' : '' }})
          passeront sur le thème choisi, puis « {{ mergeFor.name }} » sera supprimé.
        </p>
        <label class="field"><span>Fusionner dans</span>
          <span class="select-wrap">
            <select v-model="mergeTargetId" class="select w-56">
              <option value="">— choisir un thème</option>
              <option v-for="t in themes.filter((x) => x.id !== mergeFor.id)" :key="t.id" :value="t.id">{{ t.name }}</option>
            </select>
          </span>
        </label>
      </div>
      <template #footer>
        <button class="btn-primary" :disabled="!mergeTargetId" @click="confirmMerge">Fusionner</button>
        <button class="btn-secondary" @click="mergeFor = null">Annuler</button>
      </template>
    </AppModal>

    <!-- ─── Calculateurs — §8 ───────────────────────── -->
    <div class="panel set-panel">
      <div class="panel-head">
        <h2 class="panel-title">Calculateurs <span class="panel-count num">{{ calculators.length }}</span></h2>
        <div class="panel-tools">
          <span v-if="savedIn === 'calculators'" class="saved-note">Enregistré</span>
          <span class="menu-wrap" @click.stop>
            <button class="btn-primary" @click="menuKey = menuKey === 'add-calc' ? null : 'add-calc'">Ajouter un calculateur</button>
            <div v-if="menuKey === 'add-calc'" class="menu">
              <button class="menu-item" @click="menuKey = null; openCalculator(null)">Créer un calculateur</button>
              <button class="menu-item" @click="menuKey = null; openExample()">Partir de l'exemple électricité HP/HC</button>
            </div>
          </span>
        </div>
      </div>
      <p class="panel-sub">Un calculateur estime une facture à partir de relevés saisis chaque mois.</p>

      <div v-for="calc in calculators" :key="calc.id" class="calc-row">
        <div class="calc-main">
          <span class="calc-name">{{ calc.name }}</span>
          <code class="calc-formula">{{ calc.formula || '—' }}</code>
          <span v-if="calc.lineId" class="meta text-[12px]">rattaché à {{ templateLineLabel(calc.lineId) || 'une ligne supprimée' }}</span>
          <span class="cell-actions" @click.stop>
            <span class="menu-wrap">
              <button class="btn-icon" title="Actions" @click="menuKey = menuKey === 'calc' + calc.id ? null : 'calc' + calc.id">⋯</button>
              <div v-if="menuKey === 'calc' + calc.id" class="menu">
                <button class="menu-item" @click="menuKey = null; openCalculator(calc)">Modifier</button>
                <div class="menu-sep" />
                <button class="menu-item is-danger" @click="menuKey = null; removeCalculatorConfirm(calc)">Supprimer</button>
              </div>
            </span>
          </span>
        </div>
        <p class="calc-meta meta">{{ (calc.params || []).length }} paramètre{{ (calc.params || []).length > 1 ? 's' : '' }} · {{ (calc.readings || []).length }} relevé{{ (calc.readings || []).length > 1 ? 's' : '' }} mensuel{{ (calc.readings || []).length > 1 ? 's' : '' }}</p>
      </div>
      <p v-if="!calculators.length && !calcForm" class="empty-line">Aucun calculateur.</p>

      <!-- Éditeur : c'est ici que vivent les détails (paramètres, relevés, formule) -->
      <div v-if="calcForm" class="calc-editor" @click.stop>
        <div class="flex flex-wrap gap-4 items-end">
          <label class="field"><span>Nom</span><input v-model="calcForm.name" type="text" class="input w-44" placeholder="Électricité, Eau, Essence…" /></label>
          <label class="field">
            <span>Ligne du template (mensualité)</span>
            <span class="select-wrap">
              <select v-model="calcForm.lineId" class="select w-48">
                <option value="">— aucune (estimation seule)</option>
                <option v-for="l in templateLines" :key="l.id" :value="l.id">{{ l.label }}</option>
              </select>
            </span>
          </label>
          <label v-if="themes.length" class="field">
            <span>Thème de la régularisation</span>
            <span class="select-wrap">
              <select v-model="calcForm.themeId" class="select w-44">
                <option value="">— celui de la ligne</option>
                <option v-for="t in themes" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
            </span>
          </label>
        </div>

        <div class="editor-cols">
          <div>
            <p class="editor-title">Paramètres <span class="meta">— constants d'un mois à l'autre</span></p>
            <div v-for="(p, i) in calcForm.params" :key="'p' + i" class="editor-row">
              <input v-model="p.symbol" type="text" class="input mono w-24" placeholder="symbole" @input="scheduleCheck" />
              <input v-model="p.label" type="text" class="input flex-1" placeholder="Libellé" />
              <input v-model="p.value" type="number" step="any" class="input w-20 num" @input="scheduleCheck" />
              <input v-model="p.unit" type="text" class="input w-16" placeholder="unité" />
              <button class="btn-icon is-danger" @click="calcForm.params.splice(i, 1); scheduleCheck()">×</button>
            </div>
            <button class="btn-discret" @click="addParam">+ paramètre</button>
          </div>
          <div>
            <p class="editor-title">Relevés <span class="meta">— saisis chaque mois</span></p>
            <div v-for="(r, i) in calcForm.readings" :key="'r' + i" class="editor-row">
              <input v-model="r.symbol" type="text" class="input mono w-24" placeholder="symbole" @input="scheduleCheck" />
              <input v-model="r.label" type="text" class="input flex-1" placeholder="Libellé" />
              <span class="select-wrap">
                <select v-model="r.kind" class="select w-24" title="index : la valeur du mois = index de fin − index de début (report automatique)">
                  <option value="index">index</option>
                  <option value="valeur">valeur</option>
                </select>
              </span>
              <input v-model="r.unit" type="text" class="input w-16" placeholder="unité" />
              <button class="btn-icon is-danger" @click="calcForm.readings.splice(i, 1); scheduleCheck()">×</button>
            </div>
            <button class="btn-discret" @click="addReading">+ relevé</button>
          </div>
        </div>

        <div>
          <p class="editor-title">Formule <span class="meta">— + − × ÷ et parenthèses sur les symboles ci-dessus</span></p>
          <div class="flex flex-wrap gap-1 mb-1.5">
            <button v-for="s in calcSymbols" :key="s.symbol" class="tag tag-neutral mono cursor-pointer" @click="insertSymbol(s.symbol)">{{ s.symbol }}</button>
          </div>
          <input v-model="calcForm.formula" type="text" class="input mono w-full" placeholder="(hp × prixHP + hc × prixHC) × (1 + tva / 100) + abo" @input="scheduleCheck" />
          <p v-if="calcCheck" class="text-[12px] mt-1" :class="calcCheck.ok ? 'is-credit' : 'is-over'">
            {{ calcCheck.ok ? '✓ Formule valide' + (calcCheck.value != null ? ' — avec les paramètres actuels et 1 par relevé : ' + calcCheck.value.toFixed(2) : '') : '✗ ' + calcCheck.error }}
          </p>
        </div>

        <div class="flex gap-2">
          <button class="btn-primary" @click="saveCalculator">{{ calcForm.id ? 'Sauver' : 'Créer' }}</button>
          <button class="btn-secondary" @click="closeCalculator">Annuler</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── Page ─── */
.page-sub { font-size: 13px; color: var(--c-ink-2); margin-top: 2px; }
.panel { background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--r-container); }
.set-panel { padding: var(--s-4) var(--s-5); margin-bottom: var(--s-5); }
.meta { color: var(--c-ink-3); font-weight: 400; }
.is-warn { color: var(--c-warn); }
.is-over { color: var(--c-over); }
.is-credit { color: var(--c-credit); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); flex-wrap: wrap; }
.panel-title { font-size: 15px; font-weight: 600; color: var(--c-ink); }
.panel-count { font-size: 13px; font-weight: 400; color: var(--c-ink-3); margin-left: var(--s-2); }
.panel-sub { font-size: 13px; color: var(--c-ink-2); margin-top: 2px; margin-bottom: var(--s-3); }
.panel-tools { display: flex; align-items: center; gap: var(--s-4); }
.saved-note { font-size: 12px; color: var(--c-ink-3); }
.view-tabs { display: inline-flex; gap: var(--s-4); }
.view-tab { font-size: var(--t-small); font-weight: 500; color: var(--c-ink-3); padding: var(--s-1) 0; cursor: pointer; border-bottom: 2px solid transparent; }
.view-tab:hover { color: var(--c-ink); }
.view-tab.is-active { color: var(--c-ink); border-bottom-color: var(--c-accent); }

/* ─── Édition en place : du texte au repos, un champ au clic ─── */
.edit-text {
  font-size: 14px; font-weight: 500; color: var(--c-ink);
  padding: 2px var(--s-2); margin-left: calc(-1 * var(--s-2));
  border: 1px solid transparent; border-radius: var(--r-control);
  cursor: text; text-align: left; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.edit-text:hover { border-color: var(--c-line-strong); background: var(--c-surface); }
.edit-input { width: 100%; }

/* ─── Général ─── */
.gen-grid { display: flex; gap: var(--s-8); flex-wrap: wrap; margin-bottom: var(--s-4); }
.gen-block { margin-bottom: var(--s-4); }
.gen-block:last-child { margin-bottom: 0; }
.gen-label { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); margin-bottom: var(--s-2); }
.chips { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
.rate-edit { display: inline-flex; align-items: center; gap: var(--s-2); }
.rate-suffix { font-size: 13px; color: var(--c-ink-2); }

/* ─── Catégories ─── */
.cat-grid {
  display: grid;
  grid-template-columns: 24px 24px minmax(0, 1fr) 128px 160px 40px;
  align-items: center;
  gap: var(--s-3);
  min-height: var(--h-row);
}
.cat-row { border-bottom: 1px solid var(--c-line); transition: background-color var(--dur-fast) var(--ease); outline: none; }
.cat-row:hover { background: var(--c-surface-hover); }
.cat-row:focus-visible { box-shadow: inset 0 0 0 2px var(--c-accent-ring); }
.cat-row.is-dragging { opacity: 0.5; }
.drag-handle { color: var(--c-ink-3); cursor: grab; text-align: center; user-select: none; font-size: 14px; }
.drag-handle:active { cursor: grabbing; }
.cell-name { min-width: 0; display: flex; }
.cell-usage { font-size: 13px; color: var(--c-ink-3); text-align: right; white-space: nowrap; }
.cell-usage.is-warn { color: var(--c-warn); }
.cell-actions { display: flex; justify-content: flex-end; }
.cat-add { border-top: 1px solid var(--c-line-strong); padding-top: var(--s-2); margin-top: -1px; }

/* Palette fermée : 12 pastilles, l'élue porte l'anneau accent */
.swatch-wrap { position: relative; display: flex; justify-content: center; }
.swatch { width: 20px; height: 20px; border-radius: var(--r-control); cursor: pointer; flex-shrink: 0; }
.swatch.is-current { box-shadow: 0 0 0 2px var(--c-surface), 0 0 0 4px var(--c-accent); }
.palette {
  position: absolute; left: 0; top: calc(100% + 6px); z-index: 40;
  display: grid; grid-template-columns: repeat(4, 20px); gap: var(--s-2);
  background: var(--c-surface); border: 1px solid var(--c-line);
  border-radius: var(--r-container); box-shadow: var(--shadow-overlay);
  padding: var(--s-3);
}

/* ─── Thèmes ─── */
.themes-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: var(--s-7); }
.theme-item { display: flex; align-items: center; gap: var(--s-2); min-height: 36px; border-bottom: 1px solid var(--c-line); }
.theme-item .cell-name { flex: 1; }
.theme-item .cell-usage { margin-left: auto; font-size: var(--t-small); }
.theme-item .edit-text { font-size: 13px; }
.theme-add { display: flex; gap: var(--s-2); margin-top: var(--s-3); }

/* ─── Calculateurs ─── */
.calc-row { padding: var(--s-2) 0; border-bottom: 1px solid var(--c-line); }
.calc-row:last-of-type { border-bottom: none; }
.calc-main { display: flex; align-items: center; gap: var(--s-3); min-height: 32px; }
.calc-name { font-size: 14px; font-weight: 500; color: var(--c-ink); flex-shrink: 0; }
/* Seul endroit de l'app où la chasse fixe est justifiée : c'est du code */
.calc-formula {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 12px; color: var(--c-ink-2);
  background: var(--c-surface-sunken); border-radius: var(--r-control);
  padding: 2px var(--s-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
.calc-main .cell-actions { margin-left: auto; }
.calc-meta { font-size: 12px; margin-top: 2px; }
.calc-editor { margin-top: var(--s-3); border-top: 1px solid var(--c-line); padding-top: var(--s-4); display: flex; flex-direction: column; gap: var(--s-5); }
.editor-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-6); }
.editor-title { font-size: var(--t-small); font-weight: 600; color: var(--c-ink-2); margin-bottom: var(--s-2); }
.editor-row { display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-2); }
.mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; }

/* ─── Menus ⋯ ─── */
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
.menu-item:disabled { color: var(--c-ink-disabled); cursor: default; }
.menu-item:disabled:hover { background: none; }
.menu-item.is-danger { color: var(--c-over); }
.menu-item.is-danger:hover { background: var(--c-over-soft); }
.menu-sep { height: 1px; background: var(--c-line); margin: var(--s-2) 0; }

/* ─── Tags, boutons, champs ─── */
.tag {
  display: inline-flex; align-items: center; gap: var(--s-1);
  height: 22px; padding: 0 var(--s-3);
  border-radius: var(--r-control);
  font-size: var(--t-tag); font-weight: 500;
  white-space: nowrap; flex-shrink: 0;
}
.tag-neutral { background: var(--c-surface-sunken); color: var(--c-ink-2); border: 1px solid var(--c-line); }
.tag-x { font-size: 12px; color: var(--c-ink-3); cursor: pointer; margin-left: 2px; }
.tag-x:hover { color: var(--c-over); }

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
.field { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--t-meta); font-weight: 500; color: var(--c-ink-3); }
.input { padding: 6px var(--s-3); border: 1px solid var(--c-line-strong); border-radius: var(--r-control); font-size: 13px; color: var(--c-ink); background: var(--c-surface); outline: none; font-family: var(--font-ui); }
.input:focus-visible, .input:focus { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
/* Pas de spinner sur les champs numériques */
.input[type='number']::-webkit-inner-spin-button, .input[type='number']::-webkit-outer-spin-button { appearance: none; margin: 0; }
.input[type='number'] { -moz-appearance: textfield; appearance: textfield; }

/* Select restylé : chevron dessiné, jamais l'apparence native */
.select-wrap { position: relative; display: inline-flex; }
.select {
  appearance: none; -webkit-appearance: none;
  height: 32px; padding: 0 26px 0 var(--s-3);
  border: 1px solid var(--c-line-strong); border-radius: var(--r-control);
  font-size: 13px; color: var(--c-ink); background: var(--c-surface);
  outline: none; cursor: pointer; font-family: var(--font-ui);
}
.select:focus-visible { border-color: var(--c-accent); box-shadow: 0 0 0 3px var(--c-accent-ring); }
.select-wrap::after {
  content: ''; position: absolute; right: 10px; top: 50%; margin-top: -2px;
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid var(--c-ink-3);
  pointer-events: none;
}

.empty-block { text-align: center; padding: var(--s-6) 0; font-size: 13px; color: var(--c-ink-2); }
.empty-line { font-size: 13px; color: var(--c-ink-3); padding: var(--s-2) 0; }

button:focus-visible, select:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--c-accent-ring); border-radius: var(--r-control); }

/* ─── Responsive ─── */
@media (max-width: 1119px) {
  .themes-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 979px) {
  .cat-grid { grid-template-columns: 24px 24px minmax(0, 1fr) 128px 40px; }
  .cat-grid > .cell-usage { display: none; }
  .editor-cols { grid-template-columns: 1fr; }
}
@media (max-width: 719px) {
  .themes-grid { grid-template-columns: 1fr; }
}
</style>
