[English](README.md) · **中文**

# paper-review-loop

> 一套可移植的范式,用来编辑并加固任意 CS 会议论文,提供三种模式。

<p align="center">
  <a href="https://u7079256.github.io/papercourt/overview.html?lang=zh"><img alt="打开在线交互式总览" src="https://img.shields.io/badge/在线交互式总览-d6a14b?style=for-the-badge&logo=githubpages&logoColor=white"></a>
</p>

一个 Claude Code skill,负责编辑并加固 CS 会议论文。它是同一个 skill 暴露出的三种模式(direct-edit、review、auto),底层由一套庭审式(courtroom)review 引擎和确定性 guards 支撑。

交互式总览:[在线站点](https://u7079256.github.io/papercourt/overview.html?lang=zh)(GitHub Pages),或仓库内 [`docs/overview.html`](docs/overview.html)。

---

## 安装

它是一个 Claude Code skill(暂无 plugin 市场入口)。把仓库 clone 进 Claude Code 读取 skill 的目录即可:

```bash
git clone https://github.com/u7079256/papercourt ~/.claude/skills/paper-review-loop
```

(或放在 `<项目>/.claude/skills/` 下,只对单个项目生效)。Claude Code 通过 `SKILL.md` 自动发现它,随后以 `paper-review-loop` 出现在 skill 列表里。需要 `node`(确定性检查在它上面跑);LaTeX 工具链可选(只有版面/编译检查用得到)。

**给 Claude / 编码 agent:** 更深的「怎么驱动它」参考是 [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) —— 安装、三种模式及触发、引擎管线、`auto` 与 `/goal` 的区别、fan-out 怎么启动,都是写给 agent 读的。好奇内部细节,直接让 Claude 读这个文件再问它。

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
- **行为:** 先获取作者对核心方向和评审分配的确认,之后引擎按预授权的 bounded-aggressive + 编辑安全策略,自动落安全 fix、把有风险的改动入队,多轮迭代到停下为止——书记官判定收敛,或 applied-quiescence / 硬上限兜底(详见 `references/auto-mode.md`)。

---

## 使用示例:什么情况该怎么做

你不用敲命令;说出想要什么,skill 自己选模式。

**改一处(日常 → direct-edit):**
- "把这段 intro 改紧一些。" / "Polish this paragraph."
- "把我对 intro 的中文想法写成 LaTeX:`<你的想法>`。"
- "de-AI 这段。" / "这句压到一行。" / "重写这个 caption。"
- → 它起草 LaTeX 改动、自检、把补丁给你看,你批准后才落。不开面板。

**投稿前让它挑刺(→ review):**
- "审稿。" / "Review my paper." / "投之前 mock-review 一下。"
- "只评 Section 3.2。" / "review passage `<你贴的那条 claim>`。"
- "这是评审提的问题,迭代草稿把它们清掉。"
- → 它跑对抗引擎,挑出真正的弱点(把致命缺陷和小毛病分开),逐条带你走:你给方向,它起草、你授权才改。没你签字不动稿。

**无人值守朝目标加固(→ auto,需要 `/goal`):**
- `/goal "harden the paper until ledger.js gate passes(0 个阻断 gate 的 major)"`
- → 它自己跑多轮评审-修订循环,自动落安全 fix、把有风险的入队等你回来一次过。这需要 `/goal` 驱动:只开 "auto" 工具放行 + 发普通 prompt 只跑一轮就停,不会循环(原因见 [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) §3)。

**确认不会被 desk-reject:**
- "跑一下 submission-readiness / 合规检查。" → 确定性的格式筛查 + 编译驱动的版面检查。

一句话:**改一处 → 直接说;想被挑刺 → 说「审稿」;想无人值守 → `/goal`。**

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
2. **完整阅读检查**:每位 holistic reviewer 通读全文一遍 → 弱点(significance + kind + 逐字引文——引不出原文 = 没真读)+ 一个 overall_confidence + 按节的覆盖报告;反 skim 带定向重读模式。
3. **覆盖审计**:反 skim 第 2 层,跨覆盖报告标出被略读的(reviewer, 节)对。
4. **去重**:合并重复的评论,确定性地导出重要性、问题类别和交叉确认。
5. **审议(trial)**:对有争议的问题开庭——5 人首层、全文辩护 → 独立陪审员带局部上下文(可按需扩展)→ 确定性 quorum + 一方 >60% 多数裁定,法官给 decided-valid 路由(valid-fixable vs author-required);无明显多数升到 12 人。
6. **润色**:快路径处理机械性问题和轻微问题;如果判断错误,升级回审议。
7. **审核补救(recall)**:Mode A 救回被误丢的 charge(倾向于救);Mode B 在落稿前抽检强共识的 major(防共识集体出错)。
8. **编辑起草**:对确认的可修复问题起草最小改动。
9. **编辑审计 / 含义审计**(edit-safety 的语义半,两个独立 workflow):edit-audit 查高风险非锚改动(通顺性 + 跨节一致性);meaning-audit 是四态的冻结锚 + 论证弧审计。
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

panel 是 N 个领域专家 holistic reviewer(默认 3 个,范围 2-4),运行时按论文 subfield 分配,共享一个资深 reviewer gatekeeper 内核(严苛、精确、建设性;把致命缺陷与可修补小问题分开;跨 section 推理)。当某个 reviewer slot 无法确认(headless)时,该 slot 退回通用 gatekeeper(一个坏 slot 不拖垮整个 panel);通用回退 lens 为:

- **Theory / Foundations**:定义、证明缺口、记号、不变性 / 最优性 / 一般性 claim。
- **Empirical / Benchmark**:baseline 公平性 / 新旧、metric 正确性、数据集划分、方差、ablation 覆盖、cherry-picking。
- **Applied / Systems**:实用性、效率 / latency / 显存 claim、可复现性、部署现实性、scaling。

(这三类是无固定次序的倾向,不是固定 slot;reviewer 编号 `R1..RN` 是按 subfield 顺序排的位置编号。)

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
