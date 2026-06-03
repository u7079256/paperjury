[English](README.md) · **中文**

# paper-review-loop

> 一套可移植的范式,用来编辑并加固任意 CS 会议论文,提供三种模式。

<p align="center">
  <a href="https://u7079256.github.io/papercourt/overview.html?lang=zh"><img alt="打开在线交互式总览" src="https://img.shields.io/badge/在线交互式总览-d6a14b?style=for-the-badge&logo=githubpages&logoColor=white"></a>
</p>

一个 Claude Code skill,负责编辑并加固 CS 会议论文。它是同一个 skill 暴露出的三种模式(direct-edit、review、auto),底层由一套庭审式(courtroom)review 引擎和确定性 guards 支撑。

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

## 适用范围

**仅限 CS 会议。** 三大 venue 家族,各有自己的 style profile:

- **Vision**: CVPR, ICCV, ECCV, WACV
- **NLP**: ACL, EMNLP, NAACL, COLING
- **ML**: ICLR, NeurIPS, ICML, AAAI, COLM

范围就是这三个家族、这些会议名,不含期刊、系统类 venue 或 workshop。

---

## 三种模式

### Direct-Edit(常用)

- **触发方式:** 用户用中文或英文描述一处改动,想直接改 LaTeX。
- **示例:** "把这段改成…"、"polish this paragraph"、"把我对 intro 的想法写成 LaTeX"、"tighten this"。
- **行为:** 不上 review 阶段,直接走写作工具起草补丁,获得作者确认。

### Review(偶尔)

- **触发方式:** 用户想给论文挑刺、做加固:review / critique / 审稿 / 评审 / mock-review,或者迭代一份草稿来清掉评审者提出的问题。
- **行为:** 启动庭审式评审引擎(`references/review-engine-v3.md`)。
- **范围子触发:** `full`(整篇)或 `passage`(某一节 / 段落 / claim)。

### Auto(无人值守)

- **触发方式:** 用户通过 `/goal` 或配置 `mode: auto` 显式开启无人值守循环,让评审与修订循环朝一个可验证的目标推进。
- **硬约束:** 绝不自动进入 auto 模式,仅能显式开启;它没有任何运行时信号,只能通过 `/goal` 上下文或项目配置 `mode: auto` 进入。
- **行为:** 先获取作者对核心方向和评审分配的确认,之后引擎按预授权的 bounded-aggressive + 编辑安全策略,自动落安全 fix、把有风险的改动入队,多轮迭代直到书记官判定收敛(详见 `references/auto-mode.md`)。

---

## 如何触发 / quick start

说出想要什么,skill 会把请求路由到对应模式:

- 想直接改 LaTeX → 直接描述改动(如 "polish this paragraph"、"把这段改成…")。→ **Direct-Edit 模式。**
- 想批评 / 加固 → 说 review / critique / 审稿 / 评审 / mock-review,可选范围 `full` 或 `passage`。→ **Review 模式。**
- 想要朝目标无人值守循环 → 通过 `/goal` 或配置 `mode: auto` 显式开启。→ **Auto 模式。**

---

## 引擎总览

庭审引擎的步骤为:评审员分配 → 完整阅读检查 → 覆盖审计 → 去重 →(审议 ‖ 润色) → 召回审计 → 编辑起草 → 编辑 / 含义审计 → 书记官收敛。生成端有界(N 个领域评审者),审议端按争议程度分流,多轮循环由确定性的书记官判定收敛。

### 确定性步骤

1. **读稿分解**:把手稿切成阅读单元、规范的段落列表、稳定的段落编号(防止漂移,为陪审团提供局部上下文)。
2. **核心声明**(仅 auto 模式):提取核心声明,获得作者确认,冻结为配置。
3. **账本**:活跃问题状态的机器可读源,跨轮跨会话持久化。包含 gate 逻辑(没有阻断 gate 的活跃 major 即为完成;author-required 不阻断 gate,累计进人工队列)。
4. **日志**:编辑历史的仅追加记录,支持回滚。
5. **补丁应用**:原子性应用编辑,记录日志,支持恢复。
6. **锚点追踪**:定位已冻结的核心声明;当上下文变动时标出需要重新审计的部分。
7. **交叉引用检查**:编辑安全性预筛:改动的关键词是否在其他位置出现?如果出现,标记为需要语义审计。
8. **编译检查**:尝试真实 LaTeX 编译;如果无法编译,降级到结构检查并诚实报告不可验证。
9. **提交合规检查**:确定性的案前筛查。

### 语义步骤

1. **评审员分配**:根据论文研究方向,实例化 N 个领域评审者。
2. **完整阅读检查**:每位评审者读一遍全文,识别弱点(重要性、类别、具体引文)和总体信心度,以及按段落的覆盖报告。
3. **覆盖审计**:跨评审者检查是否有段落被略读。
4. **去重**:合并重复的评论,确定性地导出重要性、问题类别和交叉确认。
5. **审议**:根据可争议性分流。对有争议的问题,进行论证和陪审团判定;无明显多数时升到 12 人陪审团。
6. **润色**:快路径处理机械性问题和轻微问题;如果判断错误,升级回审议。
7. **审核补救**:检查是否遗漏或误判的问题。
8. **编辑起草**:对确认的可修复问题起草最小改动。
9. **编辑审计** / **含义审计**:审查高风险编辑的通顺性和一致性,以及对核心声明的影响。
10. **书记官**:汇总本轮的结果,去重残留的问题,确定性判定是否收敛。

也支持简化的 3 人评审小组作为快速路径。

---

## 三原语:Skill + Workflow + Memory

1. **Skill(入口 + 方法论):** 协议、reviewer 分配、consensus gate、writing toolkit、人工 gate。详见 `references/review-engine-v3.md`、`references/reviewer-personas.md`、`references/writing-toolkit.md`。
2. **Workflow(fan-out 引擎):** 语义层、无人居中的步骤以 Workflow 运行(并行 + 构造上即 schema 校验的输出)。简单 panel = `workflows/review-panel.workflow.js`;庭审引擎 = `assign-reviewers → reading-check → coverage-auditor → merge → {trial ‖ polish} → recall-audit → drafter → {edit-audit | meaning-audit} → clerk`。确定性 guards 由 orchestrator 侧经 Bash 在各 workflow 调用之间运行,因为 Workflow sandbox 没有 fs:`scripts/` 里有 `decompose`、`ledger`、`journal`、`apply-patch`、`anchor-diff`、`cross-ref`、`spine`、`compile-guard`、`compliance-check`。
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

1. **未经作者显式确认,绝不改手稿。** auto 模式在前期获得作者对核心方向和修订范围的整体授权,之后基于预设策略应用修改,而不是逐次确认。
2. **评审者 / 陪审员相互隔离。** 每轮都是 fresh eyes:互不通气、无上一轮信息泄漏、也看不到 ledger;靠「放进每个 agent prompt 的内容」加「每个 reviewer 型 prompt 里显式的 ISOLATION 指令」双重保证。
3. **每条可修复问题都有明确的修复标准。** 由法官设定,说明一处编辑具体要满足什么。
4. **不向被审文本泄漏。** 评审日志、修订记录和内部检查结论都是作者侧的辅助,绝不进入论文或冻结快照。
5. **分歧靠讨论解决,谈不拢再由人 override 覆盖(记录在案),绝不暗地驳回。**
6. **所有路径和文件配置都在运行时解析,不硬编码。**

---

## 架构说明

- Workflow sandbox 没有文件系统、也没有子进程;正因如此,所有确定性 guards 都由 orchestrator 侧经 Bash 在各 workflow 调用之间运行。
- compile-guard.js 对不可验证性诚实:无法真正编译时,降级到结构 lint 并报告 compiled:null。
- 提交就绪检查跨模式,分两部分:A = compliance-check.js + 一个语义 agent;B = 复用 compile-guard.js 的编译驱动版面循环,配合对 PDF 的 Read。

---

## 文件 / 路径速查

- 引擎协议:`references/review-engine-v3.md`
- 自动模式:`references/auto-mode.md`
- 评审者角色、编辑工具、方法论:`references/reviewer-personas.md`、`references/writing-toolkit.md`、`references/methodology.md`
- 账本结构和状态:`references/ledger-schema.md`
- 提交合规:`references/submission-compliance.md`
- 设计说明:`docs/REVIEW_ENGINE_V3_DESIGN.md`
- 脚本:`scripts/`
- 步骤:`workflows/`

---

## Credits / 致谢

spine 与防漂移设计(anchor logic-transfer audit、claim register、minimal-edit 且保义的改写策略)受 [PaperSpine](https://github.com/WUBING2023/PaperSpine) 启发,它是一个 motivation-driven 的论文起草与改写 skill。PaperSpine 是 forward generate/rewrite 工具、没有对抗 loop;paper-review-loop 借用它的 anchoring 思路,以及「可检查步骤交给确定性脚本、判断交给 model agent」这一机制,再在其上加了对抗式庭审 review 引擎。
