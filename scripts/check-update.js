#!/usr/bin/env node
// check-update.js -- soft PaperJury update reminder.

'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const DEFAULT_REMOTE = 'https://github.com/u7079256/paperjury.git'
const DEFAULT_SOURCE = 'u7079256/paperjury'
const DISABLE_ENV = 'PAPERJURY_DISABLE_UPDATE_CHECK'

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    root: path.resolve(__dirname, '..'),
    remote: process.env.PAPERJURY_UPDATE_REMOTE || DEFAULT_REMOTE,
    source: process.env.PAPERJURY_UPDATE_SOURCE || DEFAULT_SOURCE,
    current: null,
    tagsFile: null,
    json: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--root') opts.root = path.resolve(argv[++i])
    else if (a.startsWith('--root=')) opts.root = path.resolve(a.slice('--root='.length))
    else if (a === '--remote') opts.remote = argv[++i]
    else if (a.startsWith('--remote=')) opts.remote = a.slice('--remote='.length)
    else if (a === '--source') opts.source = argv[++i]
    else if (a.startsWith('--source=')) opts.source = a.slice('--source='.length)
    else if (a === '--current') opts.current = argv[++i]
    else if (a.startsWith('--current=')) opts.current = a.slice('--current='.length)
    else if (a === '--tags-file') opts.tagsFile = argv[++i]
    else if (a.startsWith('--tags-file=')) opts.tagsFile = a.slice('--tags-file='.length)
    else throw new Error('unknown argument: ' + a)
  }
  return opts
}

function usage() {
  return [
    'usage: node scripts/check-update.js [--json] [--current VERSION] [--tags-file FILE]',
    '',
    'Soft-checks whether a newer stable PaperJury release tag exists.',
    `Set ${DISABLE_ENV}=1 to skip the check.`,
  ].join('\n')
}

function readLocalVersion(root) {
  const candidates = [
    path.join(root, '.claude-plugin', 'plugin.json'),
    path.join(root, 'package.json'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof data.version === 'string' && data.version.trim()) return data.version.trim()
  }
  throw new Error('could not find local plugin/package version')
}

function parseVersion(value) {
  const text = String(value || '').trim()
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(text)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] == null ? 0 : Number(match[3]),
    raw: text,
  }
}

function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  return 0
}

function tagsFromLsRemote(text) {
  const tags = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /refs\/tags\/([^{}\s]+)(?:\^\{\})?$/.exec(line.trim())
    if (m) tags.push(m[1])
  }
  return tags
}

function latestStableTag(tags) {
  let best = null
  for (const tag of tags) {
    if (/-/.test(tag)) continue
    const parsed = parseVersion(tag)
    if (!parsed) continue
    if (!best || compareVersions(parsed, best.parsed) > 0) {
      best = { tag, parsed }
    }
  }
  return best
}

function readTags(opts) {
  if (opts.tagsFile) {
    return fs.readFileSync(opts.tagsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  }
  const res = spawnSync('git', ['ls-remote', '--tags', opts.remote], {
    encoding: 'utf8',
    timeout: 8000,
  })
  if (res.status !== 0) {
    const reason = (res.stderr || res.stdout || 'git ls-remote failed').trim()
    const err = new Error(reason)
    err.code = 'REMOTE_UNAVAILABLE'
    throw err
  }
  return tagsFromLsRemote(res.stdout)
}

function marketplaceName(source) {
  return String(source || DEFAULT_SOURCE).split('/')[0]
}

function checkUpdate(opts = {}) {
  if (process.env[DISABLE_ENV]) {
    return { skipped: true, reason: `${DISABLE_ENV} is set`, updateAvailable: false }
  }
  const root = path.resolve(opts.root || path.resolve(__dirname, '..'))
  const currentText = opts.current || readLocalVersion(root)
  const current = parseVersion(currentText)
  if (!current) throw new Error(`local version is not comparable: ${currentText}`)

  let tags
  try {
    tags = readTags({ ...opts, root })
  } catch (err) {
    if (err.code === 'REMOTE_UNAVAILABLE') {
      return {
        skipped: true,
        reason: err.message,
        currentVersion: currentText,
        updateAvailable: false,
      }
    }
    throw err
  }

  const latest = latestStableTag(tags)
  if (!latest) {
    return {
      skipped: true,
      reason: 'no stable release tags found',
      currentVersion: currentText,
      updateAvailable: false,
    }
  }
  const source = opts.source || DEFAULT_SOURCE
  const updateAvailable = compareVersions(latest.parsed, current) > 0
  return {
    skipped: false,
    currentVersion: currentText,
    latestVersion: `${latest.parsed.major}.${latest.parsed.minor}.${latest.parsed.patch}`,
    latestTag: latest.tag,
    updateAvailable,
    pluginUpdate: `/plugin install paperjury@${marketplaceName(source)}`,
    cloneUpdate: 'git pull (in the cloned skill directory)',
  }
}

function format(result) {
  if (result.skipped) {
    return `PaperJury update check skipped: ${result.reason}`
  }
  if (!result.updateAvailable) {
    return `PaperJury is up to date (${result.currentVersion}; latest ${result.latestTag}).`
  }
  return [
    `PaperJury update available: ${result.currentVersion} -> ${result.latestTag}.`,
    `Plugin route: ${result.pluginUpdate}`,
    `Clone route: ${result.cloneUpdate}`,
  ].join('\n')
}

function main() {
  let opts
  try {
    opts = parseArgs()
  } catch (err) {
    console.error(err.message)
    console.error(usage())
    process.exit(2)
  }
  if (opts.help) {
    console.log(usage())
    return
  }
  try {
    const result = checkUpdate(opts)
    if (opts.json) console.log(JSON.stringify(result, null, 2))
    else if (result.updateAvailable) console.log(format(result))
    process.exit(0)
  } catch (err) {
    const result = { skipped: true, reason: err.message, updateAvailable: false }
    if (opts.json) console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  }
}

if (require.main === module) main()

module.exports = {
  parseArgs,
  parseVersion,
  compareVersions,
  tagsFromLsRemote,
  latestStableTag,
  marketplaceName,
  checkUpdate,
  format,
}
