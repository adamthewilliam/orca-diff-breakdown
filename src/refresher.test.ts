import { assert, test } from 'orca/testing'
import { createRefresher } from './refresher'

/** What the worker answers: which workspace it actually read, and what it found. */
type Answer = { key: string | null; text: string }

/** A fetch whose answers the test hands out by hand, in any order. */
function manualFetch() {
  const pending: { key: string | null; resolve: (value: Answer) => void }[] = []
  return {
    fetch: (key: string | null) => new Promise<Answer>((resolve) => pending.push({ key, resolve })),
    pending,
    /** Answers fetch `index` as `key` (defaults to the key it was asked for). */
    answer: async (index: number, text: string, key = pending[index].key) => {
      pending[index].resolve({ key, text })
      await new Promise((r) => setTimeout(r, 0))
    }
  }
}

function setup(cacheSize?: number) {
  const f = manualFetch()
  const shown: [string | undefined, string | null][] = []
  const refresher = createRefresher<Answer>({
    fetch: f.fetch,
    keyOf: (answer) => answer.key,
    show: (answer, key) => shown.push([answer?.text, key]),
    cacheSize
  })
  return { f, shown, refresher }
}

test('nothing is fetched until the focus is known', async () => {
  const { f, refresher } = setup()
  void refresher.refresh()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(f.pending.length, 0)
})

test('the first focus fetches once, even when it is "no workspace"', async () => {
  const { f, shown, refresher } = setup()
  refresher.setFocus(null)
  assert.equal(f.pending.length, 1)
  assert.equal(f.pending[0].key, null)
  await f.answer(0, 'nothing open')
  assert.deepEqual(shown.at(-1), ['nothing open', null])
})

test('a workspace switch during a refresh is not dropped', async () => {
  const { f, shown, refresher } = setup()
  refresher.setFocus('shop')
  await f.answer(0, 'shop changes')
  void refresher.refresh() // a background refresh is running…
  refresher.setFocus('blog') // …when the person switches
  await f.answer(1, 'shop changes again') // the late answer for shop
  assert.equal(f.pending.length, 3, 'a new fetch starts for blog')
  assert.equal(f.pending[2].key, 'blog')
  await f.answer(2, 'blog changes')
  assert.deepEqual(shown.at(-1), ['blog changes', 'blog'])
  assert.ok(
    !shown.some(([text, key]) => key === 'blog' && text === 'shop changes again'),
    'the late shop answer is never shown as blog'
  )
})

test("the newest answer is shown even when Orca's event and the worker name the workspace differently", async () => {
  // Seen in Orca: workspace.changed said nothing was focused (null) while readContext said "~".
  const { f, shown, refresher } = setup()
  refresher.setFocus(null)
  await f.answer(0, 'not a git repository', 'home')
  assert.deepEqual(shown.at(-1), ['not a git repository', 'home'])
})

test('an answer is filed under the workspace the worker read, not the one asked for', async () => {
  const { f, shown, refresher } = setup()
  refresher.setFocus('shop')
  // Orca switched to blog and the worker saw it before the panel heard about the switch.
  await f.answer(0, 'blog changes', 'blog')
  assert.deepEqual(shown.at(-1), ['blog changes', 'blog'], 'the newest answer is what is focused now')
  refresher.setFocus('home')
  refresher.setFocus('shop')
  assert.deepEqual(shown.at(-1), [undefined, 'shop'], 'never cached as shop')
  refresher.setFocus('blog')
  assert.deepEqual(shown.at(-1), ['blog changes', 'blog'], 'kept for blog, shown at once')
})

test('repeated events for the same workspace never flash "loading", even when the ids disagree', async () => {
  // workspace.changed also fires when terminals open or close, with the same (possibly null) id.
  const { f, shown, refresher } = setup()
  refresher.setFocus(null)
  await f.answer(0, 'not a git repository', 'home')
  const before = shown.length
  refresher.setFocus(null)
  refresher.setFocus(null)
  assert.equal(shown.length, before, 'nothing re-shown')
  assert.equal(f.pending.length, 1, 'nothing refetched')
})

test('switching back shows the last result at once, then refreshes it', async () => {
  const { f, shown, refresher } = setup()
  refresher.setFocus('shop')
  await f.answer(0, 'shop v1')
  refresher.setFocus('blog')
  await f.answer(1, 'blog v1')
  refresher.setFocus('shop')
  assert.deepEqual(shown.at(-1), ['shop v1', 'shop'], 'cached result shown before any answer')
  await f.answer(2, 'shop v2')
  assert.deepEqual(shown.at(-1), ['shop v2', 'shop'])
})

test('a workspace with nothing cached shows nothing rather than the previous one', async () => {
  const { f, shown, refresher } = setup()
  refresher.setFocus('shop')
  await f.answer(0, 'shop changes')
  refresher.setFocus('blog')
  assert.deepEqual(shown.at(-1), [undefined, 'blog'])
})

test('refreshes asked for while one runs collapse into one more', async () => {
  const { f, shown, refresher } = setup()
  refresher.setFocus('shop')
  void refresher.refresh()
  void refresher.refresh()
  void refresher.refresh()
  assert.equal(f.pending.length, 1, 'only one fetch at a time')
  await f.answer(0, 'a')
  assert.equal(f.pending.length, 2, 'exactly one follow-up')
  await f.answer(1, 'b')
  assert.equal(f.pending.length, 2, 'and nothing after it')
  assert.deepEqual(shown.at(-1), ['b', 'shop'])
})

test('setting the same focus again does not refetch', async () => {
  const { f, refresher } = setup()
  refresher.setFocus('shop')
  await f.answer(0, 'a')
  refresher.setFocus('shop')
  assert.equal(f.pending.length, 1)
})

test('keeps at most cacheSize workspaces', async () => {
  const { f, shown, refresher } = setup(2)
  for (const [i, key] of ['a', 'b', 'c'].entries()) {
    refresher.setFocus(key)
    await f.answer(i, `${key} changes`)
  }
  refresher.setFocus('a')
  assert.deepEqual(shown.at(-1), [undefined, 'a'], 'the oldest was dropped')
})
