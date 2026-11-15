<script setup lang="ts">
import type { FileChange, FileStatus } from '@/types/git'
import { pluralize, renameLabel, splitPath } from '@/lib/format'

defineProps<{ files: FileChange[]; loading: boolean; selectedIndex: number }>()

defineEmits<{ select: [index: number] }>()

const STATUS_COLOR: Record<FileStatus, string> = {
  A: 'text-gm-add-sign',
  M: 'text-gm-warn',
  D: 'text-gm-del-sign',
  R: 'text-gm-link',
}
</script>

<template>
  <div
    class="box-border h-full max-w-full min-w-0 flex-[1_1_220px] overflow-auto border-r border-gm-line p-2 max-[860px]:max-h-[440px]"
  >
    <p v-if="loading" class="m-0 px-2 py-1 text-[12px] text-gm-muted">Loading files…</p>
    <h3 v-else class="m-0 px-2 pt-0.5 pb-2 text-[11px] font-semibold tracking-[0.06em] text-gm-faint uppercase">
      {{ pluralize(files.length, 'file changed', 'files changed') }}
    </h3>
    <div class="flex flex-col gap-0.5">
      <button
        v-for="(file, index) in files"
        :key="file.path"
        type="button"
        class="gm-row-hover flex w-full cursor-pointer items-start gap-2 rounded-md border-0 px-2 py-1.5 text-left text-gm-text"
        :class="index === selectedIndex ? 'bg-gm-selected' : 'bg-transparent'"
        :aria-pressed="index === selectedIndex"
        @click="$emit('select', index)"
      >
        <span class="flex-[0_0_16px] font-mono text-[12px] font-medium" :class="STATUS_COLOR[file.status]">
          {{ file.status }}
        </span>
        <span class="flex min-w-0 flex-col gap-px">
          <span class="truncate text-[12px] font-medium">{{ splitPath(file.path).name }}</span>
          <span v-if="file.oldPath" class="truncate font-mono text-[11px] text-gm-faint" :title="file.oldPath">
            {{ renameLabel(file.oldPath, file.path) }}
          </span>
          <span v-else class="truncate font-mono text-[11px] text-gm-faint">{{ splitPath(file.path).dir }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
