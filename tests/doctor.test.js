const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  runDoctor,
  findMainTexCandidates,
  checkWorkflowSyntax,
  checkLocalLinks,
} = require('../scripts/doctor')

const root = path.resolve(__dirname, '..')
const fixtureProject = path.join(root, 'tests', 'fixtures', 'minimal-paper')

test('finds a main TeX file in a project directory', () => {
  const candidates = findMainTexCandidates(fixtureProject)
  assert.equal(candidates.length, 1)
  assert.equal(path.basename(candidates[0]), 'main.tex')
})

test('repository-local documentation links resolve', () => {
  assert.deepEqual(checkLocalLinks(root), [])
})

test('workflow snippets parse as workflow bodies', () => {
  const sample = path.join(root, 'workflows', 'drafter.workflow.js')
  const result = checkWorkflowSyntax(sample)
  assert.equal(result.ok, true, result.output)
})

test('doctor passes on the repository and minimal paper fixture', () => {
  const report = runDoctor({ project: fixtureProject })
  assert.equal(report.ok, true, JSON.stringify(report, null, 2))
  assert.equal(report.summary.errors, 0)
  assert.ok(report.checks.some((c) => c.id === 'manuscript-detect' && c.level === 'ok'))
})
