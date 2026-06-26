<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import draggable from 'vuedraggable'
import { getTemplateLines, createTemplateLine, updateTemplateLine, deleteTemplateLine, reorderTemplateLines } from '@/api/template.js'
import { getAccounts } from '@/api/accounts.js'
import { getSections, reorderSections } from '@/api/sections.js'
import { getThemes } from '@/api/themes.js'
import { getSettings } from '@/api/settings.js'
import AppModal from '@/components/AppModal.vue'
import ChipSelect from '@/components/ChipSelect.vue'
import ThemeSelect from '@/components/ThemeSelect.vue'

// ─── Data ────────────────────────────────────────────────
const lines = ref([])
const accounts = ref([])
const sections = ref([])
const themes = ref([])
const settings = ref(null)

// ─── État UI ─────────────────────────────────────────────
const editingId = ref(null)
const editBuffer = ref({})
const addingSectionId = ref(null)
const newLine = ref(defaultLine())
const addingIncome = ref(false)
const newIncomeLine = ref(defaultIncomeLine())

function defaultLine() {
  return {
    label: '',
    plannedAmount: 0,
    flow: 'expense',
    type: 'fixed',
    section: '',
    theme: '',
    fromAccount: '',
    toAccount: '',
    paymentMethod: 'CB',
    isShared: false,
    recurringDay: '',
    notes: '',
  }
}

function defaultIncomeLine() {
  return { label: '', plannedAmount: 0, flow: 'income', toAccount: '', notes: '' }
}

// ─── Chargement ──────────────────────────────────────────
onMounted(async () => {
  await Promise.all([loadLines(), loadMeta()])
})

async function loadLines() {
  lines.value = (await getTemplateLines()).data
}

async function loadMeta() {
  const [acc, sec, the, set] = await Promise.all([
    getAccounts(), getSections(), getThemes(), getSettings(),
  ])
  accounts.value = acc.data
  sections.value = sec.data
  themes.value = the.data
  settings.value = set.data
}

// ─── Sections + lignes draggables ────────────────────────
const draggableSections = ref([])
const draggableLinesMap = ref({})
const draggableIncomeLines = ref([])

function buildDraggable() {
  draggableSections.value = [...sections.value]
  const map = {}
  const allSectionIds = [...sections.value.map((s) => s._id), 'none']
  allSectionIds.forEach((id) => { map[id] = [] })

  lines.value.forEach((line) => {
    if (line.flow === 'income') {
      // income lines go to the dedicated income block
      return
    }
    const key = line.section?._id || 'none'
    if (map[key] !== undefined) map[key].push(line)
    else map['none'].push(line)
  })
  draggableLinesMap.value = map
  draggableIncomeLines.value = lines.value.filter((l) => l.flow === 'income')
}

watch([sections, lines], buildDraggable, { immediate: true })

async function onSectionReorder() {
  const orders = draggableSections.value.map((s, i) => ({ id: s._id, order: i }))
  await reorderSections(orders)
  await loadMeta()
}

async function onLineReorder(sectionId) {
  const sectionLines = draggableLinesMap.value[sectionId] || []
  const orders = sectionLines.map((l, i) => ({ id: l._id, order: i }))
  await reorderTemplateLines(orders)
}

async function onIncomeReorder() {
  const orders = draggableIncomeLines.value.map((l, i) => ({ id: l._id, order: i }))
  await reorderTemplateLines(orders)
}

// ─── Ajout revenus ───────────────────────────────────────
function startAddIncome() {
  addingIncome.value = true
  newIncomeLine.value = defaultIncomeLine()
}

function cancelAddIncome() {
  addingIncome.value = false
  newIncomeLine.value = defaultIncomeLine()
}

async function submitAddIncome() {
  if (!newIncomeLine.value.label.trim()) return
  const data = { ...newIncomeLine.value }
  if (!data.toAccount) delete data.toAccount
  await createTemplateLine(data)
  cancelAddIncome()
  await loadLines()
}

// ─── Ajout dépenses ──────────────────────────────────────
function startAdd(sectionId) {
  addingSectionId.value = sectionId
  newLine.value = { ...defaultLine(), section: sectionId === 'none' ? '' : sectionId }
}

function cancelAdd() {
  addingSectionId.value = null
  newLine.value = defaultLine()
}

async function submitAdd() {
  if (!newLine.value.label.trim()) return
  const data = { ...newLine.value }
  if (!data.section) delete data.section
  if (!data.theme) delete data.theme
  if (!data.fromAccount) delete data.fromAccount
  if (!data.toAccount) delete data.toAccount
  if (data.recurringDay === '' || data.recurringDay == null) delete data.recurringDay
  else data.recurringDay = Number(data.recurringDay)
  await createTemplateLine(data)
  cancelAdd()
  await loadLines()
}

// ─── Édition inline ──────────────────────────────────────
function startEdit(line) {
  editingId.value = line._id
  editBuffer.value = {
    label: line.label,
    plannedAmount: line.plannedAmount,
    flow: line.flow,
    type: line.type,
    section: line.section?._id || '',
    theme: line.theme?._id || '',
    fromAccount: line.fromAccount?._id || '',
    toAccount: line.toAccount?._id || '',
    paymentMethod: line.paymentMethod || 'CB',
    isShared: line.isShared,
    recurringDay: line.recurringDay || '',
    notes: line.notes || '',
  }
}

function cancelEdit() {
  editingId.value = null
  editBuffer.value = {}
}

async function saveEdit(id) {
  const data = { ...editBuffer.value }
  if (!data.section) delete data.section
  if (!data.theme) delete data.theme
  if (!data.fromAccount) delete data.fromAccount
  if (!data.toAccount) delete data.toAccount
  data.recurringDay =
    data.recurringDay === '' || data.recurringDay == null ? null : Number(data.recurringDay)
  await updateTemplateLine(id, data)
  cancelEdit()
  await loadLines()
}

async function removeLine(id) {
  await deleteTemplateLine(id)
  await loadLines()
}

// ─── Helpers ─────────────────────────────────────────────
const paymentMethods = ['CB', 'virement', 'especes', 'autre']

// ─── Modal ligne (ajout / édition) ───────────────────────
const modalOpen = ref(false)
const modalMode = ref('add') // 'add' | 'edit'
const modalSectionId = ref(null)
const modalLine = ref(null)
const form = ref({})

const accountOptions = computed(() => accounts.value.map((a) => ({ value: a._id, label: a.name })))
const paymentOptions = computed(() => paymentMethods.map((m) => ({ value: m, label: m })))
const typeOptions = [
  { value: 'fixed', label: 'Fixe' },
  { value: 'variable', label: 'Variable' },
]

function openAddModal(sectionId) {
  modalMode.value = 'add'
  modalSectionId.value = sectionId
  modalLine.value = null
  form.value = {
    flow: 'expense',
    label: '',
    plannedAmount: 0,
    type: 'fixed',
    fromAccount: settings.value?.mainAccount?._id || settings.value?.mainAccount || '',
    toAccount: '',
    paymentMethod: 'CB',
    isShared: false,
    recurringDay: '',
    theme: null,
  }
  modalOpen.value = true
}

function openAddIncomeModal() {
  modalMode.value = 'add'
  modalSectionId.value = null
  modalLine.value = null
  form.value = { flow: 'income', label: '', plannedAmount: 0, toAccount: '' }
  modalOpen.value = true
}

function openEditModal(line) {
  modalMode.value = 'edit'
  modalLine.value = line
  form.value = {
    flow: line.flow,
    label: line.label || '',
    plannedAmount: line.plannedAmount || 0,
    type: line.type || 'fixed',
    fromAccount: line.fromAccount?._id || line.fromAccount || '',
    toAccount: line.toAccount?._id || line.toAccount || '',
    paymentMethod: line.paymentMethod || 'CB',
    isShared: !!line.isShared,
    recurringDay: line.recurringDay || '',
    theme: line.theme?._id || line.theme || null,
  }
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
}

async function saveModal() {
  const f = form.value
  if (!f.label.trim()) return
  const editing = modalMode.value === 'edit'
  const clearable = (v) => (v || (editing ? null : undefined))

  let data
  if (f.flow === 'income') {
    data = {
      label: f.label,
      plannedAmount: f.plannedAmount,
      flow: 'income',
      toAccount: clearable(f.toAccount),
    }
  } else {
    data = {
      label: f.label,
      plannedAmount: f.plannedAmount,
      flow: 'expense',
      type: f.type,
      isShared: f.isShared,
      fromAccount: clearable(f.fromAccount),
      toAccount: clearable(f.toAccount),
      paymentMethod: f.paymentMethod || undefined,
      theme: clearable(f.theme),
      recurringDay:
        f.recurringDay === '' || f.recurringDay == null
          ? editing
            ? null
            : undefined
          : Number(f.recurringDay),
    }
  }
  if (!editing && modalSectionId.value && modalSectionId.value !== 'none') {
    data.section = modalSectionId.value
  }

  if (editing) await updateTemplateLine(modalLine.value._id, data)
  else await createTemplateLine(data)

  modalOpen.value = false
  await loadLines()
}

async function deleteFromModal() {
  if (modalLine.value) await deleteTemplateLine(modalLine.value._id)
  modalOpen.value = false
  await loadLines()
}
</script>

<template>
  <div>
    <!-- Header -->
    <div class="flex items-start justify-between mb-7">
      <div>
        <h1 class="text-[22px] font-semibold text-gray-950 dark:text-gray-50">Template</h1>
        <p class="text-[13px] text-gray-400 mt-0.5">Lignes budgétaires par défaut — dupliquées à chaque nouveau mois</p>
      </div>
    </div>

    <div class="flex flex-col gap-4">

      <!-- ─── Bloc Revenus ──────────────────────────────────── -->
      <div class="glass-card overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-green-950/30 border-b border-green-100 dark:border-green-900/40">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full shrink-0 bg-green-600"></span>
            <span class="text-[14px] font-semibold text-gray-950 dark:text-gray-50">Revenus</span>
            <span class="text-[12px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full px-1.5 py-px">{{ draggableIncomeLines.length }}</span>
          </div>
          <button
            class="flex items-center gap-1.5 text-[12.5px] text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40 border-none rounded-md px-2.5 py-1.25 cursor-pointer font-medium hover:bg-green-200 dark:hover:bg-green-900/60"
            @click="openAddIncomeModal"
          >
            <font-awesome-icon icon="plus" /> Ajouter
          </button>
        </div>

        <div v-if="draggableIncomeLines.length || addingIncome" class="lines-table">
          <div class="table-head table-head--income dark:bg-gray-800 dark:border-gray-700">
            <span></span>
            <span class="col-label">Description</span>
            <span class="col-amount">Montant</span>
            <span class="col-account">Vers (compte)</span>
            <span class="col-actions"></span>
          </div>
          <draggable
            v-model="draggableIncomeLines"
            item-key="_id"
            handle=".line-drag-handle"
            ghost-class="drag-ghost"
            @end="onIncomeReorder"
          >
            <template #item="{ element: line }">
              <div v-if="editingId === line._id" class="table-row table-row--income table-row--editing">
                <span class="line-drag-handle drag-handle">⠿</span>
                <input v-model="editBuffer.label" class="input-cell" placeholder="Description" />
                <input v-model.number="editBuffer.plannedAmount" type="number" class="input-cell input-cell--sm" />
                <select v-model="editBuffer.toAccount" class="select-cell">
                  <option value="">— Compte —</option>
                  <option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option>
                </select>
                <div class="row-actions">
                  <button class="btn-save" @click="saveEdit(line._id)">Sauver</button>
                  <button class="btn-cancel" @click="cancelEdit">✕</button>
                </div>
              </div>
              <div v-else class="table-row table-row--income">
                <span class="line-drag-handle drag-handle">⠿</span>
                <span class="col-label row-label row-label--income">{{ line.label }}</span>
                <span class="col-amount row-amount row-amount--income">{{ line.plannedAmount > 0 ? line.plannedAmount + ' €' : '—' }}</span>
                <span class="col-account row-text">{{ line.toAccount?.name || '—' }}</span>
                <div class="row-actions">
                  <button class="btn-edit" @click="openEditModal(line)">Modifier</button>
                  <button class="btn-delete" @click="removeLine(line._id)">✕</button>
                </div>
              </div>
            </template>
          </draggable>

          <div v-if="addingIncome" class="table-row table-row--income table-row--adding">
            <span></span>
            <input v-model="newIncomeLine.label" class="input-cell" placeholder="Ex: Salaire" @keyup.enter="submitAddIncome" autofocus />
            <input v-model.number="newIncomeLine.plannedAmount" type="number" class="input-cell input-cell--sm" placeholder="0" />
            <select v-model="newIncomeLine.toAccount" class="select-cell">
              <option value="">— Compte —</option>
              <option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option>
            </select>
            <div class="row-actions">
              <button class="btn-save btn-save--income" @click="submitAddIncome">Ajouter</button>
              <button class="btn-cancel" @click="cancelAddIncome">✕</button>
            </div>
          </div>
        </div>

        <div v-else class="flex items-center justify-center gap-1.5 py-3.5 text-[12.5px] text-gray-300 dark:text-gray-600 cursor-pointer hover:text-gray-400 dark:hover:text-gray-500" @click="openAddIncomeModal">
          <font-awesome-icon icon="plus" /> Ajouter un revenu
        </div>
      </div>

      <!-- ─── Sections dépenses (draggables) ───────────────── -->
      <draggable
        v-model="draggableSections"
        item-key="_id"
        handle=".section-drag-handle"
        ghost-class="drag-ghost"
        @end="onSectionReorder"
      >
        <template #item="{ element: section }">
          <div class="glass-card overflow-hidden">
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/60">
              <div class="flex items-center gap-2">
                <span class="section-drag-handle drag-handle" title="Réordonner">⠿</span>
                <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: section.color || '#d1d5db' }"></span>
                <span class="text-[14px] font-semibold text-gray-950 dark:text-gray-50">{{ section.name }}</span>
                <span class="text-[12px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full px-1.5 py-px">{{ (draggableLinesMap[section._id] || []).length }}</span>
              </div>
              <button
                class="flex items-center gap-1.5 text-[12.5px] text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 border-none rounded-md px-2.5 py-1.25 cursor-pointer font-medium hover:bg-violet-100 dark:hover:bg-violet-950/60"
                @click="openAddModal(section._id)"
              >
                <font-awesome-icon icon="plus" /> Ajouter
              </button>
            </div>
            <div class="lines-table" v-if="(draggableLinesMap[section._id] || []).length || addingSectionId === section._id">
              <div class="table-head dark:bg-gray-800 dark:border-gray-700">
                <span></span>
                <span class="col-label">Description</span>
                <span class="col-amount">Montant</span>
                <span class="col-day">Jour</span>
                <span class="col-account">Depuis</span>
                <span class="col-account">Vers</span>
                <span class="col-payment">Paiement</span>
                <span class="col-theme">Thème</span>
                <span class="col-check">½</span>
                <span class="col-actions"></span>
              </div>
              <draggable
                :list="draggableLinesMap[section._id]"
                item-key="_id"
                handle=".line-drag-handle"
                ghost-class="drag-ghost"
                @end="onLineReorder(section._id)"
              >
                <template #item="{ element: line }">
                  <div v-if="editingId === line._id" class="table-row table-row--editing">
                    <span class="line-drag-handle drag-handle">⠿</span>
                    <input v-model="editBuffer.label" class="input-cell" placeholder="Description" />
                    <input v-model.number="editBuffer.plannedAmount" type="number" class="input-cell input-cell--sm" />
                    <input v-model.number="editBuffer.recurringDay" type="number" min="1" max="31" class="input-cell input-cell--sm" placeholder="Jour" />
                    <select v-model="editBuffer.fromAccount" class="select-cell"><option value="">—</option><option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option></select>
                    <select v-model="editBuffer.toAccount" class="select-cell"><option value="">—</option><option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option></select>
                    <select v-model="editBuffer.paymentMethod" class="select-cell"><option v-for="m in paymentMethods" :key="m" :value="m">{{ m }}</option></select>
                    <select v-model="editBuffer.theme" class="select-cell"><option value="">—</option><option v-for="t in themes" :key="t._id" :value="t._id">{{ t.name }}</option></select>
                    <input type="checkbox" v-model="editBuffer.isShared" class="check-cell" />
                        <div class="row-actions">
                      <button class="btn-save" @click="saveEdit(line._id)">Sauver</button>
                      <button class="btn-cancel" @click="cancelEdit">✕</button>
                    </div>
                  </div>
                  <div v-else class="table-row">
                    <span class="line-drag-handle drag-handle">⠿</span>
                    <span class="col-label row-label">{{ line.label }}</span>
                    <span class="col-amount row-amount">{{ line.plannedAmount > 0 ? line.plannedAmount + ' €' : '—' }}</span>
                    <span class="col-day row-text">{{ line.recurringDay || '—' }}</span>
                    <span class="col-account row-text">{{ line.fromAccount?.name || '—' }}</span>
                    <span class="col-account row-text">{{ line.toAccount?.name || '—' }}</span>
                    <span class="col-payment row-text">{{ line.paymentMethod || '—' }}</span>
                    <span class="col-theme">
                      <span v-if="line.theme" class="theme-badge" :style="{ background: line.theme.color + '22', color: line.theme.color }">{{ line.theme.name }}</span>
                      <span v-else class="row-text">—</span>
                    </span>
                    <span class="col-check"><span v-if="line.isShared" class="check-on">✓</span></span>
                    <div class="row-actions">
                      <button class="btn-edit" @click="openEditModal(line)">Modifier</button>
                      <button class="btn-delete" @click="removeLine(line._id)">✕</button>
                    </div>
                  </div>
                </template>
              </draggable>
              <div v-if="addingSectionId === section._id" class="table-row table-row--adding">
                <span></span>
                <input v-model="newLine.label" class="input-cell" placeholder="Description" @keyup.enter="submitAdd" autofocus />
                <input v-model.number="newLine.plannedAmount" type="number" class="input-cell input-cell--sm" placeholder="0" />
                <input v-model.number="newLine.recurringDay" type="number" min="1" max="31" class="input-cell input-cell--sm" placeholder="Jour" />
                <select v-model="newLine.fromAccount" class="select-cell"><option value="">—</option><option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option></select>
                <select v-model="newLine.toAccount" class="select-cell"><option value="">—</option><option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option></select>
                <select v-model="newLine.paymentMethod" class="select-cell"><option v-for="m in paymentMethods" :key="m" :value="m">{{ m }}</option></select>
                <select v-model="newLine.theme" class="select-cell"><option value="">—</option><option v-for="t in themes" :key="t._id" :value="t._id">{{ t.name }}</option></select>
                <input type="checkbox" v-model="newLine.isShared" class="check-cell" />
                <div class="row-actions">
                  <button class="btn-save" @click="submitAdd">Ajouter</button>
                  <button class="btn-cancel" @click="cancelAdd">✕</button>
                </div>
              </div>
            </div>
            <div v-else class="flex items-center justify-center gap-1.5 py-3.5 text-[12.5px] text-gray-300 dark:text-gray-600 cursor-pointer hover:text-gray-400 dark:hover:text-gray-500" @click="openAddModal(section._id)">
              <font-awesome-icon icon="plus" /> Ajouter une ligne
            </div>
          </div>
        </template>
      </draggable>

      <!-- Section "Sans section" (toujours en bas, non draggable) -->
      <div v-if="(draggableLinesMap['none'] || []).length || addingSectionId === 'none'" class="glass-card overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700/60">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full shrink-0 bg-gray-300 dark:bg-gray-600"></span>
            <span class="text-[14px] font-semibold text-gray-950 dark:text-gray-50">Sans section</span>
            <span class="text-[12px] text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-full px-1.5 py-px">{{ (draggableLinesMap['none'] || []).length }}</span>
          </div>
          <button
            class="flex items-center gap-1.5 text-[12.5px] text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 border-none rounded-md px-2.5 py-1.25 cursor-pointer font-medium hover:bg-violet-100 dark:hover:bg-violet-950/60"
            @click="openAddModal('none')"
          >
            <font-awesome-icon icon="plus" /> Ajouter
          </button>
        </div>
        <div class="lines-table">
          <div class="table-head dark:bg-gray-800 dark:border-gray-700">
            <span></span>
            <span class="col-label">Description</span>
            <span class="col-amount">Montant</span>
            <span class="col-account">Depuis</span>
            <span class="col-account">Vers</span>
            <span class="col-payment">Paiement</span>
            <span class="col-theme">Thème</span>
            <span class="col-check">½</span>
            <span class="col-actions"></span>
          </div>
          <template v-for="line in draggableLinesMap['none'] || []" :key="line._id">
            <div v-if="editingId === line._id" class="table-row table-row--editing">
              <span></span>
              <input v-model="editBuffer.label" class="input-cell" placeholder="Description" />
              <input v-model.number="editBuffer.plannedAmount" type="number" class="input-cell input-cell--sm" />
              <input v-model.number="editBuffer.recurringDay" type="number" min="1" max="31" class="input-cell input-cell--sm" placeholder="Jour" />
              <select v-model="editBuffer.fromAccount" class="select-cell"><option value="">—</option><option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option></select>
              <select v-model="editBuffer.toAccount" class="select-cell"><option value="">—</option><option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option></select>
              <select v-model="editBuffer.paymentMethod" class="select-cell"><option v-for="m in paymentMethods" :key="m" :value="m">{{ m }}</option></select>
              <select v-model="editBuffer.theme" class="select-cell"><option value="">—</option><option v-for="t in themes" :key="t._id" :value="t._id">{{ t.name }}</option></select>
              <input type="checkbox" v-model="editBuffer.isShared" class="check-cell" />
              <div class="row-actions"><button class="btn-save" @click="saveEdit(line._id)">Sauver</button><button class="btn-cancel" @click="cancelEdit">✕</button></div>
            </div>
            <div v-else class="table-row">
              <span></span>
              <span class="col-label row-label">{{ line.label }}</span>
              <span class="col-amount row-amount">{{ line.plannedAmount > 0 ? line.plannedAmount + ' €' : '—' }}</span>
              <span class="col-day row-text">{{ line.recurringDay || '—' }}</span>
              <span class="col-account row-text">{{ line.fromAccount?.name || '—' }}</span>
              <span class="col-account row-text">{{ line.toAccount?.name || '—' }}</span>
              <span class="col-payment row-text">{{ line.paymentMethod || '—' }}</span>
              <span class="col-theme"><span v-if="line.theme" class="theme-badge" :style="{ background: line.theme.color + '22', color: line.theme.color }">{{ line.theme.name }}</span><span v-else class="row-text">—</span></span>
              <span class="col-check"><span v-if="line.isShared" class="check-on">✓</span></span>
              <div class="row-actions"><button class="btn-edit" @click="openEditModal(line)">Modifier</button><button class="btn-delete" @click="removeLine(line._id)">✕</button></div>
            </div>
          </template>
          <div v-if="addingSectionId === 'none'" class="table-row table-row--adding">
            <span></span>
            <input v-model="newLine.label" class="input-cell" placeholder="Description" @keyup.enter="submitAdd" autofocus />
            <input v-model.number="newLine.plannedAmount" type="number" class="input-cell input-cell--sm" placeholder="0" />
            <input v-model.number="newLine.recurringDay" type="number" min="1" max="31" class="input-cell input-cell--sm" placeholder="Jour" />
            <select v-model="newLine.fromAccount" class="select-cell"><option value="">—</option><option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option></select>
            <select v-model="newLine.toAccount" class="select-cell"><option value="">—</option><option v-for="a in accounts" :key="a._id" :value="a._id">{{ a.name }}</option></select>
            <select v-model="newLine.paymentMethod" class="select-cell"><option v-for="m in paymentMethods" :key="m" :value="m">{{ m }}</option></select>
            <select v-model="newLine.theme" class="select-cell"><option value="">—</option><option v-for="t in themes" :key="t._id" :value="t._id">{{ t.name }}</option></select>
            <input type="checkbox" v-model="newLine.isShared" class="check-cell" />
            <div class="row-actions"><button class="btn-save" @click="submitAdd">Ajouter</button><button class="btn-cancel" @click="cancelAdd">✕</button></div>
          </div>
        </div>
      </div>

    </div>

    <!-- ─── Modal ligne (ajout / édition) ─────────────────── -->
    <AppModal
      v-if="modalOpen"
      :title="(modalMode === 'add' ? 'Nouvelle ligne' : 'Modifier la ligne') + (form.flow === 'income' ? ' (revenu)' : '')"
      @close="closeModal"
    >
      <div class="form-grid">
        <div class="form-field">
          <label class="form-label">Description</label>
          <input
            v-model="form.label"
            class="form-input"
            placeholder="Ex: Loyer"
            @keyup.enter="saveModal"
          />
        </div>

        <div class="form-field">
          <label class="form-label">Montant prévu (€)</label>
          <input
            v-model.number="form.plannedAmount"
            type="number"
            step="0.01"
            class="form-input"
            placeholder="0"
          />
        </div>

        <div v-if="form.flow === 'income'" class="form-field">
          <label class="form-label">Vers (compte)</label>
          <ChipSelect v-model="form.toAccount" :options="accountOptions" allow-none />
        </div>

        <template v-else>
          <div class="form-row">
            <div class="form-field">
              <label class="form-label">Type</label>
              <ChipSelect v-model="form.type" :options="typeOptions" />
            </div>
            <div class="form-field form-field--grow">
              <label class="form-label">Jour du mois (facture récurrente)</label>
              <input
                v-model.number="form.recurringDay"
                type="number"
                min="1"
                max="31"
                class="form-input"
                placeholder="ex: 5"
              />
            </div>
          </div>
          <div class="form-field">
            <label class="form-label">Depuis</label>
            <ChipSelect v-model="form.fromAccount" :options="accountOptions" allow-none />
          </div>
          <div class="form-field">
            <label class="form-label">Vers</label>
            <ChipSelect v-model="form.toAccount" :options="accountOptions" allow-none />
          </div>
          <div class="form-field">
            <label class="form-label">Mode de paiement</label>
            <ChipSelect v-model="form.paymentMethod" :options="paymentOptions" />
          </div>
          <div class="form-row">
            <div class="form-field form-field--grow">
              <label class="form-label">Thème</label>
              <ThemeSelect v-model="form.theme" :themes="themes" />
            </div>
            <div class="form-field">
              <label class="form-label">Partagé ½</label>
              <button
                type="button"
                class="toggle-half"
                :class="{ 'toggle-half--on': form.isShared }"
                @click="form.isShared = !form.isShared"
              >
                {{ form.isShared ? '½ Activé' : '½ Désactivé' }}
              </button>
            </div>
          </div>
        </template>
      </div>

      <template #footer>
        <button
          v-if="modalMode === 'edit'"
          class="modal-btn modal-btn--danger"
          @click="deleteFromModal"
        >
          Supprimer
        </button>
        <button class="modal-btn modal-btn--secondary" @click="closeModal">Annuler</button>
        <button class="modal-btn modal-btn--primary" @click="saveModal">
          {{ modalMode === 'add' ? 'Ajouter' : 'Sauver' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* ─── Table intérieure (grids complexes, gardés en CSS) ── */

.table-head--income,
.table-row--income {
  grid-template-columns: 20px 1fr 90px 160px 120px !important;
}

.table-head {
  display: grid;
  grid-template-columns: 20px 1fr 80px 55px 110px 110px 90px 110px 30px 120px;
  padding: 6px 16px;
  background: #f9fafb;
  border-bottom: 1px solid #f3f4f6;
  font-size: 11px;
  font-weight: 500;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

:global(.dark) .table-head {
  background: #1f2937;
  border-bottom-color: #374151;
}

.table-row {
  display: grid;
  grid-template-columns: 20px 1fr 80px 55px 110px 110px 90px 110px 30px 120px;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #f9fafb;
  gap: 4px;
}

:global(.dark) .table-row { border-bottom-color: #374151; }
.table-row:last-child { border-bottom: none; }

.table-row--editing,
.table-row--adding { background: #fefce8; }
:global(.dark) .table-row--editing,
:global(.dark) .table-row--adding { background: #422006; }

.table-row--income.table-row--editing,
.table-row--income.table-row--adding { background: #f0fdf4; }
:global(.dark) .table-row--income.table-row--editing,
:global(.dark) .table-row--income.table-row--adding { background: #052e16; }

.row-label { font-size: 13.5px; font-weight: 500; color: #374151; }
:global(.dark) .row-label { color: #d1d5db; }
.row-label--income { color: #16a34a; }
.row-amount { font-size: 13px; font-weight: 600; color: #1a1a1a; }
:global(.dark) .row-amount { color: #f3f4f6; }
.row-amount--income { color: #16a34a; }
.row-text { font-size: 12.5px; color: #6b7280; }
:global(.dark) .row-text { color: #9ca3af; }

.theme-badge { font-size: 11.5px; padding: 2px 8px; border-radius: 20px; font-weight: 500; }
.check-on { font-size: 13px; color: #7c3aed; font-weight: 600; }

.input-cell {
  width: 100%;
  padding: 5px 7px;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  font-size: 12.5px;
  outline: none;
  background: white;
  color: #1a1a1a;
}
:global(.dark) .input-cell { background: #374151; border-color: #4b5563; color: #f3f4f6; }
.input-cell:focus { border-color: #7c3aed; }
.input-cell--sm { max-width: 72px; }

.select-cell {
  width: 100%;
  padding: 5px 4px;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  font-size: 12px;
  background: white;
  color: #1a1a1a;
  outline: none;
  cursor: pointer;
}
:global(.dark) .select-cell { background: #374151; border-color: #4b5563; color: #f3f4f6; }

.check-cell { cursor: pointer; width: 15px; height: 15px; margin: 0 auto; display: block; }

.row-actions { display: flex; gap: 6px; justify-content: flex-end; }

.btn-edit { font-size: 12px; color: #7c3aed; background: none; border: none; cursor: pointer; padding: 2px 4px; }
.btn-edit:hover { text-decoration: underline; }
.btn-delete { font-size: 12px; color: #ef4444; background: none; border: none; cursor: pointer; padding: 2px 4px; }
.btn-save { font-size: 12px; color: white; background: #7c3aed; border: none; border-radius: 5px; padding: 3px 8px; cursor: pointer; font-weight: 500; }
.btn-save--income { background: #16a34a; }
.btn-cancel { font-size: 12px; color: #6b7280; background: none; border: none; cursor: pointer; }
:global(.dark) .btn-cancel { color: #9ca3af; }

.drag-handle { cursor: grab; color: #d1d5db; font-size: 14px; user-select: none; display: flex; align-items: center; }
.drag-handle:hover { color: #9ca3af; }
.drag-handle:active { cursor: grabbing; }
:global(.dark) .drag-handle { color: #4b5563; }
:global(.dark) .drag-handle:hover { color: #6b7280; }

.drag-ghost { opacity: 0.4; background: #f5f3ff !important; }
.lines-table { width: 100%; }

/* ─── Formulaire dans le modal ─────────────────────────── */
.form-grid { display: flex; flex-direction: column; gap: 16px; }
.form-row { display: flex; gap: 14px; flex-wrap: wrap; }
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field--grow { flex: 1; min-width: 160px; }
.form-label {
  font-size: 11.5px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.03em; color: #9ca3af;
}
.form-input {
  padding: 8px 10px; border: 1.5px solid #e5e7eb; border-radius: 8px;
  font-size: 13px; outline: none; background: #fff; color: #1a1a1a;
}
.form-input:focus { border-color: #7c3aed; }
:global(.dark) .form-input { background: #374151; border-color: #4b5563; color: #f3f4f6; }
.toggle-half {
  padding: 7px 14px; border: 1.5px solid #e5e7eb; border-radius: 8px;
  background: #fff; color: #6b7280; font-size: 12.5px; cursor: pointer; white-space: nowrap;
}
.toggle-half--on { border-color: #7c3aed; background: #f5f3ff; color: #7c3aed; font-weight: 600; }
:global(.dark) .toggle-half { background: #374151; border-color: #4b5563; color: #9ca3af; }
:global(.dark) .toggle-half--on { background: rgba(124,58,237,0.22); border-color: #8b5cf6; color: #c4b5fd; }
.modal-btn {
  padding: 8px 16px; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 500; cursor: pointer;
}
.modal-btn--primary { background: #7c3aed; color: #fff; }
.modal-btn--primary:hover { background: #6d28d9; }
.modal-btn--secondary { background: #f1f5f9; color: #475569; }
:global(.dark) .modal-btn--secondary { background: #374151; color: #d1d5db; }
.modal-btn--danger { background: none; color: #ef4444; margin-right: auto; }
.modal-btn--danger:hover { text-decoration: underline; }
</style>
