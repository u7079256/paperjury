const test = require('node:test')
const assert = require('node:assert/strict')
const { decompose, units, stripComments } = require('../scripts/decompose')

test('decomposes abstract and sections into stable passages', () => {
  const tex = String.raw`
\documentclass{article}
\begin{document}
\begin{abstract}
We study a compact setting.
\end{abstract}

\section{Introduction}
\label{sec:intro}
This paragraph defines the motivation.

\subsection{Details}
The second paragraph carries supporting context.
\end{document}
`
  const passages = decompose(tex)
  assert.ok(passages.length >= 3)
  assert.ok(passages.some((p) => p.in_abstract))
  assert.ok(passages.some((p) => p.label === 'sec:intro'))
  assert.ok(passages.every((p) => /^(frontmatter|\d+(?:\.\d+)*)#p\d+#[0-9a-f]{8}$/.test(p.passage_id)))

  const grouped = units(passages)
  assert.ok(grouped.some((u) => u.section_title === 'Introduction'))
  assert.ok(grouped.every((u) => u.passage_ids.length > 0))
})

test('strips escaped and full-line comments conservatively', () => {
  const input = 'Text before % remove this\nEscaped \\% keeps percent\n'
  const clean = stripComments(input)
  assert.match(clean, /Text before/)
  assert.doesNotMatch(clean, /remove this/)
  assert.match(clean, /Escaped \\% keeps percent/)
})
