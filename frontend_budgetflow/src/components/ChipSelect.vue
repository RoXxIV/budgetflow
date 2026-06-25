<script setup>
const props = defineProps({
  modelValue: { default: null },
  options: { type: Array, required: true }, // [{ value, label }]
  allowNone: { type: Boolean, default: false },
  noneLabel: { type: String, default: '—' },
})
const emit = defineEmits(['update:modelValue'])

function isNone(v) {
  return v === null || v === undefined || v === ''
}
function isActive(val) {
  if (val === null) return isNone(props.modelValue)
  return props.modelValue === val
}
function select(val) {
  emit('update:modelValue', val)
}
</script>

<template>
  <div class="chip-row">
    <button
      v-if="allowNone"
      type="button"
      class="chip"
      :class="{ 'chip--active': isActive(null) }"
      @click="select(null)"
    >
      {{ noneLabel }}
    </button>
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="chip"
      :class="{ 'chip--active': isActive(o.value) }"
      @click="select(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 6px 12px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.chip:hover {
  border-color: #ddd6fe;
}
.chip--active {
  border-color: #7c3aed;
  background: #f5f3ff;
  color: #7c3aed;
  font-weight: 600;
}
:global(.dark) .chip {
  background: #374151;
  border-color: #4b5563;
  color: #d1d5db;
}
:global(.dark) .chip:hover {
  border-color: #8b5cf6;
}
:global(.dark) .chip--active {
  background: rgba(124, 58, 237, 0.22);
  border-color: #8b5cf6;
  color: #c4b5fd;
}
</style>
