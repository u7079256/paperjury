# PaperJury 修改对照表(中文版)

**输入(初稿):** `original_draft.pdf`(21 页,含 11 个已知缺陷)
**处理:** 用 PaperJury 跑一轮 AUTO 评审进行修改和调整
**输出:** `revised_draft.pdf`(22 页,编译 0 error、0 warning)

账本:152 条 reviewer weakness → 55 条 issue → 26 已应用 / 10 待作者 / 19 判为无效。

## 表一:可修复缺陷 F1-F6

| 问题定位 | 修复结果 | 人工验证 |
|---|---|---|
| **F1** §8 并发数:散文写 `8`、表格写 `16`,自相矛盾 | 已统一为 `16`(散文+表格) | ✅ 已核对,与初稿一致 |
| **F2** §7.2 clerk 合并阈值:散文写 `simThreshold=0.7`、相邻公式写 `0.8` | 已统一为 `0.8`(散文+公式) | ✅ 已核对,与初稿一致 |
| **F3** §5 升级陪审团:写 `jurySize=10`,全文别处为 `12` | 已改为 `12` | ✅ 已核对,与初稿一致 |
| **F4** §2 隔离不变量被篡改(写成"给了 jurors 累计 ledger") | 已恢复为"隔离、不看 ledger" | ✅ 已核对,语义一致 |
| **F5** §1 C5 术语写成 `registrar`,全文别处叫 `clerk` | 已改回 `clerk` | ✅ 已核对,与初稿一致 |
| **F6** §4 悬空引用 `\cite{wang2025programchair}`(bib 无此键) | 已删除该引用,编译无警告 | ✅ 已核对,与初稿一致 |

## 表二:伪造断言 A1-A3(初稿无此文,系凭空添加的无据断言)

| 问题定位 | 修复结果 | 人工验证 |
|---|---|---|
| **A1** 摘要伪造"94% router agreement…confirming…in practice"(无实验支撑) | 已软化为"illustrative target…Section 9 规定测量方法" | ✅ 已核对(过度断言已中和) |
| **A2** §4 伪造"in our runs…order of magnitude fewer agents…strictly higher precision"(无实验) | **未修复:原伪造句仍在稿中** | ⚠ 待作者处理(软化或删除) |
| **A3** §3 伪造"reaches this fixed point within three rounds"(无数据) | 已软化为"in a small number of rounds"(去掉"three") | ✅ 已核对(过度断言已中和) |

## 表三:诱饵 B1-B2(看似缺陷、实则可辩护,应保持不动)

| 问题定位 | 修复结果 | 人工验证 |
|---|---|---|
| **B1** §4"no per-section reviewer assignment and no per-section coverage quota"(看似覆盖漏洞) | 无需修复,原文保留 | ✅ 已核对(正确判为可辩护,无误报) |
| **B2** §7 gate"evaluated over the same ledger state the engine's own steps write"(看似循环论证) | 无需修复,原文保留 | ✅ 已核对(正确判为可辩护,无误报) |

## 表四:评审过程中引擎自己引入的问题(非注入缺陷)

| 问题定位 | 修复结果 | 人工验证 |
|---|---|---|
| §1 C3 被 polish 改成 "two-sided escalating trial",但 §5.2 标题 / §5.4 图注 / §9 仍叫 "five-tier" | **未修复:术语不一致仍在** | ⚠ 待作者处理(改回 "five-tier trial" 即可) |

## 小结
- 可修复类 **F1-F6 已全部对齐初稿期望**,输出稿在这六处与干净版一致。
- **待作者处理 2 处:** A2(伪造对比句仍在)、§1 C3 的 five-tier 术语不一致。
- A1/A3 过度断言已软化;诱饵 B1/B2 零误报、原文保留。
- 输出稿 `revised_draft.pdf` 编译 22 页、0 error、0 warning。
