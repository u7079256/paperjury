#!/usr/bin/env node
// decompose.js -- a pragmatic, LaTeX-aware sectioner for the paperjury.
// Produces (a) section-level UNITS for the reading-check fan-out (one agent reads
// one coherent unit) and (b) paragraph-level PASSAGES each with a cross-round
// STABLE passage_id, which the auto per-passage rounds-touched counter and the
// oscillation guard key on (AUTO_MODE_DESIGN §8). Dependency-free Node.
//
// passage_id = `<section-path>#p<ordinal>#<anchor-hash>` where anchor-hash is a
// sha1 of the nearest \label{...} in the paragraph, else of its first stable words.
// Section path is computed from \section/\subsection/... counters; it need not
// match the paper's printed numbering, only be CONSISTENT across rounds.
//
// This is a heuristic splitter, not a TeX parser: it strips line comments, finds
// sectioning commands + the abstract env, and splits regions on blank lines. Good
// enough to chunk a manuscript and to give passages stable identity; it does not
// expand macros or resolve \input (the orchestrator passes one flattened file).
//
// CLI:
//   node decompose.js passages <file.tex>   # JSON array of paragraph passages
//   node decompose.js units    <file.tex>   # JSON array of section-level units
//   node decompose.js stats    <file.tex>   # quick counts

'use strict'
const fs = require('fs')
const crypto = require('crypto')

function stripComments(tex) {
  return tex.split(/\r?\n/).map((line) => {
    let out = ''
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '%' && (i === 0 || line[i - 1] !== '\\')) break
      out += line[i]
    }
    return out
  }).join('\n')
}

// From an index pointing AT a '{', return {content, end} with end just past the '}'.
function braceArg(str, at) {
  if (str[at] !== '{') return { content: '', end: at }
  let depth = 0
  for (let i = at; i < str.length; i++) {
    if (str[i] === '{') depth++
    else if (str[i] === '}') { depth--; if (depth === 0) return { content: str.slice(at + 1, i), end: i + 1 } }
  }
  return { content: str.slice(at + 1), end: str.length }
}

function hash8(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8) }

function firstStableWords(text, n = 8) {
  const words = text.replace(/\\[a-zA-Z]+[a-zA-Z0-9_]*\*?/g, ' ').replace(/[^A-Za-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(Boolean).slice(0, n)
  return words.join(' ').toLowerCase()
}

const LEVELS = { part: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 }

// Walk the body, return regions [{section_path, title, level, start, end}].
function regions(body) {
  const re = /\\(part|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/g
  const marks = []
  let m
  while ((m = re.exec(body))) {
    const braceOpen = re.lastIndex - 1
    const { content, end } = braceArg(body, braceOpen)
    marks.push({ index: m.index, contentEnd: end, level: LEVELS[m[1]], title: content.trim() })
    re.lastIndex = end
  }
  const out = []
  // frontmatter before the first section command
  const firstStart = marks.length ? marks[0].index : body.length
  out.push({ section_path: 'frontmatter', title: 'Front matter', level: 0, start: 0, end: firstStart })
  const counters = [0, 0, 0, 0, 0]
  for (let i = 0; i < marks.length; i++) {
    const mk = marks[i]
    counters[mk.level]++
    for (let l = mk.level + 1; l < counters.length; l++) counters[l] = 0
    const path = counters.slice(1, mk.level + 1).join('.') || String(counters[0])
    const end = i + 1 < marks.length ? marks[i + 1].index : body.length
    out.push({ section_path: path, title: mk.title, level: mk.level, start: mk.contentEnd, end })
  }
  return out
}

function abstractSpan(body) {
  const m = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(body)
  if (!m) return null
  return { start: m.index, end: m.index + m[0].length }
}

function splitParagraphs(text) {
  return text.split(/\n[ \t]*\n/).map((p) => p.trim()).filter((p) => p.length > 0)
}

function decompose(tex) {
  const clean = stripComments(tex)
  const docStart = clean.indexOf('\\begin{document}')
  const bodyOffset = docStart >= 0 ? docStart + '\\begin{document}'.length : 0
  const body = clean.slice(bodyOffset)
  const abs = abstractSpan(body)
  const regs = regions(body)

  const passages = []
  for (const reg of regs) {
    const regText = body.slice(reg.start, reg.end)
    const paras = splitParagraphs(regText)
    let ord = 0
    let cursor = reg.start
    for (const para of paras) {
      ord++
      const labelM = /\\label\{([^}]*)\}/.exec(para)
      const anchorSrc = labelM ? labelM[1] : firstStableWords(para)
      const pStart = body.indexOf(para, cursor)
      const center = pStart >= 0 ? pStart + Math.floor(para.length / 2) : -1
      const in_abstract = abs && center >= abs.start && center < abs.end
      passages.push({
        passage_id: `${reg.section_path}#p${ord}#${hash8(anchorSrc)}`,
        section_path: reg.section_path,
        section_title: reg.title,
        ordinal: ord,
        label: labelM ? labelM[1] : null,
        in_abstract: !!in_abstract,
        char_start: pStart >= 0 ? bodyOffset + pStart : null,
        text: para,
      })
      // always advance the cursor, even if this paragraph was not located verbatim,
      // so a single failed lookup cannot make later paragraphs re-match earlier text.
      cursor = pStart >= 0 ? pStart + para.length : cursor + para.length
    }
  }
  return passages
}

// Group passages into section-level reading units (concatenated text).
function units(passages) {
  const bySection = new Map()
  for (const p of passages) {
    if (!bySection.has(p.section_path)) {
      bySection.set(p.section_path, { section_path: p.section_path, section_title: p.section_title, passage_ids: [], text: '' })
    }
    const u = bySection.get(p.section_path)
    u.passage_ids.push(p.passage_id)
    u.text += (u.text ? '\n\n' : '') + p.text
  }
  return [...bySection.values()]
}

// ---- CLI ------------------------------------------------------------------

function main() {
  const [cmd, file] = process.argv.slice(2)
  if (!cmd || !file) {
    console.error('usage: node decompose.js <passages|units|stats> <file.tex>')
    process.exit(2)
  }
  const tex = fs.readFileSync(file, 'utf8')
  const ps = decompose(tex)
  if (cmd === 'passages') {
    console.log(JSON.stringify(ps, null, 2))
  } else if (cmd === 'units') {
    console.log(JSON.stringify(units(ps), null, 2))
  } else if (cmd === 'stats') {
    const secs = new Set(ps.map((p) => p.section_path))
    console.log(JSON.stringify({ passages: ps.length, sections: secs.size, abstract_passages: ps.filter((p) => p.in_abstract).length }))
  } else {
    console.error('unknown command: ' + cmd)
    process.exit(2)
  }
}

if (require.main === module) main()

module.exports = { stripComments, braceArg, regions, decompose, units, hash8, firstStableWords }
