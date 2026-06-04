const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { apply, revert, countOccurrences } = require('../scripts/apply-patch')
const journal = require('../scripts/journal')

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperjury-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('applies an exact-once patch and reverts through the journal', (t) => {
  const dir = tempDir(t)
  const tex = path.join(dir, 'main.tex')
  const log = path.join(dir, 'journal.jsonl')
  fs.writeFileSync(tex, 'Before sentence.\nTarget sentence.\nAfter sentence.\n', 'utf8')

  const res = apply(tex, log, {
    issue_id: 'I-01',
    passage_id: '1#p1',
    round: 2,
    close_criterion: 'Tighten the sentence.',
    before: 'Target sentence.',
    after: 'Sharper target sentence.',
  })

  assert.deepEqual(res, { ok: true, jid: 'J-0001' })
  assert.match(fs.readFileSync(tex, 'utf8'), /Sharper target sentence/)
  assert.equal(journal.readEntries(log).length, 1)

  const reverted = revert(tex, log, res.jid)
  assert.deepEqual(reverted, { ok: true, reverted: 'J-0001' })
  assert.match(fs.readFileSync(tex, 'utf8'), /Target sentence/)
  assert.equal(journal.readEntries(log).length, 2)
})

test('refuses ambiguous before text', (t) => {
  const dir = tempDir(t)
  const tex = path.join(dir, 'main.tex')
  const log = path.join(dir, 'journal.jsonl')
  fs.writeFileSync(tex, 'same\nsame\n', 'utf8')

  assert.equal(countOccurrences('same same same', 'same'), 3)
  const res = apply(tex, log, { before: 'same', after: 'other' })
  assert.equal(res.ok, false)
  assert.match(res.reason, /ambiguous/)
  assert.equal(fs.existsSync(log), false)
})
