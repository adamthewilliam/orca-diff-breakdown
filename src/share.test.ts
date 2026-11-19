import { assert, test } from 'orca/testing'
import { formatShare } from './share'

test('a share is a whole percent', () => {
  assert.equal(formatShare(30, 100), '30%')
  assert.equal(formatShare(1, 3), '33%')
})

test('never rounds a real share down to 0% or up to 100%', () => {
  assert.equal(formatShare(2, 443), '<1%')
  assert.equal(formatShare(441, 443), '>99%', 'Runtime at 99.5% while Docs has <1%')
  assert.equal(formatShare(443, 443), '100%')
})

test('nothing changed is 0%', () => {
  assert.equal(formatShare(0, 443), '0%')
  assert.equal(formatShare(0, 0), '0%')
})
