#!/usr/bin/env node
// compile-guard.js -- the LaTeX compile / structure guard (AUTO_MODE_DESIGN §8,
// SUBMISSION_READINESS_DESIGN B). After an auto edit the orchestrator runs this;
// an edit that breaks compilation or introduces a NEW undefined ref is DETECTED and
// reported here; the orchestrator performs the rollback (via the journal). Shared by
// the engine core and submission-readiness B's layout
// loop. Dependency-free Node + child_process (orchestrator-side; the Workflow
// sandbox cannot spawn).
//
// DETECT-OR-DEGRADE (honest unverifiability, never a false "compiled"):
//   - with a LaTeX toolchain (latexmk or pdflatex on PATH): real compile, parse the
//     log for errors / overfull-underfull / float-too-large / undefined refs+cites,
//     and the page count ("Output written on ... (N pages").
//   - without one: degrade to a structural lint (brace balance, \begin/\end env
//     balance, \ref with no \label anywhere) and report `compiled:null` (UNKNOWN,
//     not false) so the caller never claims a verified compile it did not run.
//
// CLI:
//   node compile-guard.js check <main.tex> [--engine latexmk|pdflatex] [--timeout ms] [--outdir DIR]
//   node compile-guard.js lint  <main.tex>     # force the structural lint only
// Output: JSON. `ok` = (compiled === true && errors empty) for the real path, or
// (lint clean) for the degraded path with compiled:null.

'use strict'
const fs = require('fs')
const path = require('path')
const cp = require('child_process')

function resolveBin(names) {
  const locator = process.platform === 'win32' ? 'where' : 'which'
  for (const n of names) {
    try {
      const r = cp.spawnSync(locator, [n], { encoding: 'utf8' })
      if (r.status === 0 && r.stdout.trim()) return { name: n, path: r.stdout.split(/\r?\n/)[0].trim() }
    } catch (e) { /* keep trying */ }
  }
  return null
}

// ---- structural lint (the degraded path; also a cheap pre-check) ----------

function structuralLint(tex) {
  // strip comments + escaped braces so they do not throw off the balance
  const clean = tex.split(/\r?\n/).map((line) => {
    let out = ''
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '%' && (i === 0 || line[i - 1] !== '\\')) break
      out += line[i]
    }
    return out
  }).join('\n').replace(/\\[{}]/g, '')

  const open = (clean.match(/\{/g) || []).length
  const close = (clean.match(/\}/g) || []).length

  const envStack = []
  const envErrors = []
  const envRe = /\\(begin|end)\s*\{([^}]*)\}/g
  let m
  while ((m = envRe.exec(clean))) {
    if (m[1] === 'begin') envStack.push(m[2])
    else {
      const top = envStack.pop()
      if (top !== m[2]) envErrors.push(`\\end{${m[2]}} does not match ${top ? '\\begin{' + top + '}' : 'an open environment'}`)
    }
  }
  if (envStack.length) envErrors.push('unclosed environments: ' + envStack.join(', '))

  const labels = new Set((clean.match(/\\label\{([^}]*)\}/g) || []).map((s) => s.replace(/\\label\{|\}/g, '')))
  const refs = (clean.match(/\\(?:ref|eqref|autoref|cref|Cref)\{([^}]*)\}/g) || [])
    .map((s) => s.replace(/^\\[a-zA-Z]+\{|\}$/g, ''))
  const refs_without_label = [...new Set(refs.filter((r) => !labels.has(r)))]

  return {
    brace_balanced: open === close,
    brace_open: open, brace_close: close,
    env_errors: envErrors,
    refs_without_label, // heuristic only: a \ref whose key has no \label in THIS file
    clean: open === close && envErrors.length === 0,
  }
}

// ---- log parsing (the real path) ------------------------------------------

function parseLog(log) {
  const errors = []
  const errRe = /^(?:! .*|.*\.tex:\d+:.*)$/gm
  let m
  while ((m = errRe.exec(log))) errors.push(m[0].trim())

  // LaTeX wraps log lines at ~79 cols, splitting warnings mid-phrase; flatten
  // whitespace before matching multi-word warnings so the regexes do not miss them.
  const flat = log.replace(/\s+/g, ' ')
  const grab = (re) => (s) => { const m = re.exec(s); return m ? m[1] : null }
  const undefined_refs = [...new Set((flat.match(/Reference `([^']+)'(?: on page \d+)? undefined/g) || [])
    .map(grab(/Reference `([^']+)'/)).filter(Boolean))]
  const undefined_cites = [...new Set((flat.match(/Citation `([^']+)'(?: on page \d+)? undefined/g) || [])
    .map(grab(/Citation `([^']+)'/)).filter(Boolean))]

  const overfull = (flat.match(/Overfull \\[hv]box/g) || []).length
  const underfull = (flat.match(/Underfull \\[hv]box/g) || []).length
  const float_too_large = (flat.match(/Float too large for page|not in float specifier/g) || []).length

  const pm = /Output written on .*?\((\d+) pages?/.exec(flat)
  const page_count = pm ? parseInt(pm[1], 10) : null

  return { errors: errors.slice(0, 50), undefined_refs, undefined_cites, overfull, underfull, float_too_large, page_count }
}

// ---- compile --------------------------------------------------------------

function compile(file, { engine, timeout = 120000, outdir } = {}) {
  const abs = path.resolve(file)
  const dir = path.dirname(abs)
  const base = path.basename(abs)
  const tex = fs.readFileSync(abs, 'utf8')

  const bin = resolveBin(engine ? [engine] : ['latexmk', 'pdflatex'])
  if (!bin) {
    return { mode: 'degraded', compiled: null, toolchain: null, lint: structuralLint(tex),
      note: 'no LaTeX toolchain found; structural lint only. Cannot claim a verified compile.',
      ok: structuralLint(tex).clean }
  }

  const args = bin.name === 'latexmk'
    ? ['-pdf', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', ...(outdir ? ['-outdir=' + outdir] : []), base]
    : ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', ...(outdir ? ['-output-directory=' + outdir] : []), base]

  const r = cp.spawnSync(bin.path, args, { cwd: dir, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const logPath = path.join(outdir ? path.resolve(dir, outdir) : dir, base.replace(/\.tex$/i, '') + '.log')
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ((r.stdout || '') + (r.stderr || ''))
  const parsed = parseLog(log)
  const pdfPath = path.join(outdir ? path.resolve(dir, outdir) : dir, base.replace(/\.tex$/i, '') + '.pdf')
  const compiled = (r.status === 0) && parsed.errors.length === 0 && fs.existsSync(pdfPath)

  return {
    mode: 'compiled', toolchain: bin.name, engine_path: bin.path,
    compiled,
    exit_status: r.status,
    timed_out: r.error && r.error.code === 'ETIMEDOUT' || false,
    pdf: fs.existsSync(pdfPath) ? pdfPath : null,
    ...parsed,
    ok: compiled,
  }
}

function main() {
  const [cmd, file] = process.argv.slice(2)
  const rest = process.argv.slice(4)
  const flags = {}
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++ }
  if (!cmd || !file) {
    console.error('usage: node compile-guard.js <check|lint> <main.tex> [--engine E] [--timeout ms] [--outdir DIR]')
    process.exit(2)
  }
  if (cmd === 'lint') {
    console.log(JSON.stringify(structuralLint(fs.readFileSync(path.resolve(file), 'utf8')), null, 2))
  } else if (cmd === 'check') {
    const res = compile(file, { engine: flags.engine, timeout: flags.timeout ? parseInt(flags.timeout, 10) : undefined, outdir: flags.outdir })
    console.log(JSON.stringify(res, null, 2))
    process.exit(res.ok ? 0 : 1)
  } else {
    console.error('unknown command: ' + cmd)
    process.exit(2)
  }
}

if (require.main === module) main()

module.exports = { compile, structuralLint, parseLog, resolveBin }
