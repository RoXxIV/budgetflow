<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: { default: null }, // theme _id ou null
  themes: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])

const query = ref('')
const open = ref(false)

const selected = computed(
  () => props.themes.find((t) => t._id === props.modelValue) || null,
)
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.themes
  return props.themes.filter((t) => t.name.toLowerCase().includes(q))
})

function choose(t) {
  emit('update:modelValue', t ? t._id : null)
  query.value = ''
  open.value = false
}
function onFocus() {
  open.value = true
  query.value = ''
}
function onBlur() {
  // léger délai pour laisser le clic d'option se déclencher
  setTimeout(() => {
    open.value = false
    query.value = ''
  }, 150)
}
</script>

<template>
  <div class="theme-select">
    <input
      class="theme-input"
      :value="open ? query : selected ? selected.name : ''"
      :placeholder="selected ? selected.name : '— Thème —'"
      @input="query = $event.target.value"
      @focus="onFocus"
      @blur="onBlur"
    />
    <div v-if="open" class="theme-dropdown">
      <div class="theme-option theme-option--none" @mousedown.prevent="choose(null)">— Aucun —</div>
      <div
        v-for="t in filtered"
        :key="t._id"
        class="theme-option"
        @mousedown.prevent="choose(t)"
      >
        <span class="theme-dot" :style="{ background: t.color || '#d1d5db' }"></span>
        {{ t.name }}
      </div>
      <div v-if="!filtered.length" class="theme-empty">Aucun thème</div>
    </div>
  </div>
</template>

<style scoped>
.theme-select {
  position: relative;
  width: 100%;
}
.theme-input {
  width: 100%;
  padding: 7px 10px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  background: #fff;
  color: #1a1a1a;
}
.theme-input:focus {
  border-color: #7c3aed;
}
:global(.dark) .theme-input {
  background: #374151;
  border-color: #4b5563;
  color: #f3f4f6;
}
.theme-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.12);
  max-height: 220px;
  overflow-y: auto;
  z-index: 10;
}
:global(.dark) .theme-dropdown {
  background: #1f2937;
  border-color: #374151;
}
.theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 12.5px;
  color: #374151;
  cursor: pointer;
}
.theme-option:hover {
  background: #f3f4f6;
}
:global(.dark) .theme-option {
  color: #d1d5db;
}
:global(.dark) .theme-option:hover {
  background: #374151;
}
.theme-option--none {
  color: #9ca3af;
}
.theme-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}
.theme-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: #9ca3af;
}
</style>
