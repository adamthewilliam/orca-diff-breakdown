import { assert, test } from 'orca/testing'
import { branchVersions } from './branch'

test('drops the base, then abbreviates and drops the prefix; the branch name stays', () => {
  assert.deepEqual(branchVersions('feature/branch-history', 'origin/main'), [
    ['feature/branch-history', ' → origin/main'],
    ['feature/branch-history', ''],
    ['f/branch-history', ''],
    ['branch-history', '']
  ])
})

test('nested prefixes become initials', () => {
  assert.equal(branchVersions('users/adam/fix/login-redirect', 'origin/main')[2][0], 'u/a/f/login-redirect')
})

test('a plain branch only loses its base', () => {
  assert.deepEqual(branchVersions('main', 'origin/main'), [
    ['main', ' → origin/main'],
    ['main', '']
  ])
  // Without a base the diff is only the working tree: say so for as long as it fits.
  assert.deepEqual(branchVersions('main', null), [
    ['main', ' (no base)'],
    ['main', '']
  ])
})

test('a one-letter prefix is not abbreviated again', () => {
  assert.deepEqual(
    branchVersions('x/thing', 'origin/main').map(([text]) => text),
    ['x/thing', 'x/thing', 'thing']
  )
})
