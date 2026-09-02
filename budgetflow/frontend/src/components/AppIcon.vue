<script setup>
// Icône Phosphor par nom, depuis le registre src/plugins/icons.js.
// <AppIcon name="PhHeart" :size="20" weight="fill" class="text-violet-600" />
// Poids : thin · light · regular (défaut) · bold · fill · duotone. La couleur suit
// la couleur de texte courante (currentColor) — pilotable en classe Tailwind.
import { computed } from 'vue'
import { icons } from '@/plugins/icons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
  weight: { type: String, default: 'regular' },
})

const icon = computed(() => {
  const c = icons[props.name]
  if (!c) console.warn(`[AppIcon] icône inconnue « ${props.name} » — l'ajouter dans src/plugins/icons.js`)
  return c || null
})
</script>

<template>
  <component :is="icon" v-if="icon" :size="size" :weight="weight" />
</template>
