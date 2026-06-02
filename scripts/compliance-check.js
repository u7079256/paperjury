#!/usr/bin/env node
// compliance-check.js -- the deterministic half of submission-readiness A, the
// template-compliance desk-reject shield (SUBMISSION_READINESS_DESIGN A). Scans the
// manuscript for the SCRIPTABLE desk-reject causes against a PROJECT-OWNED
// constraints file (the skill ships NO venue files; constraints live in the
// project, recorded once at template confirmation). The SEMANTIC calls (does this
// self-citation de-anonymize, is this acknowledgment identity-revealing) are an
// agent step in references/submission-compliance.md, NOT here.
//
// Dependency-free Node. Detect-or-degrade: page-limit check only runs when given a
// real compiled page count (--pages, from compile-guard.js); it never guesses.
//
// constraints.json (project-owned; all fields optional):
//   { "venue": "...", "anonymous": true, "page_limit": 9,
//     "required_sections": ["Limitations"], "documentclass": "neurips_2026",
//     "allowed_documentclass_options": ["final"] }
//
// CLI:
//   node compliance-check.js <manuscript.tex> <constraints.json> [--pages N]
// Output: JSON { findings:[{check,severity,detail,locations}], summary, passed }.

'use strict'
const fs = require('fs')

function stripComments(tex) {
  return tex.split(/\r?\n/).map((line) => {
    let out = ''
    for (let i = 0; i < line.length; i++) { if (line[i] === '%' && (i === 0 || line[i - 1] !== '\\')) break; out += line[i] }
    return out
  })
}

function findLines(lines, re) {
  const hits = []
  lines.forEach((l, i) => { if (re.test(l)) hits.push({ line: i + 1, text: l.trim().slice(0, 160) }) })
  return hits
}

function check(tex, constraints, pages) {
  const lines = stripComments(tex)
  const joined = lines.join('\n')
  const findings = []
  const add = (chk, sev, detail, locations) => findings.push({ check: chk, severity: sev, detail, locations: locations || [] })

  // 1. anonymization (only if the venue is double-blind)
  if (constraints.anonymous) {
    const author = /\\author\s*\{([\s\S]*?)\}/.exec(joined)
    if (author && author[1].trim() && !/anonymous|anonymized|paper\s*id|submission/i.test(author[1])) {
      add('anonymization', 'blocker', 'non-empty, non-anonymized \\author block', findLines(lines, /\\author/))
    }
    const thanks = findLines(lines, /\\thanks\s*\{/)
    if (thanks.length) add('anonymization', 'blocker', '\\thanks present (often carries identity/funding)', thanks)
    const ack = findLines(lines, /\\(section|subsection)\*?\s*\{\s*acknowledge?ments?\s*\}|\\begin\{acknowledge?ments?\}/i)
    if (ack.length) add('anonymization', 'major', 'acknowledgments section present (must be removed/anonymized for blind review)', ack)
    const selfref = findLines(lines, /\b(our|my)\s+(prior|previous|earlier|recent)\s+(work|paper|study|method)\b/i)
    if (selfref.length) add('anonymization', 'major', 'self-referential phrasing that can de-anonymize (verify semantically)', selfref)
    const urls = findLines(lines, /\b(github\.com|gitlab\.com|bitbucket\.org|huggingface\.co)\//i)
    if (urls.length) add('anonymization', 'major', 'code/data URL that may reveal identity (use an anonymized mirror)', urls)
    const emails = findLines(lines, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    if (emails.length) add('anonymization', 'major', 'email address present', emails)
  }

  // 2. margin / spacing hacks
  const negv = findLines(lines, /\\vspace\*?\s*\{\s*-/)
  if (negv.length) add('spacing-hack', 'major', `negative \\vspace (${negv.length}) -- often used to cheat the page limit`, negv.slice(0, 10))
  const dims = findLines(lines, /\\(setlength|addtolength)\s*\{\s*\\(textheight|textwidth|topmargin|oddsidemargin|evensidemargin|footskip|parskip|parsep|itemsep|floatsep|textfloatsep|intextsep)\b/)
  if (dims.length) add('spacing-hack', 'major', 'manual change to a page-geometry / spacing dimension (margin or float spacing hack)', dims)
  const stretch = findLines(lines, /\\(renewcommand\s*\{\s*\\baselinestretch\s*\}|linespread)\s*\{?\s*0?\.[0-9]/)
  if (stretch.length) add('spacing-hack', 'major', 'reduced line spacing (baselinestretch/linespread < 1)', stretch)

  // 3. documentclass options
  const dc = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(joined)
  if (dc) {
    if (constraints.documentclass && !dc[2].split(',').map((s) => s.trim()).includes(constraints.documentclass)) {
      add('template-identity', 'blocker', `\\documentclass is {${dc[2]}} but the project expects {${constraints.documentclass}}`, findLines(lines, /\\documentclass/))
    }
    if (Array.isArray(constraints.allowed_documentclass_options)) {
      const opts = (dc[1] || '').split(',').map((s) => s.trim()).filter(Boolean)
      const bad = opts.filter((o) => !constraints.allowed_documentclass_options.includes(o))
      if (bad.length) add('template-identity', 'major', `unexpected \\documentclass options: ${bad.join(', ')}`, findLines(lines, /\\documentclass/))
    }
  }

  // 4. required sections
  if (Array.isArray(constraints.required_sections)) {
    const titles = (joined.match(/\\(?:section|subsection)\*?\s*\{([^}]*)\}/g) || []).map((s) => s.toLowerCase())
    for (const req of constraints.required_sections) {
      if (!titles.some((t) => t.includes(req.toLowerCase()))) add('required-section', 'major', `required section not found: "${req}"`, [])
    }
  }

  // 5. page limit (only with a real compiled count)
  if (constraints.page_limit && pages != null) {
    if (pages > constraints.page_limit) add('page-limit', 'blocker', `compiled to ${pages} pages, limit is ${constraints.page_limit}`, [])
  }

  const summary = { blocker: 0, major: 0, minor: 0 }
  findings.forEach((f) => { if (summary[f.severity] != null) summary[f.severity]++ })
  return { findings, summary, page_check_ran: !!(constraints.page_limit && pages != null), passed: summary.blocker === 0 && summary.major === 0 }
}

function main() {
  const [texFile, constraintsFile] = process.argv.slice(2)
  const rest = process.argv.slice(4)
  const flags = {}
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i++ }
  if (!texFile || !constraintsFile) {
    console.error('usage: node compliance-check.js <manuscript.tex> <constraints.json> [--pages N]')
    process.exit(2)
  }
  const tex = fs.readFileSync(texFile, 'utf8')
  const constraints = JSON.parse(fs.readFileSync(constraintsFile, 'utf8'))
  const res = check(tex, constraints, flags.pages ? parseInt(flags.pages, 10) : null)
  console.log(JSON.stringify(res, null, 2))
  process.exit(res.passed ? 0 : 1)
}

if (require.main === module) main()

module.exports = { check }
