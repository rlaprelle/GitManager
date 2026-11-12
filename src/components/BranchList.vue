<script setup lang="ts">
import type { LocalBranch, RemoteBranch } from '@/types/git'
import { syncLabel } from '@/lib/format'
import GmIcon from './GmIcon.vue'

withDefaults(
  defineProps<{
    localBranches: LocalBranch[]
    remoteBranches: RemoteBranch[]
    currentBranch: string
    selectedBranch: string | null
    /** False hides Checkout (the desktop app is read-only for now). */
    writable?: boolean
  }>(),
  { writable: true },
)

defineEmits<{ select: [name: string]; checkout: [name: string] }>()
</script>

<template>
  <section class="min-h-0 flex-auto overflow-auto border-t border-gm-line px-2 py-3 max-[860px]:max-h-[440px]">
    <h2 class="m-0 px-2 pb-2 text-[11px] font-semibold tracking-[0.08em] text-gm-muted uppercase">Branches</h2>

    <h3 v-if="localBranches.length" class="mt-1 mb-1 px-2 text-[12px] font-semibold text-gm-soft">Local</h3>
    <div class="flex flex-col gap-0.5">
      <div
        v-for="branch in localBranches"
        :key="branch.name"
        class="flex items-center gap-1 rounded-lg"
        :class="branch.name === selectedBranch ? 'bg-gm-selected' : 'bg-transparent'"
      >
        <button
          type="button"
          class="gm-row-hover flex min-w-0 flex-auto cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-[7px] text-left text-gm-text"
          :aria-pressed="branch.name === selectedBranch"
          @click="$emit('select', branch.name)"
        >
          <GmIcon name="branch" :size="14" class="flex-none text-gm-muted" />
          <span class="truncate font-mono text-[12px]">{{ branch.name }}</span>
          <span
            v-if="branch.name === currentBranch"
            class="flex-none rounded bg-gm-accent px-1.5 py-px text-[10px] font-bold tracking-[0.04em] text-gm-on-accent"
          >
            HEAD
          </span>
          <span class="ml-auto flex-none text-[11px] text-gm-warn">{{ syncLabel(branch) }}</span>
        </button>
        <button
          v-if="writable && branch.name === selectedBranch && branch.name !== currentBranch"
          type="button"
          class="mr-1 h-7 flex-none cursor-pointer rounded-md border border-gm-checkout-line bg-gm-checkout px-2.5 text-[12px] text-gm-chip-text"
          @click="$emit('checkout', branch.name)"
        >
          Checkout
        </button>
      </div>
    </div>

    <h3 v-if="remoteBranches.length" class="mt-3.5 mb-1 px-2 text-[12px] font-semibold text-gm-soft">Remote · origin</h3>
    <div class="flex flex-col gap-0.5">
      <button
        v-for="branch in remoteBranches"
        :key="branch.name"
        type="button"
        class="gm-row-hover flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-2.5 py-[7px] text-left text-gm-soft"
        :class="branch.name === selectedBranch ? 'bg-gm-selected' : 'bg-transparent'"
        :aria-pressed="branch.name === selectedBranch"
        @click="$emit('select', branch.name)"
      >
        <GmIcon name="remote-branch" :size="14" class="flex-none text-gm-faint" />
        <span class="truncate font-mono text-[12px]">{{ branch.name }}</span>
      </button>
    </div>
  </section>
</template>
