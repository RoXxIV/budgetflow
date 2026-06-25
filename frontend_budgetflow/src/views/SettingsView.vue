<script setup>
import { ref, onMounted } from 'vue'
import { getAccounts, createAccount, updateAccount, deleteAccount } from '@/api/accounts.js'
import { getSections, createSection, updateSection, deleteSection } from '@/api/sections.js'
import { getThemes, createTheme, updateTheme, deleteTheme } from '@/api/themes.js'
import { getSettings, updateSettings } from '@/api/settings.js'
import { getTemplateLines } from '@/api/template.js'
import {
  getUtilityMeters,
  createUtilityMeter,
  updateUtilityMeter,
  deleteUtilityMeter,
} from '@/api/utilityMeters.js'

// ─── State ───────────────────────────────────────────────
const accounts = ref([])
const sections = ref([])
const themes = ref([])
const meters = ref([])
const settings = ref(null)

// ─── Formulaires ajout ───────────────────────────────────
const newAccount = ref({ name: '', type: 'bank', includeInNetWorth: true })
const newSection = ref({ name: '', color: '#6b7280' })
const newTheme = ref({ name: '', color: '#6b7280', role: 'normal' })
const newMeter = ref({ name: '', config: { hpPrice: 0, hcPrice: 0, subscriptionPrice: 0, tvaRate: 20 } })

// ─── Edition inline ──────────────────────────────────────
const editingId = ref(null)
const editBuffer = ref({})

// ─── Toast ───────────────────────────────────────────────
const saveSuccess = ref(false)
function showToast() {
  saveSuccess.value = true
  setTimeout(() => { saveSuccess.value = false }, 2500)
}

// ─── rentBudgetLine + mainAccount (IDs séparés du populate) ─
const rentBudgetLineId = ref(null)
const mainAccountId = ref(null)

// ─── Chargement ──────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadAccounts(), loadSections(), loadThemes(), loadSettings(), loadMeters(), loadTemplateLines()])
})

async function loadAccounts() { accounts.value = (await getAccounts()).data }
async function loadSections() { sections.value = (await getSections()).data }
async function loadThemes() { themes.value = (await getThemes()).data }
async function loadSettings() {
  settings.value = (await getSettings()).data
  rentBudgetLineId.value = settings.value.rentBudgetLine?._id || settings.value.rentBudgetLine || null
  mainAccountId.value = settings.value.mainAccount?._id || settings.value.mainAccount || null
}
async function loadMeters() { meters.value = (await getUtilityMeters()).data }

// ─── Comptes ─────────────────────────────────────────────
async function addAccount() {
  if (!newAccount.value.name.trim()) return
  await createAccount(newAccount.value)
  newAccount.value = { name: '', type: 'bank', includeInNetWorth: true }
  await loadAccounts()
}
async function saveAccount(id) {
  await updateAccount(id, editBuffer.value)
  editingId.value = null
  await loadAccounts()
}
async function removeAccount(id) {
  await deleteAccount(id)
  await loadAccounts()
}

// ─── Sections ────────────────────────────────────────────
async function addSection() {
  if (!newSection.value.name.trim()) return
  await createSection(newSection.value)
  newSection.value = { name: '', color: '#6b7280' }
  await loadSections()
}
async function saveSection(id) {
  await updateSection(id, editBuffer.value)
  editingId.value = null
  await loadSections()
}
async function removeSection(id) {
  await deleteSection(id)
  await loadSections()
}

// ─── Thèmes ──────────────────────────────────────────────
async function addTheme() {
  if (!newTheme.value.name.trim()) return
  await createTheme(newTheme.value)
  newTheme.value = { name: '', color: '#6b7280', role: 'normal' }
  await loadThemes()
}
async function saveTheme(id) {
  await updateTheme(id, editBuffer.value)
  editingId.value = null
  await loadThemes()
}
async function removeTheme(id) {
  await deleteTheme(id)
  await loadThemes()
}

// ─── Compteurs ───────────────────────────────────────────
async function addMeter() {
  if (!newMeter.value.name.trim()) return
  await createUtilityMeter(newMeter.value)
  newMeter.value = { name: '', config: { hpPrice: 0, hcPrice: 0, subscriptionPrice: 0, tvaRate: 20 } }
  await loadMeters()
}
async function saveMeter(id) {
  await updateUtilityMeter(id, editBuffer.value)
  editingId.value = null
  await loadMeters()
}
async function removeMeter(id) {
  await deleteUtilityMeter(id)
  await loadMeters()
}

// ─── Edition générique ───────────────────────────────────
function startEdit(item) {
  editingId.value = item._id
  editBuffer.value = JSON.parse(JSON.stringify(item))
  if (editBuffer.value.budgetLine?._id) editBuffer.value.budgetLine = editBuffer.value.budgetLine._id
}
function cancelEdit() {
  editingId.value = null
  editBuffer.value = {}
}

// ─── Paramètres globaux ──────────────────────────────────
async function saveSettings() {
  await updateSettings({
    savingRate: settings.value.savingRate,
    currency: settings.value.currency,
    includeInvestmentsInSavings: settings.value.includeInvestmentsInSavings,
    partnerRentAmount: settings.value.partnerRentAmount,
    rentBudgetLine: rentBudgetLineId.value || null,
    mainAccount: mainAccountId.value || null,
  })
  showToast()
}

// ─── Template lines pour le sélecteur EDF ────────────────
const templateLines = ref([])
async function loadTemplateLines() {
  templateLines.value = (await getTemplateLines()).data
}

const accountTypeLabel = { bank: 'Banque', cash: 'Espèces', savings: 'Épargne' }
</script>

<template>
  <div>
    <!-- ─── En-tête ────────────────────────────────────────── -->
    <div class="mb-7">
      <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Paramètres</h1>
      <p class="text-[13px] text-gray-400 mt-0.75">Comptes, catégories, thèmes et préférences</p>
    </div>

    <div class="grid grid-cols-2 gap-4">

      <!-- ─── Comptes ──────────────────────────────────────── -->
      <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-5.5 py-5">
        <h2 class="flex items-center gap-2 text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-4">
          <font-awesome-icon icon="building-columns" class="text-gray-400" /> Comptes
        </h2>
        <div class="flex items-center gap-2 mb-3.5">
          <input v-model="newAccount.name" placeholder="Ex: N26 Main" class="input-field flex-1" @keyup.enter="addAccount" />
          <select v-model="newAccount.type" class="select-field">
            <option value="bank">Banque</option>
            <option value="cash">Espèces</option>
            <option value="savings">Épargne</option>
          </select>
          <label class="flex items-center gap-1.5 text-[12.5px] text-gray-500 dark:text-gray-400 cursor-pointer whitespace-nowrap">
            <input type="checkbox" v-model="newAccount.includeInNetWorth" /> Patrimoine
          </label>
          <button class="btn-add" @click="addAccount"><font-awesome-icon icon="plus" /></button>
        </div>
        <div class="flex flex-col gap-1.5">
          <div v-for="account in accounts" :key="account._id" class="list-row">
            <template v-if="editingId === account._id">
              <input v-model="editBuffer.name" class="input-field flex-1 min-w-0" />
              <select v-model="editBuffer.type" class="select-field max-w-30">
                <option value="bank">Banque</option>
                <option value="cash">Espèces</option>
                <option value="savings">Épargne</option>
              </select>
              <label class="flex items-center gap-1.5 text-[12.5px] text-gray-500 dark:text-gray-400 cursor-pointer whitespace-nowrap">
                <input type="checkbox" v-model="editBuffer.includeInNetWorth" /> Patrimoine
              </label>
              <div class="row-actions">
                <button class="btn-inline-save" @click="saveAccount(account._id)">Sauver</button>
                <button class="btn-inline-cancel" @click="cancelEdit">Annuler</button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                <span class="text-[13.5px] font-medium text-gray-700 dark:text-gray-200 truncate">{{ account.name }}</span>
                <span class="badge">{{ accountTypeLabel[account.type] }}</span>
                <span v-if="account.includeInNetWorth" class="badge badge-blue">Patrimoine</span>
              </div>
              <div class="row-actions">
                <button class="btn-inline-edit" @click="startEdit(account)">Modifier</button>
                <button class="btn-inline-delete" @click="removeAccount(account._id)">Supprimer</button>
              </div>
            </template>
          </div>
          <p v-if="accounts.length === 0" class="text-[12.5px] text-gray-300 dark:text-gray-600 text-center py-3">Aucun compte</p>
        </div>
      </div>

      <!-- ─── Catégories ───────────────────────────────────── -->
      <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-5.5 py-5">
        <h2 class="flex items-center gap-2 text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-4">
          <font-awesome-icon icon="table-list" class="text-gray-400" /> Catégories
        </h2>
        <div class="flex items-center gap-2 mb-3.5">
          <input v-model="newSection.name" placeholder="Ex: Factures" class="input-field flex-1" @keyup.enter="addSection" />
          <input type="color" v-model="newSection.color" class="color-picker" />
          <button class="btn-add" @click="addSection"><font-awesome-icon icon="plus" /></button>
        </div>
        <div class="flex flex-col gap-1.5">
          <div v-for="section in sections" :key="section._id" class="list-row">
            <template v-if="editingId === section._id">
              <input v-model="editBuffer.name" class="input-field flex-1 min-w-0" />
              <input type="color" v-model="editBuffer.color" class="color-picker" />
              <div class="row-actions">
                <button class="btn-inline-save" @click="saveSection(section._id)">Sauver</button>
                <button class="btn-inline-cancel" @click="cancelEdit">Annuler</button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2 flex-1 flex-wrap">
                <span class="w-3 h-3 rounded-full shrink-0" :style="{ background: section.color || '#6b7280' }"></span>
                <span class="text-[13.5px] font-medium text-gray-700 dark:text-gray-200">{{ section.name }}</span>
              </div>
              <div class="row-actions">
                <button class="btn-inline-edit" @click="startEdit(section)">Modifier</button>
                <button class="btn-inline-delete" @click="removeSection(section._id)">Supprimer</button>
              </div>
            </template>
          </div>
          <p v-if="sections.length === 0" class="text-[12.5px] text-gray-300 dark:text-gray-600 text-center py-3">Aucune catégorie</p>
        </div>
      </div>

      <!-- ─── Thèmes ───────────────────────────────────────── -->
      <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-5.5 py-5">
        <h2 class="flex items-center gap-2 text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-4">
          <font-awesome-icon icon="chart-bar" class="text-gray-400" /> Thèmes
        </h2>
        <div class="flex items-center gap-2 mb-3.5">
          <input v-model="newTheme.name" placeholder="Ex: Alimentation" class="input-field flex-1" @keyup.enter="addTheme" />
          <input type="color" v-model="newTheme.color" class="color-picker" />
          <select v-model="newTheme.role" class="select-field max-w-30">
            <option value="normal">Normal</option>
            <option value="rent_base">Loyer (½)</option>
          </select>
          <button class="btn-add" @click="addTheme"><font-awesome-icon icon="plus" /></button>
        </div>
        <div class="flex flex-col gap-1.5">
          <div v-for="theme in themes" :key="theme._id" class="list-row">
            <template v-if="editingId === theme._id">
              <input v-model="editBuffer.name" class="input-field flex-1 min-w-0" />
              <input type="color" v-model="editBuffer.color" class="color-picker" />
              <select v-model="editBuffer.role" class="select-field max-w-30">
                <option value="normal">Normal</option>
                <option value="rent_base">Loyer (½)</option>
              </select>
              <div class="row-actions">
                <button class="btn-inline-save" @click="saveTheme(theme._id)">Sauver</button>
                <button class="btn-inline-cancel" @click="cancelEdit">Annuler</button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center gap-2 flex-1 flex-wrap">
                <span class="w-3 h-3 rounded-full shrink-0" :style="{ background: theme.color || '#6b7280' }"></span>
                <span class="text-[13.5px] font-medium text-gray-700 dark:text-gray-200">{{ theme.name }}</span>
                <span v-if="theme.role === 'rent_base'" class="badge badge-orange">loyer ½</span>
              </div>
              <div class="row-actions">
                <button class="btn-inline-edit" @click="startEdit(theme)">Modifier</button>
                <button class="btn-inline-delete" @click="removeTheme(theme._id)">Supprimer</button>
              </div>
            </template>
          </div>
          <p v-if="themes.length === 0" class="text-[12.5px] text-gray-300 dark:text-gray-600 text-center py-3">Aucun thème</p>
        </div>
      </div>

      <!-- ─── Compteur EDF ─────────────────────────────────── -->
      <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-5.5 py-5">
        <h2 class="flex items-center gap-2 text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-4">
          <font-awesome-icon icon="bolt" class="text-gray-400" /> Compteur EDF
        </h2>
        <div class="flex items-center gap-2 mb-3.5">
          <input v-model="newMeter.name" placeholder="Ex: EDF" class="input-field flex-1" @keyup.enter="addMeter" />
          <button class="btn-add" @click="addMeter"><font-awesome-icon icon="plus" /></button>
        </div>
        <div class="flex flex-col gap-1.5">
          <div v-for="meter in meters" :key="meter._id" class="list-row flex-col items-stretch">
            <template v-if="editingId === meter._id">
              <div class="grid grid-cols-2 gap-2">
                <div class="flex flex-col gap-1">
                  <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Nom</label>
                  <input v-model="editBuffer.name" class="input-field" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Prix HP (€/kWh)</label>
                  <input v-model.number="editBuffer.config.hpPrice" type="number" step="0.001" class="input-field" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Prix HC (€/kWh)</label>
                  <input v-model.number="editBuffer.config.hcPrice" type="number" step="0.001" class="input-field" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Abonnement (€/mois)</label>
                  <input v-model.number="editBuffer.config.subscriptionPrice" type="number" step="0.01" class="input-field" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-xs font-medium text-gray-500 dark:text-gray-400">TVA (%)</label>
                  <input v-model.number="editBuffer.config.tvaRate" type="number" class="input-field" />
                </div>
                <div class="flex flex-col gap-1 col-span-2">
                  <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Ligne budget (mensualité)</label>
                  <select v-model="editBuffer.budgetLine" class="select-field">
                    <option value="">— Aucune —</option>
                    <option v-for="line in templateLines" :key="line._id" :value="line._id">
                      {{ line.label }} {{ line.plannedAmount > 0 ? '(' + line.plannedAmount + '€)' : '' }}
                    </option>
                  </select>
                </div>
              </div>
              <div class="row-actions mt-2">
                <button class="btn-inline-save" @click="saveMeter(meter._id)">Sauver</button>
                <button class="btn-inline-cancel" @click="cancelEdit">Annuler</button>
              </div>
            </template>
            <template v-else>
              <div class="flex items-center justify-between w-full">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[13.5px] font-medium text-gray-700 dark:text-gray-200">{{ meter.name }}</span>
                  <span class="badge">HP {{ meter.config?.hpPrice }}€</span>
                  <span class="badge">HC {{ meter.config?.hcPrice }}€</span>
                  <span class="badge">Abo {{ meter.config?.subscriptionPrice }}€</span>
                  <span class="badge">TVA {{ meter.config?.tvaRate }}%</span>
                  <span v-if="meter.budgetLine" class="badge badge-blue">→ {{ meter.budgetLine.label }}</span>
                </div>
                <div class="row-actions">
                  <button class="btn-inline-edit" @click="startEdit(meter)">Modifier</button>
                  <button class="btn-inline-delete" @click="removeMeter(meter._id)">Supprimer</button>
                </div>
              </div>
            </template>
          </div>
          <p v-if="meters.length === 0" class="text-[12.5px] text-gray-300 dark:text-gray-600 text-center py-3">Aucun compteur configuré</p>
        </div>
      </div>

      <!-- ─── Général ──────────────────────────────────────── -->
      <div v-if="settings" class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] px-5.5 py-5 col-span-2">
        <h2 class="flex items-center gap-2 text-[14px] font-semibold text-gray-950 dark:text-gray-50 mb-4">
          <font-awesome-icon icon="gear" class="text-gray-400" /> Général
        </h2>
        <div class="flex flex-col gap-3.5">
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Devise</label>
            <select v-model="settings.currency" class="select-field max-w-40">
              <option value="EUR">EUR €</option>
              <option value="USD">USD $</option>
              <option value="GBP">GBP £</option>
              <option value="CHF">CHF ₣</option>
            </select>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Objectif d'épargne (%)</label>
            <input type="number" v-model="settings.savingRate" min="0" max="100" class="input-field max-w-40" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Loyer total copine (€/mois)</label>
            <input type="number" v-model="settings.partnerRentAmount" min="0" step="0.01" class="input-field max-w-40" />
            <span class="text-[11.5px] text-gray-300 dark:text-gray-600">Montant total que ta copine paie pour le logement — utilisé dans le calcul ½</span>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Ligne budget "virement copine"</label>
            <select v-model="rentBudgetLineId" class="select-field max-w-80">
              <option :value="null">— Aucune —</option>
              <option v-for="line in templateLines" :key="line._id" :value="line._id">
                {{ line.label }} {{ line.plannedAmount > 0 ? '(' + line.plannedAmount + '€)' : '' }}
              </option>
            </select>
            <span class="text-[11.5px] text-gray-300 dark:text-gray-600">La ligne du template qui correspond au virement envoyé à ta copine</span>
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-xs font-medium text-gray-500 dark:text-gray-400">Compte principal (Bilan du mois)</label>
            <select v-model="mainAccountId" class="select-field max-w-80">
              <option :value="null">— Aucun —</option>
              <option v-for="acc in accounts" :key="acc._id" :value="acc._id">{{ acc.name }}</option>
            </select>
            <span class="text-[11.5px] text-gray-300 dark:text-gray-600">Compte utilisé pour calculer le "Reste réel" dans le bilan mensuel</span>
          </div>
          <div>
            <label class="flex items-center gap-1.5 text-[12.5px] text-gray-500 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" v-model="settings.includeInvestmentsInSavings" />
              Inclure les investissements dans le taux d'épargne
            </label>
          </div>
          <div class="flex items-center gap-3">
            <button class="flex items-center px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-[13px] font-medium cursor-pointer border-none transition-colors" @click="saveSettings">
              Sauvegarder
            </button>
            <Transition name="toast">
              <span v-if="saveSuccess" class="text-[12.5px] text-green-600 dark:text-green-400 font-medium">✓ Paramètres sauvegardés</span>
            </Transition>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* Shared input/select styles — trop verbeux à répéter en Tailwind inline */
.input-field {
  padding: 7px 10px;
  border: 1px solid #e8e8e5;
  border-radius: 6px;
  font-size: 13px;
  color: #1a1a1a;
  outline: none;
  background: #fafafa;
}
.input-field:focus { border-color: #7c3aed; background: #fff; }

:global(.dark) .input-field {
  background: #374151;
  border-color: #4b5563;
  color: #f3f4f6;
}
:global(.dark) .input-field:focus { border-color: #8b5cf6; background: #1f2937; }

.select-field {
  padding: 7px 8px;
  border: 1px solid #e8e8e5;
  border-radius: 6px;
  font-size: 13px;
  color: #1a1a1a;
  background: #fafafa;
  outline: none;
  cursor: pointer;
}
:global(.dark) .select-field {
  background: #374151;
  border-color: #4b5563;
  color: #f3f4f6;
}

.color-picker {
  width: 34px;
  height: 34px;
  border: 1px solid #e8e8e5;
  border-radius: 6px;
  padding: 2px;
  cursor: pointer;
  background: none;
  flex-shrink: 0;
}

.btn-add {
  width: 32px;
  height: 32px;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}
.btn-add:hover { background: #6d28d9; }

.list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: #f9fafb;
  border-radius: 7px;
  min-height: 38px;
}
:global(.dark) .list-row { background: #1f2937; }

.row-actions { display: flex; gap: 6px; flex-shrink: 0; }

.badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 20px;
  background: #f3f4f6;
  color: #6b7280;
  white-space: nowrap;
}
:global(.dark) .badge { background: #374151; color: #9ca3af; }
.badge-blue { background: #f5f3ff; color: #7c3aed; }
:global(.dark) .badge-blue { background: rgba(124,58,237,0.2); color: #c4b5fd; }
.badge-orange { background: #fff7ed; color: #ea580c; }
:global(.dark) .badge-orange { background: rgba(234,88,12,0.2); color: #fdba74; }

.btn-inline-edit { font-size: 12px; color: #7c3aed; background: none; border: none; cursor: pointer; padding: 2px 4px; }
.btn-inline-edit:hover { text-decoration: underline; }
.btn-inline-delete { font-size: 12px; color: #ef4444; background: none; border: none; cursor: pointer; padding: 2px 4px; }
.btn-inline-delete:hover { text-decoration: underline; }
.btn-inline-save { font-size: 12px; color: #16a34a; background: none; border: none; cursor: pointer; padding: 2px 4px; font-weight: 500; }
.btn-inline-cancel { font-size: 12px; color: #6b7280; background: none; border: none; cursor: pointer; padding: 2px 4px; }
:global(.dark) .btn-inline-cancel { color: #9ca3af; }

.toast-enter-active, .toast-leave-active { transition: opacity 0.3s; }
.toast-enter-from, .toast-leave-to { opacity: 0; }
</style>
