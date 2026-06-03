[English](README.md) · **中文**

# paper-review-loop

> 一套可移植的范式,用来编辑并打磨任意 CS 会议论文,提供三种模式。

<p align="center">
  <a href="https://u7079256.github.io/papercourt/overview.html?lang=zh"><img alt="打开在线交互式总览" src="https://img.shields.io/badge/在线交互式总览-d6a14b?style=for-the-badge&logo=githubpages&logoColor=white"></a>
</p>

一个 Claude Code skill(v0.5.0),负责编辑并加固 CS 会议论文。它是同一个 skill 暴露出的三种模式(direct-edit、review、auto),底层由一套庭审式(courtroom)review 引擎(v3)和确定性 guards 支撑。

**状态(2026-06-03):** 三种模式均已 BUILT。v3 引擎经两个对抗式 workflow 加固过(一次设计 validation,一次已 build 代码的 cross-check,每条 finding 都由全新怀疑者复核),ledger 也有单元测试;但 v3 的 core **尚未**在真稿上端到端验证。**整链未实跑**(完整流水线从未在真实论文上跑通端到端)。

交互式总览:[在线站点](https://u7079256.github.io/papercourt/overview.html?lang=zh)(GitHub Pages),或仓库内 [`docs/overview.html`](docs/overview.html)。

---

## 这是什么 / 为什么

**是什么:** 一个 skill,三种模式(direct-edit、review、auto),底层由一套庭审式 review 引擎和确定性 guards 支撑。

**为什么这样设计:**

- 一套范式覆盖从快速 LaTeX 编辑到对抗式多 agent review 的全过程,而不是各自为政的零散工具。
- 对抗式 review 是构造层面就定下的:一支严苛、精确、建设性的领域 reviewer,把致命缺陷和可修补的小问题分开。
- 路由按 CONTESTABILITY(可争议性)而非 severity:只在指控真正存在争议时才投入深度审议,机械类和 minor 问题走廉价的 polish track。
- 人工 gate 与作者 sign-off 是一等公民,不是事后补的。
- 跨轮、跨会话的持久状态靠一份机器可读的 `ledger`,并由书记官(clerk)收敛的多轮循环驱动。

尚无任何采用情况、benchmark 或真实论文结果,不要据此推断(见[诚实 caveats](#诚实-caveats))。

## 适用范围

**仅限 CS 会议。** 三大 venue 家族,各有自己的 style profile:

- **Vision**: CVPR, ICCV, ECCV, WACV
- **NLP**: ACL, EMNLP, NAACL, COLING
- **ML**: ICLR, NeurIPS, ICML, AAAI, COLM

范围就是这三个家族、这些会议名,不含期刊、系统类 venue 或 workshop。

---

## 三种模式

三种模式均已 BUILT。每种模式的 verification caveat 见[诚实 caveats](#诚实-caveats),使用时务必一并对照。

### Direct-Edit(常用)

- **触发方式:** 用户用中文或英文描述一处改动,想直接改 LaTeX。
- **示例口令:** "把这段改成…"、"polish this paragraph"、"把我对 intro 的想法写成 LaTeX"、"tighten this"。
- **行为:** 不上 review panel,直接走 writing toolkit 起草补丁,带作者 sign-off。

### Review(偶尔)

- **触发方式:** 用户想让论文被批评或被加固:review / critique / 审稿 / 评审 / mock-review,或者迭代一份草稿来清掉 reviewer 提出的问题。
- **行为:** 跑 v3 庭审式 review 引擎(`references/review-engine-v3.md`)。
- **范围子触发:** `full`(整篇)或 `passage`(某一节 / 段落 / claim)。

### Auto(无人值守)

- **触发方式(仅显式):** 用户通过 `/goal`(或配置 `mode: auto`)主动开启,让 review-revise 循环离线朝一个可验证的目标推进。
- **硬约束:** **绝不自动判定进入 auto,只能显式开启。** auto 不会自行检测 headless(没有运行时信号),只能通过 `/goal` 上下文或项目配置 `mode: auto` 开启。
- **行为:** 先把 `spine` 和 reviewer 分配立起来(人工步骤),之后引擎在 bounded-aggressive + edit-safety 策略下应用安全的修补、其余排队,并跑多轮直到 clerk 收敛停机。详见 `references/auto-mode.md`。
- **附注:** `/goal` 是 Claude Code 的真实功能(v2.1.139,2026 年 5 月),已核实存在。

---

## 如何触发 / quick start

说出你想要什么,skill 会把请求路由到对应模式:

- 想直接改 LaTeX → 直接描述改动(如 "polish this paragraph"、"把这段改成…")。→ **Direct-Edit 模式。**
- 想批评 / 加固 → 说 review / critique / 审稿 / 评审 / mock-review,可选范围 `full` 或 `passage`。→ **Review 模式。**
- 想要朝目标无人值守循环 → 通过 `/goal` 或配置 `mode: auto` 显式开启。→ **Auto 模式。**

> **安装 / 配置:** 此处暂未记录。安装步骤、CLI 调用串、repo 路径设置,以及除字面 key `mode: auto` 之外的配置文件格式 / 位置,均由维护者补充。

---

## 引擎总览(v3)

v3 庭审引擎为 `assign-reviewers → reading-check → coverage-auditor → merge → {trial(+ escalate)‖ polish} → recall-audit → drafter → {edit-audit | meaning-audit} → clerk`。生成端有界(N 个 holistic 领域 reviewer,而非逐 (unit × lens) 的洪流);审议端按可争议性路由;编辑按风险设防;多轮循环由确定性的 clerk 收敛。**确定性 guards 放在 `scripts/` 里**,由 orchestrator 侧经 Bash 在各 workflow 调用之间运行(Workflow sandbox 没有文件系统 / 子进程)。

### 确定性阶段(orchestrator 侧,Node 经 Bash)

1. `decompose`:把手稿切成 reading unit、规范的 section 列表、稳定的 `passage-id`(防漂移底座 + juror 局部上下文来源)。
2. `spine`(仅 auto):抽取 anchor、作者确认、冻结为 `spine.json`。
3. `ledger.js`:JSON ledger + MD 视图;**gate = `/goal` 完成事实**(0 个 gate-blocking 活跃 major;author-required 不计入 gate,会累积到人工队列)。CLI:init/add/set/count/gate/get/docket/unadjudicated/render。*(已单元测试。)*
4. `journal.js`:仅追加的逐次编辑回滚日志(JSONL)。
5. `apply-patch.js`:原子应用 + 对所起草补丁记 journal,并支持 revert(对 `before` 文本做 exact-once 守卫)。
6. `anchor-diff.js`:定位被冻结的 anchor;当支撑区域变动时标出哪些 `need_audit`。
7. `cross-ref.js`:edit-safety 风险预筛:补丁里改动过的 salient token 是否在其他 passage 出现?
8. `compile-guard.js`:真实 LaTeX 编译(latexmk/pdflatex),或降级到结构 lint 并报 `compiled:null`(诚实承认不可验证)。
9. `compliance-check.js`:submission-readiness A:确定性的 desk-reject 筛查。

### 语义阶段(workflow fan-out)

1. `assign-reviewers`:命名 N 个 subfield,从项目 gatekeeper 内核 + 生成的领域 overlay 实例化 N 个领域 reviewer;config-pin / verifier / 单 slot 降级(headless)。
2. `reading-check`:N 个 holistic reviewer 各自把整篇读一遍 → weaknesses(significance + kind + 逐字引文)+ 一个 overall_confidence + 逐 section 的覆盖报告;带定向 re-invoke 模式做 anti-skim。
3. `coverage-auditor`:anti-skim L2:跨各 reviewer 的覆盖报告标出被略读的 (reviewer, section)。
4. `merge`:跨 reviewer 语义去重;由 workflow 确定性地导出 significance(取 MAX)/ kind(substantive 优先)/ corroboration。
5. `trial`:5-tier:整篇上下文的辩护 → 去相关的局部上下文陪审团(可按需扩展上下文)→ 确定性的 quorum/majority 判定 + 法官对 decided-valid 的分流(valid-fixable vs author-required);无明显多数时升级到 12 人陪审团。
6. `polish`:off-gate 轨道:机械类的批量 copy-edit + minor-substantive 的批量 light-check;能把被错分的 major 升级回 trial。
7. `recall-audit`:Mode A 救回被误丢的指控(偏向救回);Mode B 在编辑前抽查强共识的 major(防范相关性错误的共识)。
8. `drafter`:给 valid-fixable 指控起草最小改动补丁。
9. `edit-audit` / `meaning-audit`:edit-safety 的语义半:`edit-audit` 审一处有风险的非 anchor 编辑(是否通顺 + 跨 section 一致);`meaning-audit` 是四态冻结 anchor + arc 审计。
10. `clerk`:轮边界:把 carried open-question 对本轮编辑核账,用确定性的 passage_id + 相似度 merge key 去重 re-raise,并产出确定性的收敛计数。

另有 `review-panel.workflow.js`:快速 / legacy 的简单 3-lens panel(快路径)。

> **v3 是怎么加固的(不是真稿结果):** consolidated 设计经一个对抗式 validation workflow 压测过(每条 open 设计决策都被认可;暴露的是数据契约写得不够细,已修)。已 build 的引擎再经第二个对抗式 workflow 做 cross-check(逐跨文件 seam,每条 finding 由全新怀疑者复核);确认的 code defect 已修,orchestrator seam 契约写进了 `references/review-engine-v3.md`。精度来自 verify 层,而非 agent 数量。v3 的 core **尚未**在真稿上端到端跑过。

---

## 三原语:Skill + Workflow + Memory

1. **Skill(入口 + 方法论):** 协议、reviewer 分配、consensus gate、writing toolkit、人工 gate。详见 `references/review-engine-v3.md`、`references/reviewer-personas.md`、`references/writing-toolkit.md`。
2. **Workflow(fan-out 引擎):** 语义层、无人居中的步骤以 Workflow 运行(并行 + 构造上即 schema 校验的输出)。简单 panel = `workflows/review-panel.workflow.js`;v3 庭审引擎 = `assign-reviewers → reading-check → coverage-auditor → merge → {trial ‖ polish} → recall-audit → drafter → {edit-audit | meaning-audit} → clerk`。确定性 guards 由 orchestrator 侧经 Bash 在各 workflow 调用之间运行,因为 Workflow sandbox 没有 fs:`scripts/` 里有 `decompose`、`ledger`、`journal`、`apply-patch`、`anchor-diff`、`cross-ref`、`spine`、`compile-guard`、`compliance-check`。
3. **Memory(持久状态 + 习得约定),两层:**
   - **Ledger**:运行时解析出的 `LEDGER.json` 是机器层的 source of truth,外加一份渲染出的 `LEDGER.md` 视图;由 `scripts/ledger.js` 管理。它是跨轮、跨会话的活的、可变的 issue 状态。schema 与状态机见 `references/ledger-schema.md`。
   - **Claude memory**:当前项目的 memory:值得下次会话回忆起的稳定约定(本论文的 house style、venue、persona 调校)。

### Reviewer

panel 是 N 个领域专家 holistic reviewer(默认 3 个),运行时按论文 subfield 分配,共享一个资深 reviewer gatekeeper 内核(严苛、精确、建设性;把致命缺陷与可修补小问题分开;跨 section 推理)。当分配降级(headless 无法确认)时,panel 回退到三个通用 lens:

- **R1 Theory/Foundations**:定义、证明缺口、记号、不变性 / 最优性 / 一般性 claim。
- **R2 Empirical/Benchmark**:baseline 公平性 / 新旧、metric 正确性、数据集划分、方差、ablation 覆盖、cherry-picking。
- **R3 Applied/Systems**:实用性、效率 / latency / 显存 claim、可复现性、部署现实性、scaling。

writing toolkit 的工具名(具体 prompt 内容此处不列):`translate-to-english`、`polish-english`、`de-ai`、`compress`、`expand`、`caption`、`experiment-analysis`、`logic-check`。

---

## 六条硬规则

1. **未经作者显式 sign-off,绝不改手稿。** auto 模式的例外处理:规则仍然成立;auto 靠 UP-FRONT sign-off(`spine` + reviewer 分配确认 + 预先授权的 bounded-aggressive 策略)加上返回队列来满足它,而不是逐次编辑都 sign-off。
2. **reviewer / juror 相互隔离。** 每轮都是 fresh eyes:无串话、无上一轮泄漏、看不到 `ledger`。由两点保证:(a) 进入每个 agent prompt 的内容,以及 (b) 每个 reviewer 类型 prompt 里一条明确的 ISOLATION 指令。
3. **每条 valid-fixable issue 都带一个 `close_criterion`**(一句具体的话,说明一处编辑要满足什么),由法官设定。
4. **不向被审文本泄漏。** revision 日志、回译、自检结论都是作者侧的辅助,绝不进入手稿或任何被冻结的快照。
5. **分歧靠讨论解决,然后是 override(记录在案),绝不悄悄驳回。**
6. **skill 里不写死任何路径或项目文件。** 一律运行时解析。

---

## 架构事实(补充)

- Workflow sandbox **没有文件系统、没有子进程**;这正是所有确定性 guards 都由 orchestrator 侧经 Bash 在各 workflow 调用之间运行的原因(这是设计事实,不是需要致歉的局限)。
- `compile-guard.js` 对不可验证性是诚实的:当它无法真正编译时,降级到结构 lint 并报 `compiled:null`。
- submission-readiness 跨模式,分两部分:**A** = `compliance-check.js` + 一个语义 agent;**B** = 复用 `compile-guard.js` + Read-on-PDF 的、由编译驱动的排版循环。A 已测,B 复用已测过的组件。

---

## 诚实 caveats

截至 2026-06-03。务必把「已 built + cross-check」和「在真稿上端到端验证」分开。

**已构建且通过验证:**

- 三种模式(direct-edit、review/v3、auto)均已 **BUILT**。
- 9 个确定性脚本;`ledger.js` 有单元测试(22 个用例)。
- v3 各 workflow 语义层 syntax-clean,且经一个对抗式 workflow(含全新怀疑者复核)做过契约 cross-check。
- 确定性的 `apply → compile → journal → revert` 链:**在隔离环境下**端到端跑通。

**尚未完成(直说):**

- **整链未实跑**:v3 的 core 从未在真实论文上跑通端到端。
- 三路分流准确性、5-tier trial、真编辑上的 drafter/apply/edit-safety 链、clerk 收敛、`/goal` auto 循环:**尚未在真稿上验证。**
- 真实规模的批量行为(约 600 agent/次调用)在负载下:尚未验证。

**每种模式的 caveat:**

- Direct-Edit:已 BUILT;组件级 smoke test 过;**未在真稿上端到端跑过。**
- Review/v3:已 BUILT、已 cross-check、ledger 已单元测试;**真稿端到端 validation 尚未做。**
- Auto:已 BUILT(引擎 + 外壳 + 外层循环);**完整循环在真实论文上未端到端跑过。**

**一句话总结(如实):**

> 三种模式均已 BUILT,v3 引擎也做过对抗式 cross-check,但**尚未**在真实论文上端到端验证。把契约 cross-check 一遍,不等于在一篇 10 页真稿上的正确性证明。

本 skill 不声称 "production-ready"、"validated" 或 "在真实论文上 proven"。也不声称任何 recall / precision 数字、真稿成本数字或采用情况;这些都尚未测量。

---

## 文件 / 路径速查

- 引擎协议(v3,含全部 orchestrator seam):`references/review-engine-v3.md`
- auto 协议:`references/auto-mode.md`
- personas / writing toolkit / 方法论:`references/reviewer-personas.md`、`references/writing-toolkit.md`、`references/methodology.md`
- ledger schema + 状态机:`references/ledger-schema.md`
- 提交合规:`references/submission-compliance.md`
- 设计 rationale:`docs/REVIEW_ENGINE_V3_DESIGN.md`(v2 设计文档作为历史保留)
- 脚本目录:`scripts/`(decompose、ledger、journal、apply-patch、anchor-diff、cross-ref、spine、compile-guard、compliance-check)
- workflow 目录:`workflows/`(assign-reviewers、reading-check、coverage-auditor、merge、trial、polish、recall-audit、drafter、edit-audit、meaning-audit、clerk、review-panel)

---

## Credits / 致谢

spine 与防漂移设计(anchor logic-transfer audit、claim register、minimal-edit 且保义的改写策略)受 [PaperSpine](https://github.com/WUBING2023/PaperSpine) 启发,它是一个 motivation-driven 的论文起草与改写 skill。PaperSpine 是 forward generate/rewrite 工具、没有对抗 loop;paper-review-loop 借用它的 anchoring 思路,以及「可检查步骤交给确定性脚本、判断交给 model agent」这一机制,再在其上加了对抗式庭审 review 引擎。

---

*已 build + 对抗式 cross-check,截至 2026-06-03。尚未在真实论文上端到端验证(整链未实跑)。本 README 仅陈述已落实的内容,不预判真稿上的正确性。*
