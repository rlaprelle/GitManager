<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { CloneRequest } from '@/types/git'
import { cloneUrlProblem, folderNameProblem, repositoryNameFromUrl } from '@/lib/clone'
import GmIcon from './GmIcon.vue'

const props = defineProps<{
  open: boolean
  /** The folder the clone goes into; null until the user picks one. */
  folder: string | null
  /** True while the clone runs: the form is locked and Cancel stops the clone. */
  cloning: boolean
  /** git's progress while cloning ('Cloning tools… Receiving objects 42%'). */
  progress: string | null
  /** Why the last attempt failed. */
  error: string | null
}>()

const emit = defineEmits<{ chooseFolder: []; clone: [request: CloneRequest]; close: []; cancelClone: [] }>()

const url = ref('')
const name = ref('')
/** Once the user types a name, the URL stops suggesting one. */
const nameEdited = ref(false)
/** Problems show once there is something to judge, not on an empty form. */
const urlTouched = ref(false)

watch(url, (value) => {
  if (!nameEdited.value) name.value = repositoryNameFromUrl(value)
})

const urlProblem = computed(() => cloneUrlProblem(url.value))
const nameProblem = computed(() => (name.value ? folderNameProblem(name.value) : null))
const destination = computed(() => (props.folder && name.value && !nameProblem.value ? `${props.folder}\\${name.value}` : null))
const canClone = computed(() => !props.cloning && !urlProblem.value && !folderNameProblem(name.value) && props.folder !== null)

function editName(event: Event): void {
  nameEdited.value = true
  name.value = (event.target as HTMLInputElement).value
}

function submit(): void {
  urlTouched.value = true
  if (canClone.value) emit('clone', { url: url.value.trim(), name: name.value })
}

function dismiss(): void {
  if (props.cloning) emit('cancelClone')
  else emit('close')
}

const dialog = ref<HTMLDialogElement | null>(null)

/** A fresh form each time the dialog opens; a failed attempt keeps its form, since the dialog stays open. */
function reset(): void {
  url.value = ''
  name.value = ''
  nameEdited.value = false
  urlTouched.value = false
}

// A native modal dialog, as ConfirmDialog: focus stays inside, and Esc (its cancel event) closes it,
// except while cloning, when only the Cancel button (which stops the clone) does.
function sync(open: boolean): void {
  const element = dialog.value
  if (!element || element.open === open) return
  if (open) {
    reset()
    element.showModal()
  } else element.close()
}

function onEscape(event: Event): void {
  event.preventDefault()
  if (!props.cloning) emit('close')
}

watch(() => props.open, sync)
onMounted(() => sync(props.open))

const input =
  'box-border h-9 w-full min-w-0 rounded-lg border border-gm-line-input bg-gm-code px-3 font-mono text-[12px] text-gm-text disabled:text-gm-disabled'
const label = 'flex flex-col gap-1.5 text-[12px] text-gm-soft'
const secondaryButton =
  'inline-flex h-9 flex-none cursor-pointer items-center gap-2 rounded-lg border border-gm-line-strong bg-gm-main px-3.5 text-gm-text hover:bg-gm-hover disabled:cursor-default disabled:text-gm-disabled'
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="clone-title"
    class="m-auto w-[min(520px,calc(100vw-32px))] rounded-xl border border-gm-line-strong bg-gm-raised p-0 text-[13px] text-gm-text shadow-2xl backdrop:bg-gm-backdrop"
    @cancel="onEscape"
  >
    <form class="flex flex-col" novalidate @submit.prevent="submit">
      <div class="flex flex-col gap-4 p-5">
        <div class="flex items-center gap-3">
          <span class="flex size-8 flex-none items-center justify-center rounded-lg bg-gm-selected text-gm-accent">
            <GmIcon name="clone" :size="18" />
          </span>
          <h2 id="clone-title" class="m-0 text-[15px] font-semibold">Clone a repository</h2>
        </div>

        <label :class="label">
          Repository URL
          <input
            v-model="url"
            type="text"
            :class="input"
            placeholder="https://github.com/owner/repository.git"
            spellcheck="false"
            autocomplete="off"
            autofocus
            :disabled="cloning"
            :aria-invalid="urlTouched && urlProblem !== null"
            @blur="urlTouched = url.trim() !== '' || urlTouched"
          />
          <span v-if="urlTouched && urlProblem" class="text-gm-warn">{{ urlProblem }}</span>
        </label>

        <div :class="label">
          <span id="clone-folder-label">Clone into</span>
          <div class="flex items-center gap-2">
            <span
              aria-labelledby="clone-folder-label"
              data-testid="clone-folder"
              class="box-border flex h-9 min-w-0 flex-auto items-center truncate rounded-lg border border-gm-line px-3 font-mono text-[12px]"
              :class="folder ? 'text-gm-text' : 'text-gm-muted'"
              :title="folder ?? undefined"
            >
              {{ folder ?? 'No folder chosen' }}
            </span>
            <button type="button" :class="secondaryButton" :disabled="cloning" @click="emit('chooseFolder')">
              Browse…
            </button>
          </div>
        </div>

        <label :class="label">
          Folder name
          <input
            :value="name"
            type="text"
            :class="input"
            spellcheck="false"
            autocomplete="off"
            :disabled="cloning"
            :aria-invalid="nameProblem !== null"
            @input="editName"
          />
          <span v-if="nameProblem" class="text-gm-warn">{{ nameProblem }}</span>
        </label>

        <p v-if="destination" class="m-0 text-[12px] text-gm-muted">
          Clones into <span class="font-mono text-gm-soft" data-testid="clone-destination">{{ destination }}</span>
        </p>

        <p v-if="progress" class="m-0 font-mono text-[12px] text-gm-accent" role="status">{{ progress }}</p>
        <p v-if="error" class="m-0 rounded-lg bg-gm-warn-bg px-3 py-2 text-gm-warn" role="alert">{{ error }}</p>
      </div>

      <div class="flex justify-end gap-2 border-t border-gm-line px-5 py-3">
        <button type="button" :class="secondaryButton" @click="dismiss">
          {{ cloning ? 'Cancel clone' : 'Cancel' }}
        </button>
        <button
          type="submit"
          class="inline-flex h-9 cursor-pointer items-center rounded-lg border-0 bg-gm-accent px-3.5 font-semibold text-gm-on-accent disabled:cursor-default disabled:opacity-50"
          :disabled="!canClone"
        >
          {{ cloning ? 'Cloning…' : 'Clone' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
