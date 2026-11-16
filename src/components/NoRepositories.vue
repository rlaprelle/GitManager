<script setup lang="ts">
import GmIcon from './GmIcon.vue'

withDefaults(defineProps<{ canClone?: boolean }>(), { canClone: true })

defineEmits<{ add: []; clone: [] }>()
</script>

<!-- First run in the desktop app: no repositories yet. -->
<template>
  <div class="flex flex-auto items-center justify-center p-6">
    <section class="flex max-w-[420px] flex-col items-start gap-4 rounded-xl border border-gm-line-strong bg-gm-main p-8">
      <GmIcon name="folder" :size="28" :stroke-width="1.6" class="text-gm-accent" />
      <h1 class="m-0 text-[18px] font-semibold">Add a repository to get started</h1>
      <p class="m-0 text-gm-soft">
        Add a folder that holds a git repository (or any folder inside one), or clone a repository from its URL.
        Browsing never changes a repository: only a button you click, such as Checkout, does.
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 bg-gm-accent px-3.5 font-semibold text-gm-on-accent"
          @click="$emit('add')"
        >
          <GmIcon name="plus" />
          Add repository…
        </button>
        <button
          v-if="canClone"
          type="button"
          class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-gm-line-strong bg-gm-raised px-3.5 text-gm-text hover:bg-gm-hover"
          @click="$emit('clone')"
        >
          <GmIcon name="clone" />
          Clone repository…
        </button>
      </div>
    </section>
  </div>
</template>
