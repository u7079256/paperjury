const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseVersion,
  compareVersions,
  latestStableTag,
  marketplaceName,
  checkUpdate,
  format,
} = require('../scripts/check-update')

delete process.env.PAPERJURY_DISABLE_UPDATE_CHECK

test('normalizes release tags for comparison', () => {
  assert.deepEqual(parseVersion('v1.0'), { major: 1, minor: 0, patch: 0, raw: 'v1.0' })
  assert.equal(compareVersions(parseVersion('v1.0.1'), parseVersion('1.0.0')), 1)
  assert.equal(compareVersions(parseVersion('1.0.0'), parseVersion('v1.0')), 0)
})

test('finds the latest stable tag and ignores prereleases', () => {
  const latest = latestStableTag(['v0.9.0', 'v1.0.1-beta.1', 'v1.0', 'not-a-version'])
  assert.equal(latest.tag, 'v1.0')
})

test('reports update availability without failing the workflow', () => {
  const result = checkUpdate({
    current: '0.9.0',
    tagsFile: 'tests/fixtures/update-tags.txt',
    source: 'owner/repo',
  })
  assert.equal(result.updateAvailable, true)
  assert.equal(result.latestTag, 'v1.0.0')
  assert.equal(result.pluginUpdate, '/plugin install paperjury@owner')
  assert.match(format(result), /update available/)
})

test('treats matching v1.0.0 tag as up to date for 1.0.0', () => {
  const result = checkUpdate({
    current: '1.0.0',
    tagsFile: 'tests/fixtures/update-tags.txt',
    source: 'owner/repo',
  })
  assert.equal(result.updateAvailable, false)
  assert.equal(result.latestTag, 'v1.0.0')
})

test('derives the marketplace name from the source owner', () => {
  assert.equal(marketplaceName('u7079256/paperjury'), 'u7079256')
})
