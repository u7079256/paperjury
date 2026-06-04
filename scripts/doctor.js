#!/usr/bin/env node
// doctor.js -- dependency-free install and repository health check for paperjury.

'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage'])
const TEXT_EXTS = new Set(['.md', '.html', '.js', '.json', '.yml', '.yaml', '.txt'])

function parseArgs(argv = process.argv.slice(2)) {
  const opts = { root: ROOT, project: process.cwd(), json: false, strictLatex: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--strict-latex') opts.strictLatex = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--project') opts.project = argv[++i]
    else if (a.startsWith('--project=')) opts.project = a.slice('--project='.length)
    else throw new Error('unknown argument: ' + a)
  }
  opts.root = path.resolve(opts.root)
  opts.project = path.resolve(opts.project)
  return opts
}

function collectFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) collectFiles(p, predicate, out)
    else if (!predicate || predicate(p)) out.push(p)
  }
  return out
}

function rel(root, file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function commandExists(cmd) {
  const res = process.platform === 'win32'
    ? spawnSync('where.exe', [cmd], { encoding: 'utf8' })
    : spawnSync('sh', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' })
  return res.status === 0
}

function nodeMajor() {
  return Number(process.versions.node.split('.')[0])
}

function checkNodeSyntax(file) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  return {
    ok: res.status === 0,
    output: (res.stderr || res.stdout || '').trim(),
  }
}

function checkWorkflowSyntax(file) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const code = fs.readFileSync(file, 'utf8')
    .replace(/\bexport\s+const\s+/g, 'const ')
    .replace(/\bexport\s+let\s+/g, 'let ')
    .replace(/\bexport\s+var\s+/g, 'var ')
  try {
    // Workflow bodies are snippets with top-level await/return, so parse them as
    // async function bodies instead of ordinary Node modules.
    // eslint-disable-next-line no-new-func
    new AsyncFunction(code)
    return { ok: true, output: '' }
  } catch (err) {
    return { ok: false, output: err && err.stack ? err.stack : String(err) }
  }
}

function checkHtmlScripts(file) {
  const text = fs.readFileSync(file, 'utf8')
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
  const errors = []
  for (let i = 0; i < scripts.length; i++) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(scripts[i])
    } catch (err) {
      errors.push({ script: i + 1, error: err.message })
    }
  }
  return errors
}

function isExternalTarget(target) {
  return /^(https?:|mailto:|tel:|data:|javascript:)/i.test(target)
}

function cleanTarget(target) {
  let t = String(target || '').trim()
  if (!t || t.startsWith('#') || isExternalTarget(t)) return null
  if ((t.startsWith('<') && t.endsWith('>')) || (t.startsWith('"') && t.endsWith('"'))) {
    t = t.slice(1, -1)
  }
  t = t.split('#')[0].split('?')[0]
  if (!t || isExternalTarget(t)) return null
  try { t = decodeURIComponent(t) } catch (_) {}
  return t
}

function localLinksIn(file) {
  const text = fs.readFileSync(file, 'utf8')
  const links = []
  for (const m of text.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) links.push(m[1])
  for (const m of text.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) links.push(m[1])
  return links
    .map(cleanTarget)
    .filter(Boolean)
    .map((target) => ({ file, target, resolved: path.resolve(path.dirname(file), target.replace(/\//g, path.sep)) }))
}

function checkLocalLinks(root) {
  const docs = collectFiles(root, (p) => ['.md', '.html'].includes(path.extname(p).toLowerCase()))
    .filter((p) => rel(root, p) !== 'docs/HANDOFF.md')
  const missing = []
  for (const file of docs) {
    for (const link of localLinksIn(file)) {
      if (!fs.existsSync(link.resolved)) {
        missing.push({ file: rel(root, link.file), target: link.target })
      }
    }
  }
  return missing
}

function findMainTexCandidates(projectDir) {
  if (!fs.existsSync(projectDir)) return []
  const stat = fs.statSync(projectDir)
  const files = stat.isFile()
    ? [projectDir]
    : collectFiles(projectDir, (p) => path.extname(p).toLowerCase() === '.tex')
  return files.filter((file) => {
    const text = fs.readFileSync(file, 'utf8')
    return /\\documentclass(?:\[[^\]]*])?\{[^}]+}/.test(text) && /\\begin\{document}/.test(text)
  })
}

function runDoctor(options = {}) {
  const root = path.resolve(options.root || ROOT)
  const project = path.resolve(options.project || process.cwd())
  const checks = []
  const add = (level, id, message, details) => checks.push({ level, id, message, ...(details ? { details } : {}) })
  const ok = (id, message, details) => add('ok', id, message, details)
  const warn = (id, message, details) => add('warn', id, message, details)
  const error = (id, message, details) => add('error', id, message, details)

  if (nodeMajor() >= 18) ok('node-version', `Node ${process.versions.node}`)
  else error('node-version', `Node ${process.versions.node}; expected >= 18`)

  if (commandExists('git')) ok('git', 'git is available')
  else error('git', 'git is not available on PATH')

  const hasLatexmk = commandExists('latexmk')
  const hasPdflatex = commandExists('pdflatex')
  if (hasLatexmk || hasPdflatex) ok('latex', `LaTeX toolchain available (${hasLatexmk ? 'latexmk' : 'pdflatex'})`)
  else if (options.strictLatex) error('latex', 'no latexmk/pdflatex on PATH')
  else warn('latex', 'no latexmk/pdflatex on PATH; compile checks will degrade to structural lint')

  const requiredFiles = [
    'SKILL.md',
    'README.md',
    'README.zh-CN.md',
    'references/review-engine-v3.md',
    'references/auto-mode.md',
    'references/ledger-schema.md',
    'docs/AGENT-GUIDE.md',
  ]
  const missingFiles = requiredFiles.filter((p) => !fs.existsSync(path.join(root, p)))
  if (missingFiles.length) error('required-files', 'missing required files', missingFiles)
  else ok('required-files', `${requiredFiles.length} required files present`)

  const requiredDirs = ['scripts', 'workflows', 'references', 'docs']
  const missingDirs = requiredDirs.filter((p) => !fs.existsSync(path.join(root, p)) || !fs.statSync(path.join(root, p)).isDirectory())
  if (missingDirs.length) error('required-dirs', 'missing required directories', missingDirs)
  else ok('required-dirs', `${requiredDirs.length} required directories present`)

  const scriptFiles = collectFiles(path.join(root, 'scripts'), (p) => path.extname(p) === '.js')
  const scriptErrors = scriptFiles.map((file) => ({ file, ...checkNodeSyntax(file) })).filter((r) => !r.ok)
  if (scriptErrors.length) error('script-syntax', 'Node script syntax errors', scriptErrors.map((r) => ({ file: rel(root, r.file), output: r.output })))
  else ok('script-syntax', `${scriptFiles.length} Node scripts parse`)

  const workflowFiles = collectFiles(path.join(root, 'workflows'), (p) => p.endsWith('.workflow.js'))
  const workflowErrors = workflowFiles.map((file) => ({ file, ...checkWorkflowSyntax(file) })).filter((r) => !r.ok)
  if (workflowErrors.length) error('workflow-syntax', 'workflow snippet syntax errors', workflowErrors.map((r) => ({ file: rel(root, r.file), output: r.output })))
  else ok('workflow-syntax', `${workflowFiles.length} workflow snippets parse`)

  const htmlFiles = collectFiles(path.join(root, 'docs'), (p) => path.extname(p).toLowerCase() === '.html')
  const htmlErrors = htmlFiles.flatMap((file) => checkHtmlScripts(file).map((e) => ({ file: rel(root, file), ...e })))
  if (htmlErrors.length) error('html-scripts', 'inline HTML script syntax errors', htmlErrors)
  else ok('html-scripts', `${htmlFiles.length} HTML files parse`)

  const missingLinks = checkLocalLinks(root)
  if (missingLinks.length) error('local-links', 'missing local documentation links', missingLinks)
  else ok('local-links', 'local documentation links resolve')

  if (!fs.existsSync(project)) {
    error('project-path', `project path does not exist: ${project}`)
  } else {
    const candidates = findMainTexCandidates(project)
    if (candidates.length === 0) {
      warn('manuscript-detect', `no main .tex detected under ${project}; pass --project <paper-dir> from a paper project`)
    } else if (candidates.length === 1) {
      ok('manuscript-detect', `main .tex detected: ${rel(project, candidates[0])}`)
    } else {
      warn('manuscript-detect', `multiple main .tex candidates under ${project}`, candidates.slice(0, 10).map((p) => rel(project, p)))
    }
  }

  const errors = checks.filter((c) => c.level === 'error').length
  const warnings = checks.filter((c) => c.level === 'warn').length
  return { ok: errors === 0, root, project, summary: { errors, warnings, checks: checks.length }, checks }
}

function format(report) {
  const lines = [`paperjury doctor: ${report.ok ? 'PASS' : 'FAIL'} (${report.summary.errors} errors, ${report.summary.warnings} warnings)`]
  for (const c of report.checks) {
    const tag = c.level === 'ok' ? 'OK' : c.level === 'warn' ? 'WARN' : 'FAIL'
    lines.push(`[${tag}] ${c.id}: ${c.message}`)
    if (c.details && c.level !== 'ok') {
      const details = Array.isArray(c.details) ? c.details : [c.details]
      for (const d of details.slice(0, 20)) {
        lines.push('  - ' + (typeof d === 'string' ? d : JSON.stringify(d)))
      }
    }
  }
  return lines.join('\n')
}

function usage() {
  return [
    'usage: node scripts/doctor.js [--project <paper-dir>] [--json] [--strict-latex]',
    '',
    'Checks repository integrity, JS/workflow syntax, local docs links, required tools,',
    'and whether a main .tex can be detected in the target paper project.',
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
  const report = runDoctor(opts)
  if (opts.json) console.log(JSON.stringify(report, null, 2))
  else console.log(format(report))
  process.exit(report.ok ? 0 : 1)
}

if (require.main === module) main()

module.exports = {
  parseArgs,
  runDoctor,
  format,
  checkLocalLinks,
  findMainTexCandidates,
  checkWorkflowSyntax,
}
