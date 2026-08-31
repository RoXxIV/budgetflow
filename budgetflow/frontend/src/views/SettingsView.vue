<script setup>
import { ref, onMounted } from 'vue'
import { getSettings, updateSettings } from '@/api/settings.js'
import { getCategories, createCategory, updateCategory, reorderCategories, deleteCategory } from '@/api/categories.js'
import { getThemes, createTheme, updateTheme, deleteTheme } from '@/api/themes.js'

// ─── Data ────────────────────────────────────────────────
const settings = ref(null)
const categories = ref([])
const themes = ref([])

async function load() {
  const [setRes, catRes, themeRes] = await Promise.all([getSettings(), getCategories(), getThemes()])
  settings.value = setRes.data
  categories.value = catRes.data
  themes.value = themeRes.data
}
onMounted(load)

function apiError(e) {
  alert(e.response?.data?.message || e.message)
}

// ─── Toast sauvegarde ────────────────────────────────────
const saved = ref(false)
let savedTimer = null
function flashSaved() {
  saved.value = true
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => { saved.value = false }, 2000)
}

// ─── Général ─────────────────────────────────────────────
const newPaymentMethod = ref('')

function addPaymentMethod() {
  const v = newPaymentMethod.value.trim()
  if (!v || settings.value.paymentMethods.includes(v)) return
  settings.value.paymentMethods.push(v)
  newPaymentMethod.value = ''
}
function removePaymentMethod(m) {
  settings.value.paymentMethods = settings.value.paymentMethods.filter((x) => x !== m)
}

async function saveGeneral() {
  try {
    await updateSettings({
      currency: settings.value.currency,
      savingRate: Number(settings.value.savingRate) || 0,
      paymentMethods: settings.value.paymentMethods,
    })
    flashSaved()
  } catch (e) { apiError(e) }
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
const newCategory = ref({ name: '', type: 'depense', color: '#7c3aed' })

async function addCategory() {
  if (!newCategory.value.name.trim()) return
  try {
    await createCategory(newCategory.value)
    newCategory.value = { name: '', type: 'depense', color: '#7c3aed' }
    categories.value = (await getCategories()).data
  } catch (e) { apiError(e) }
}

async function saveCategory(category) {
  try {
    await updateCategory(category.id, { name: category.name, type: category.type, color: category.color })
    flashSaved()
  } catch (e) { apiError(e); categories.value = (await getCategories()).data }
}

async function moveCategory(index, delta) {
  const target = index + delta
  if (target < 0 || target >= categories.value.length) return
  const list = [...categories.value]
  ;[list[index], list[target]] = [list[target], list[index]]
  categories.value = list
  try {
    await reorderCategories(list.map((c, i) => ({ id: c.id, order: i })))
  } catch (e) { apiError(e) }
}

async function removeCategoryConfirm(category) {
  if (!confirm(`Supprimer la catégorie « ${category.name} » ?`)) return
  try {
    await deleteCategory(category.id)
    categories.value = (await getCategories()).data
  } catch (e) { apiError(e) }
}

// Presets proposés quand la liste est vide (l'utilisateur renomme/supprime ensuite)
const PRESETS = [
  { name: 'Factures', type: 'depense', color: '#0891b2' },
  { name: 'Abonnements', type: 'depense', color: '#7c3aed' },
  { name: 'Courses & quotidien', type: 'depense', color: '#16a34a' },
  { name: 'Loisirs', type: 'depense', color: '#ea580c' },
  { name: 'Revenus', type: 'revenu', color: '#65a30d' },
  { name: 'Épargne', type: 'epargne', color: '#0d9488' },
  { name: 'Virements', type: 'transfert', color: '#6b7280' },
]
async function applyPresets() {
  try {
    for (const p of PRESETS) await createCategory(p)
    categories.value = (await getCategories()).data
  } catch (e) { apiError(e) }
}

// ─── Thèmes ──────────────────────────────────────────────
const newTheme = ref({ name: '', color: '#7c3aed' })

async function addTheme() {
  if (!newTheme.value.name.trim()) return
  try {
    await createTheme(newTheme.value)
    newTheme.value = { name: '', color: '#7c3aed' }
    themes.value = (await getThemes()).data
  } catch (e) { apiError(e) }
}

async function saveTheme(theme) {
  try {
    await updateTheme(theme.id, { name: theme.name, color: theme.color })
    flashSaved()
  } catch (e) { apiError(e); themes.value = (await getThemes()).data }
}

async function removeThemeConfirm(theme) {
  if (!confirm(`Supprimer le thème « ${theme.name} » ?`)) return
  try {
    await deleteTheme(theme.id)
    themes.value = (await getThemes()).data
  } catch (e) { apiError(e) }
}
</script>

<template>
  <div v-if="settings">
    <!-- ─── En-tête ──────────────────────────────────── -->
    <div class="flex items-start justify-between mb-6">
      <div>
        <h1 class="text-[22px] font-semibold">Paramètres</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Catégories, thèmes et réglages généraux</p>
      </div>
      <span v-if="saved" class="text-[12.5px] text-emerald-600 bg-emerald-50 rounded-full px-3 py-1">✓ Sauvegardé</span>
    </div>

    <div class="grid grid-cols-2 gap-5 items-start">

      <!-- ─── Catégories ─────────────────────────────── -->
      <div class="card">
        <h2 class="section-title">Catégories</h2>
        <p class="text-xs text-gray-400 mb-3">Les blocs de votre sheet mensuel. Leur type pilote les calculs.</p>

        <div v-if="!categories.length" class="text-center py-6">
          <p class="text-[13px] text-gray-400 mb-3">Aucune catégorie pour l'instant.</p>
          <button class="btn-primary" @click="applyPresets">Partir d'un jeu de base</button>
          <p class="text-[11.5px] text-gray-400 mt-2">Factures, Abonnements, Courses… — renommez ou supprimez ensuite.</p>
        </div>

        <div v-for="(category, i) in categories" :key="category.id" class="row">
          <input v-model="category.color" type="color" class="color-input" @change="saveCategory(category)" />
          <input v-model="category.name" type="text" class="input flex-1" @change="saveCategory(category)" />
          <select v-model="category.type" class="input w-30" :title="TYPE_HINTS[category.type]" @change="saveCategory(category)">
            <option v-for="t in CATEGORY_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <div class="flex flex-col">
            <button class="order-btn" :disabled="i === 0" @click="moveCategory(i, -1)">▲</button>
            <button class="order-btn" :disabled="i === categories.length - 1" @click="moveCategory(i, 1)">▼</button>
          </div>
          <button class="icon-btn text-red-300 hover:text-red-500" @click="removeCategoryConfirm(category)">🗑</button>
        </div>

        <div class="row mt-3 border-t border-stone-100 pt-3">
          <input v-model="newCategory.color" type="color" class="color-input" />
          <input v-model="newCategory.name" type="text" class="input flex-1" placeholder="Nouvelle catégorie" @keyup.enter="addCategory" />
          <select v-model="newCategory.type" class="input w-30">
            <option v-for="t in CATEGORY_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
          <button class="btn-secondary" @click="addCategory">Ajouter</button>
        </div>
        <p v-if="newCategory.type" class="text-[11.5px] text-gray-400 mt-1.5">{{ TYPE_HINTS[newCategory.type] }}</p>
      </div>

      <div class="flex flex-col gap-5">
        <!-- ─── Thèmes ───────────────────────────────── -->
        <div class="card">
          <h2 class="section-title">Thèmes</h2>
          <p class="text-xs text-gray-400 mb-3">
            Axe d'analyse transversal (0 à N, facultatif). Posés sur les lignes, surchargeables par entrée.
          </p>

          <div v-for="theme in themes" :key="theme.id" class="row">
            <input v-model="theme.color" type="color" class="color-input" @change="saveTheme(theme)" />
            <input v-model="theme.name" type="text" class="input flex-1" @change="saveTheme(theme)" />
            <button class="icon-btn text-red-300 hover:text-red-500" @click="removeThemeConfirm(theme)">🗑</button>
          </div>
          <p v-if="!themes.length" class="text-[13px] text-gray-400 py-2">
            Aucun thème — l'app fonctionne aussi sans (le champ n'apparaîtra pas à la saisie).
          </p>

          <div class="row mt-3 border-t border-stone-100 pt-3">
            <input v-model="newTheme.color" type="color" class="color-input" />
            <input v-model="newTheme.name" type="text" class="input flex-1" placeholder="Nouveau thème (IA, Restaurants…)" @keyup.enter="addTheme" />
            <button class="btn-secondary" @click="addTheme">Ajouter</button>
          </div>
        </div>

        <!-- ─── Général ──────────────────────────────── -->
        <div class="card">
          <h2 class="section-title">Général</h2>
          <div class="flex flex-wrap gap-4 items-end mb-4">
            <label class="field">
              <span>Devise</span>
              <input v-model="settings.currency" type="text" class="input w-24" maxlength="3" />
            </label>
            <label class="field">
              <span>Objectif d'épargne (% du revenu du mois)</span>
              <input v-model="settings.savingRate" type="number" min="0" max="100" class="input w-24" />
            </label>
          </div>
          <div class="mb-4">
            <p class="text-xs font-medium text-gray-500 mb-1.5">Moyens de paiement</p>
            <div class="flex flex-wrap gap-1.5 items-center">
              <span v-for="m in settings.paymentMethods" :key="m" class="chip">
                {{ m }}
                <button class="text-gray-400 hover:text-red-500 ml-1 cursor-pointer" @click="removePaymentMethod(m)">×</button>
              </span>
              <input v-model="newPaymentMethod" type="text" class="input w-32" placeholder="Ajouter…" @keyup.enter="addPaymentMethod" />
            </div>
          </div>
          <button class="btn-primary" @click="saveGeneral">Sauvegarder</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@/style.css";

.card { @apply bg-white rounded-xl border border-stone-200 px-5 py-4; }
.section-title { @apply text-[15px] font-semibold mb-1; }
.field { @apply flex flex-col gap-1 text-xs font-medium text-gray-500; }
.input { @apply py-1.5 px-2.5 border border-stone-200 rounded-md text-[13px] text-gray-900 bg-stone-50 outline-none focus:border-violet-400; }
.btn-primary { @apply py-2 px-3.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[13px] font-medium cursor-pointer; }
.btn-secondary { @apply py-1.5 px-3 bg-white border border-stone-200 hover:bg-stone-50 text-gray-600 rounded-md text-[13px] font-medium cursor-pointer; }
.icon-btn { @apply w-7 h-7 rounded-md hover:bg-stone-100 cursor-pointer text-[13px]; }
.row { @apply flex items-center gap-2 py-1; }
.color-input { @apply w-7 h-7 p-0 border-0 rounded cursor-pointer bg-transparent shrink-0; }
.order-btn { @apply text-[9px] leading-3 text-gray-300 hover:text-gray-600 cursor-pointer disabled:opacity-30 disabled:cursor-default; }
.chip { @apply inline-flex items-center text-[12.5px] bg-stone-100 rounded-full px-2.5 py-1; }
</style>
