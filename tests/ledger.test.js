const test = require('node:test')
const assert = require('node:assert/strict')
const ledger = require('../scripts/ledger')

test('gate blocks active major charges and passes after author-required routing', () => {
  const led = ledger.emptyLedger()
  const [row] = ledger.addIssues(led, [{
    section: 'Introduction',
    evidence_anchor: 'The method is always better.',
    summary: 'Overclaims the result.',
    significance: 'major',
    kind: 'substantive',
    raised_by: ['R1'],
  }], 1)

  assert.equal(row.id, 'I-01')
  assert.equal(ledger.gatePass(led), false)
  assert.deepEqual(ledger.activeCounts(led), {
    major: 1,
    minor: 0,
    total: 1,
    gate_blocking_major: 1,
    author_required: 0,
  })

  ledger.setStatus(led, 'I-01', 'author-required', { verdict: 'author-required' })
  assert.equal(ledger.gatePass(led), true)
  assert.equal(ledger.activeCounts(led).author_required, 1)
})

test('valid-fixable requires a close criterion', () => {
  const led = ledger.emptyLedger()
  ledger.addIssues(led, [{ summary: 'Needs a clearer caveat.', section: 'Limitations' }], 1)

  assert.throws(
    () => ledger.setStatus(led, 'I-01', 'valid-fixable', { verdict: 'valid-fixable' }),
    /close_criterion/,
  )

  ledger.setStatus(led, 'I-01', 'valid-fixable', {
    verdict: 'valid-fixable',
    close_criterion: 'Add one sentence limiting the claim to the tested datasets.',
  })
  assert.equal(ledger.query(led, { status: 'valid-fixable' }).length, 1)
})

test('drops require a logged reason', () => {
  const led = ledger.emptyLedger()
  ledger.addIssues(led, [{ summary: 'Maybe unsupported.', section: 'Method' }], 1)

  assert.throws(
    () => ledger.setStatus(led, 'I-01', 'dropped', { verdict: 'invalid-drop' }),
    /reason/,
  )

  ledger.setStatus(led, 'I-01', 'dropped', {
    verdict: 'invalid-drop',
    notes: 'Reviewer quote refers to a different baseline table.',
  })
  assert.equal(ledger.isActive(led.issues[0]), false)
})

test('older severity values still map to current significance', () => {
  assert.equal(ledger.sigOf({ severity: 'blocker' }), 'major')
  assert.equal(ledger.sigOf({ severity: 'nit' }), 'minor')
  assert.equal(ledger.sigOf({ significance: 'minor', severity: 'blocker' }), 'minor')
})
