<script setup lang="ts">
export type IconName =
  | 'logo'
  | 'branch'
  | 'remote-branch'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'plus'
  | 'folder'
  | 'compare'
  | 'back'
  | 'swap'

withDefaults(defineProps<{ name: IconName; size?: number; strokeWidth?: number }>(), {
  size: 16,
  strokeWidth: 2,
})
</script>

<!-- Stroke icons from the design; colour follows the surrounding text colour. -->
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <template v-if="name === 'logo'">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="9" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M18 11.5c0 4-6 3-11 5" />
    </template>
    <template v-else-if="name === 'branch'">
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="7" r="2" />
      <path d="M6 7v10" />
      <path d="M18 9c0 5-6 4-12 8" />
    </template>
    <template v-else-if="name === 'remote-branch'">
      <path d="M4 15a4 4 0 0 1 3-6.9A5 5 0 0 1 16.6 9 3.5 3.5 0 0 1 19 15.8" />
      <path d="M12 12v8" />
      <path d="M9 17l3 3 3-3" />
    </template>
    <template v-else-if="name === 'fetch'">
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </template>
    <template v-else-if="name === 'pull'">
      <path d="M12 4v13" />
      <path d="M6 11l6 6 6-6" />
      <path d="M5 20h14" />
    </template>
    <template v-else-if="name === 'push'">
      <path d="M12 20V7" />
      <path d="M6 13l6-6 6 6" />
      <path d="M5 4h14" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </template>
    <template v-else-if="name === 'compare'">
      <rect x="3" y="4" width="7.5" height="16" rx="1.5" />
      <rect x="13.5" y="4" width="7.5" height="16" rx="1.5" />
    </template>
    <template v-else-if="name === 'back'">
      <path d="M15 6l-6 6 6 6" />
    </template>
    <template v-else-if="name === 'swap'">
      <path d="M4 8h14" />
      <path d="M14 4l4 4-4 4" />
      <path d="M20 16H6" />
      <path d="M10 12l-4 4 4 4" />
    </template>
  </svg>
</template>
