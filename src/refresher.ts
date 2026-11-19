/**
 * Schedules fetches for whatever is focused: one at a time, follow-ups collapsed into one, recent
 * results cached per key. Nothing is fetched until the first `setFocus`.
 *
 * `setFocus` is only a trigger: Orca's event and the worker can name the same workspace
 * differently, so the two ids are never required to match. The worker's id (`keyOf`) decides where
 * an answer is cached, and an answer is shown unless a newer `setFocus` happened after its fetch
 * started (the follow-up fetch covers that newer focus). The focus stays the event's id.
 */
export function createRefresher<T>(options: {
  /** Fetches an answer for `key`, the current focus. */
  fetch: (key: string | null) => Promise<T>
  /** Which workspace an answer is actually for. */
  keyOf: (value: T) => string | null
  show: (value: T | undefined, key: string | null) => void
  cacheSize?: number
}) {
  const { fetch, keyOf, show, cacheSize = 20 } = options
  const cache = new Map<string | null, T>()
  let focus: { key: string | null } | undefined
  /** Bumped by every real `setFocus`; an answer is shown only if it is unchanged since its fetch began. */
  let generation = 0
  let running = false
  let again = false

  /** Stores a result, evicting the least recently used key past `cacheSize`. */
  function remember(key: string | null, value: T) {
    cache.delete(key)
    cache.set(key, value)
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string | null)
  }

  /** Reads a cached result and marks it as recently used. */
  function recall(key: string | null): T | undefined {
    if (!cache.has(key)) return undefined
    const value = cache.get(key) as T
    remember(key, value)
    return value
  }

  /** Fetches now, or once more after the fetch already in flight; nothing while the focus is unknown. */
  async function refresh(): Promise<void> {
    if (!focus) return
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        const started = generation
        const value = await fetch(focus.key)
        const key = keyOf(value)
        remember(key, value)
        // `focus` stays Orca's event id, so repeated events for the same workspace stay no-ops.
        if (started === generation) show(value, key)
      } while (again)
    } finally {
      running = false
    }
  }

  /** Switches focus, shows its last result (or nothing) at once, then refreshes. */
  function setFocus(key: string | null) {
    if (focus && key === focus.key) return
    focus = { key }
    generation++
    show(recall(key), key)
    void refresh()
  }

  return { refresh, setFocus }
}
