[English](README.md) · **中文**

# PaperJury

> 投稿前，先做一轮 AI 审稿压力测试。

<p align="center">
  <a href="https://u7079256.github.io/paperjury/overview.html?lang=zh"><img alt="打开在线交互式总览" src="https://img.shields.io/badge/在线交互式总览-d6a14b?style=for-the-badge&logo=githubpages&logoColor=white"></a>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3b3d47?style=for-the-badge">
</p>

直接问 AI「我论文怎么样」,答案常常像抽奖:要么泛泛夸好,要么无限挑刺。PaperJury 把这件事改成闭环:审稿、裁定、修改、复查。

它会把每个问题分成三类:

- **可自动修:** 表达不清、claim 过强、结构不顺这类可以安全改掉的问题。
- **需作者补:** 缺实验、缺 ablation、缺数据或证据,得作者自己处理。
- **不成立:** AI reviewer 误读了论文,或者提了不该改的问题。

PaperJury 是一款 Claude Code skill,支持三种模式:direct-edit、review、auto。它不替代作者判断,也不替代 peer review,只是在你真正投稿之前,先把那些本可以提前发现的问题摆到台面上。

交互式总览:[在线站点](https://u7079256.github.io/paperjury/overview.html?lang=zh)(GitHub Pages),或仓库内 [`docs/overview.html`](docs/overview.html)。

---

## 使用边界

PaperJury 是投稿前的自查流程,不替代作者的科学判断,也不替代 peer review。它不该拿来编造实验、伪造结果、加上没有证据支撑的 claim,或者掩盖论文的局限。

凡是需要新实验、缺失证据、作者私有知识或研究层面判断的问题,PaperJury 都交回作者处理,而不是自动写进论文。三类结果(可自动修、需作者补、不成立)的划分正是为此:该由人拿主意的地方,主意始终在你手里。

它真正擅长的,是趁你还来得及动手,提前把那些本可避免的问题摆出来:表达不清、claim 过强、逻辑衔接不足、格式风险,以及 reviewer 视角下投稿前值得复查的弱点。

---

## 安装

它是一个 Claude Code skill。把仓库 clone 进 Claude Code 读取 skill 的目录即可:

```bash
# macOS / Linux
git clone https://github.com/u7079256/paperjury ~/.claude/skills/paperjury
```

```powershell
# Windows (PowerShell)
git clone https://github.com/u7079256/paperjury "$env:USERPROFILE\.claude\skills\paperjury"
```

(或放在 `<项目>/.claude/skills/` 下,只对单个项目生效)。Claude Code 通过 `SKILL.md` 自动发现它,随后以 `paperjury` 出现在 skill 列表里。需要 `node`(确定性检查在它上面跑);LaTeX 工具链可选(真编译和版面检查用得到,没有时会诚实降级)。

**给 Claude / 编码 agent:** 更深的「怎么驱动它」参考是 [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md):安装、三种模式及触发、引擎管线、`auto` 与 `/goal` 的区别、fan-out 怎么启动,都是写给 agent 读的。想了解内部细节,让 Claude 读这个文件后再问它。

---

## 它能给你什么

大多数写作工具只会把论文往前推:起草、润色。没有一个会像审稿人那样,站到你论断的对立面去较真。PaperJury 就是冲着这个缺口设计的,分四块。

- **对抗式,机制内建。** 不是一遍改写建议,而是一整套正当程序:N 位领域评审通读全文,可争议性路由把真正有分歧的问题送去双方对辩,5 位(只有迟迟没有明显多数时才升到 12 位)互相独立的评审在隔离下审议,裁决给出三种结论:可自动修、需作者补、不成立。能给出「不成立」,一味迎合的改写工具在机制上就做不到。
- **闭环多轮,而非单向前推。** 每一轮都是对改后稿的干净复评(评审看不到上一轮的台账,所以同一个问题被再次提出就是真正的相互印证,而不是被锚定),书记官按确定性规则把每一轮归并进同一份台账,直到某一轮干净复评不再冒出新问题。落任何改动之前,新的怀疑者会先试着救回被错误丢弃的问题,并复核强共识的结论。
- **是护栏,不是自动驾驶。** 安全的改动在风险匹配的防护下落地(冻结锚点、单段改动次数上限、锚点与跨节的语义复核),而且始终经你授权。有风险的改动不会被悄悄写入,而是排队等你过一遍。
- **真编译,不只是嘴上批评。** 它在你本机真跑一次 LaTeX 构建,报出真实的报错、未定义引用、overfull box 和页数;本机没有工具链时,诚实降级为结构性检查。确定性的 desk-reject 检查抓那些经典坑:去匿名泄漏、页边距和行距的小动作、documentclass 漂移、缺失的必需章节、超页,全部对照你项目自己持有的约束来查。

---

## 三种模式

### Direct-Edit(常用)

- **触发方式:** 用户用中文或英文描述一处改动,想直接改 LaTeX。
- **示例:** "把这段改成…"、"polish this paragraph"、"把我对 intro 的想法写成 LaTeX"、"tighten this"。
- **行为:** 不上 review 阶段,直接走写作工具起草补丁,获得作者确认。

### Review(偶尔)

- **触发方式:** 用户想给论文挑问题、做审查:review / critique / 审稿 / 评审 / mock-review,或迭代草稿、逐一解决评审者提出的问题。
- **行为:** 启动对抗式评审引擎(`references/review-engine-v3.md`)。
- **范围子触发:** `full`(整篇)或 `passage`(某一节 / 段落 / claim)。

### Auto(自动迭代)

- **触发方式:** 用户通过 `/goal` 或配置 `mode: auto` 显式开启自动迭代,让 review-revise 循环朝可验证的目标推进。
- **硬约束:** 绝不自动进入 auto 模式,只能显式开启。它没有任何运行时信号,要么走 `/goal` 上下文,要么靠项目配置 `mode: auto` 进入。
- **行为:** 先拿到作者对核心方向和评审分配的确认,之后引擎按预授权的 bounded-aggressive + 编辑安全策略,自动落地安全 fix,把有风险的改动入队,多轮迭代到停下为止:书记官判定收敛,或 applied-quiescence / 硬上限兜底(详见 `references/auto-mode.md`)。

---

## 使用示例:什么情况该怎么做

你不用输入命令;说出想要什么,skill 会自己选对模式。

**改一处(日常 → direct-edit):**
- "把这段 intro 改紧一些。" / "Polish this paragraph."
- "把我对 intro 的中文想法写成 LaTeX:`<你的想法>`。"
- "de-AI 这段。" / "这句压到一行。" / "重写这个 caption。"
- → 它起草 LaTeX 改动、自检、把补丁给你看,你批准后才落。不开面板。

**投稿前让它挑问题(→ review):**
- "审稿。" / "Review my paper." / "投之前 mock-review 一下。"
- "只评 Section 3.2。" / "review passage `<你贴的那条 claim>`。"
- "这是评审提的问题,迭代草稿逐一解决。"
- → 它跑对抗引擎,挑出真正的弱点(把致命缺陷和小问题分开),逐条和你过一遍:你给方向,它起草,经你授权才改;未经你确认不改稿。

**自动迭代朝目标打磨(→ auto,需要 `/goal`):**
- `/goal "harden the paper until ledger.js gate passes(0 个阻断 gate 的 major)"`
- → 它自己跑多轮评审-修订循环,自动落安全 fix,把有风险的改动入队,等你回来一次性处理。这需要 `/goal` 驱动:只开 "auto" 工具放行 + 发普通 prompt 只跑一轮就停,不会循环(原因见 [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md) §3)。

**确认不会被 desk-reject:**
- "跑一下 submission-readiness / 合规检查。" → 确定性的格式筛查 + 编译驱动的版面检查。

一句话:**改一处 → 直接说;想挑问题 → 说「审稿」;想自动迭代 → `/goal`。**

---

## 引擎总览

引擎把这些环节按「庭审」组织起来,步骤为:评审员分配 → 完整阅读检查 → 覆盖审计 → 去重 →(审议 ‖ 润色) → 召回审计 → 编辑起草 → 编辑 / 含义审计 → 书记官收敛。生成端有界(N 个领域评审者),审议端按争议程度分流,多轮循环由确定性的书记官判定收敛。

### 确定性步骤

1. **读稿分解**:把手稿切成阅读单元、规范的段落列表、稳定的段落编号(防止漂移,为评审提供局部上下文)。
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
2. **完整阅读检查**:每位 holistic reviewer 通读全文一遍 → 弱点(significance + kind + 逐字引文,引不出原文 = 没真读)+ 一个 overall_confidence + 按节的覆盖报告;反 skim 带定向重读模式。
3. **覆盖审计**:反 skim 第 2 层,跨覆盖报告标出被略读的(reviewer, 节)对。
4. **去重**:合并重复的评论,确定性地导出重要性、问题类别和交叉确认。
5. **审议(trial)**:对有争议的问题开庭:5 人首层、全文辩护 → 独立陪审员带局部上下文(可按需扩展)→ 确定性 quorum + 一方 >60% 多数裁定,法官给 decided-valid 路由(valid-fixable vs author-required);只有迟迟没有明显多数时才升到 12 人。
6. **润色**:快路径处理机械性问题和轻微问题;如果判断错误,升级回审议。
7. **审核补救(recall)**:Mode A 救回被误丢的 charge(倾向于救);Mode B 在落稿前抽检强共识的 major(防共识集体出错)。
8. **编辑起草**:对确认的可修复问题起草最小改动。
9. **编辑审计 / 含义审计**(edit-safety 的语义半,两个独立 workflow):edit-audit 查高风险非锚改动(通顺性 + 跨节一致性);meaning-audit 是四态的冻结锚 + 论证弧审计。
10. **书记官**:汇总本轮的结果,去重残留的问题,确定性判定是否收敛。

也支持简化的 3 人评审小组作为快速路径。

---

## 三原语:Skill + Workflow + Memory

1. **Skill(入口 + 方法论):** 协议、reviewer 分配、consensus gate、writing toolkit、人工 gate。详见 `references/review-engine-v3.md`、`references/reviewer-personas.md`、`references/writing-toolkit.md`。
2. **Workflow(fan-out 引擎):** 语义层、无人居中的步骤以 Workflow 运行(并行 + 构造上即 schema 校验的输出)。简单 panel = `workflows/review-panel.workflow.js`;评审引擎 = `assign-reviewers → reading-check → coverage-auditor → merge → {trial ‖ polish} → recall-audit → drafter → {edit-audit | meaning-audit} → clerk`。确定性 guards 由 orchestrator 侧经 Bash 在各 workflow 调用之间运行,因为 Workflow sandbox 没有 fs:`scripts/` 里有 `decompose`、`ledger`、`journal`、`apply-patch`、`anchor-diff`、`cross-ref`、`spine`、`compile-guard`、`compliance-check`。
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
- 你的项目文件、ledger、journal 和 patch 都留在本地论文项目里。PaperJury 这边没有自己的后端或服务器,所以不会有任何东西发到 PaperJury 的服务器。审稿走的是你自己的 Claude Code session,模型本身跑在云端:内容到了那边怎么处理,跟着你这套 Claude Code 环境的条款和设置走,PaperJury 不会在上面再加一层。

---

## Roadmap / 即将到来

还在路上(规划中,尚未上线):

- **评审人格带上每个会议 community 的 taste。** CVPR、ACL、NeurIPS 的 reviewer 挑刺的口味并不一样;目标是让评审带上各自社区的预期,而不只是现在的三族 style 上下文。
- **支持 `/plugin install`**,从 Claude Code 的 plugin 市场直接装(clone 安装仍保留)。
- **基于视觉的版面校验**:编译、渲染、再检查版面(分栏溢出、图表摆放),不只看编译日志。
- **从 `.cls` / 模板自动识别 venue。**
- **在更多真实论文上规模化验证引擎。**

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

spine 与防漂移设计(anchor logic-transfer audit、claim register、minimal-edit 且保义的改写策略)受 [PaperSpine](https://github.com/WUBING2023/PaperSpine) 启发,它是一个 motivation-driven 的论文起草与改写 skill。PaperSpine 是 forward generate/rewrite 工具、没有对抗 loop;PaperJury 借用它的 anchoring 思路,以及「可检查步骤交给确定性脚本、判断交给 model agent」这一机制,再在其上加了对抗式庭审 review 引擎。
