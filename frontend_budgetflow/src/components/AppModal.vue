<script setup>
defineProps({
  title: { type: String, default: '' },
})
const emit = defineEmits(['close'])
</script>

<template>
  <teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-card">
        <div class="modal-header">
          <h3 class="modal-title">{{ title }}</h3>
          <button class="modal-close" @click="emit('close')" title="Fermer">✕</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.40);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20px;
  backdrop-filter: blur(6px) saturate(140%);
  -webkit-backdrop-filter: blur(6px) saturate(140%);
}
.modal-card {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0.70));
  backdrop-filter: blur(34px) saturate(185%);
  -webkit-backdrop-filter: blur(34px) saturate(185%);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 18px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 32px 70px -18px rgba(40, 30, 90, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  overflow: hidden;
}
:global(.dark) .modal-card {
  background: linear-gradient(135deg, rgba(34, 40, 64, 0.86), rgba(22, 27, 45, 0.74));
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow:
    0 32px 70px -18px rgba(0, 0, 0, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f1f5f9;
}
:global(.dark) .modal-header {
  border-bottom-color: #374151;
}
.modal-title {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
}
:global(.dark) .modal-title {
  color: #f1f5f9;
}
.modal-close {
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
  padding: 4px;
}
.modal-close:hover {
  color: #ef4444;
}
.modal-body {
  padding: 18px 20px;
  overflow-y: auto;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid #f1f5f9;
}
:global(.dark) .modal-footer {
  border-top-color: #374151;
}
</style>
