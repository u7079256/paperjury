#!/usr/bin/env node
// cross-ref.js -- v3 edit-safety deterministic risk pre-filter (review-engine-v3.md
// §3.8). Together with anchor-diff.js it classifies a drafted {before,after} patch as
// LOW (isolated -> apply under compile-guard+journal, batchable) or RISKY (-> the
// semantic edit-audit). The cross-ref half asks: does a SALIENT token that the edit
// CHANGED also appear in OTHER passages? If so the edit could create a cross-section
// inconsistency (a number that must match a table, a symbol/defined-term reused
// elsewhere, a \ref/\cite/\label key), so it is RISKY.
//
// Only CHANGED salient tokens count (the symmetric difference of salient(before) and
// salient(after)): a pure prose/typo edit that touches no number/symbol/ref stays LOW
// (the fast path). A false RISKY only costs one cheap edit-audit agent; a false LOW is
// the dangerous direction, so salient extraction is deliberately broad.
//
// Salient = decimals/percents/3+digit numbers, \label|\ref|\eqref|\cref|\cite{...}
// keys, inline-math identifiers/commands, CamelCase/ALLCAPS identifiers (>=2 capitals),
// and LaTeX \commands minus a common-formatting denylist.
//
// CLI:
//   node cross-ref.js <current.tex>     # patch JSON {before,after} on stdin
// Output: { risky, edited_passage_id, changed_tokens:[..], hits:[{token, passage_id}] }.

'use strict'
const fs = require('fs')
const { decompose } = require('./decompose')

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const normLow = (s) => norm(s).toLowerCase()

const FORMATTING = new Set([
  'textbf', 'textit', 'emph', 'text', 'mathrm', 'mathbf', 'section', 'subsection',
  'subsubsection', 'paragraph', 'item', 'begin', 'end', 'centering', 'caption',
  'includegraphics', 'hline', 'midrule', 'toprule', 'bottomrule', 'cmidrule',
  'footnote', 'vspace', 'hspace', 'newline', 'par', 'small', 'large', 'bf', 'it',
  'rm', 'left', 'right', 'quad', 'qquad', 'textwidth', 'columnwidth', 'centerline',
  'noindent', 'indent', 'bfseries', 'itshape', 'scriptsize', 'footnotesize', 'em',
])

function salientTokens(text) {
  const t = new Set()
  if (!text) return t
  for (const m of text.matchAll(/\b\d+\.\d+%?|\b\d+%|\b\d{3,}\b/g)) t.add(m[0])
  for (const m of text.matchAll(/\\(?:label|ref|eqref|cref|Cref|autoref|cite[a-zA-Z]*)\{([^}]*)\}/g)) {
    for (const key of m[1].split(',')) { const k = key.trim(); if (k) t.add('@' + k) }
  }
  for (const m of text.matchAll(/\$([^$]+)\$/g)) {
    for (const tok of (m[1].match(/[A-Za-z]\w+|\\[a-zA-Z]+/g) || [])) if (tok.length >= 2) t.add(tok)
  }
  for (const m of text.matchAll(/\b[A-Za-z]*[A-Z][A-Za-z]*[A-Z][A-Za-z0-9]*\b/g)) if (m[0].length >= 3) t.add(m[0])
  for (const m of text.matchAll(/\\([a-zA-Z]+)/g)) if (!FORMATTING.has(m[1])) t.add('\\' + m[1])
  return t
}

function symmetricDiff(a, b) {
  const out = new Set()
  for (const x of a) if (!b.has(x)) out.add(x)
  for (const x of b) if (!a.has(x)) out.add(x)
  return out
}

// token -> a plain searchable string (strip the @ marker we used for ref/cite keys)
function searchForm(tok) { return tok.startsWith('@') ? tok.slice(1) : tok }

function crossRef(patch, passages) {
  const before = patch.before || ''
  const after = patch.after || ''
  const changed = [...symmetricDiff(salientTokens(before), salientTokens(after))]
  const editedNorm = normLow(before)
  const edited = passages.find((p) => editedNorm && normLow(p.text).includes(editedNorm)) || null
  const others = passages.filter((p) => p !== edited)
  const hits = []
  for (const tok of changed) {
    const needle = searchForm(tok)
    if (!needle) continue
    for (const p of others) {
      // case-sensitive contains for identifiers/numbers/keys (consistency is case-sensitive)
      if (p.text.includes(needle)) { hits.push({ token: tok, passage_id: p.passage_id }); break }
    }
  }
  return {
    risky: hits.length > 0,
    edited_passage_id: edited ? edited.passage_id : null,
    changed_tokens: changed,
    hits,
  }
}

function readStdin() {
  const d = fs.readFileSync(0, 'utf8')
  return d && d.trim() ? JSON.parse(d) : null
}

function main() {
  const [curFile] = process.argv.slice(2)
  if (!curFile) { console.error('usage: node cross-ref.js <current.tex>  (patch {before,after} on stdin)'); process.exit(2) }
  const patch = readStdin()
  if (!patch) throw new Error('cross-ref expects a patch JSON {before,after} on stdin')
  const passages = decompose(fs.readFileSync(curFile, 'utf8'))
  console.log(JSON.stringify(crossRef(patch, passages), null, 2))
}

if (require.main === module) main()

module.exports = { crossRef, salientTokens, symmetricDiff }
