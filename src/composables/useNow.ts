import { type Ref, getCurrentScope, onScopeDispose, ref } from 'vue'

/** The current time, updated every minute, for labels such as 'Today 11:42' and '12 min ago'. */
export function useNow(intervalMs = 60_000): Ref<Date> {
  const now = ref(new Date())
  const timer = setInterval(() => {
    now.value = new Date()
  }, intervalMs)
  if (getCurrentScope()) onScopeDispose(() => clearInterval(timer))
  return now
}
