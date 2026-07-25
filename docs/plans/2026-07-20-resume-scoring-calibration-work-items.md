# 简历评分校准与回归基线工作项拆分

## GitHub Issues 拆分摘要

以下 ID 应作为 `agniwen/ai-recruitment` 的 GitHub 子 issue 跟踪；数据闸门使用 GitHub 原生 issue dependency 表达，未通过闸门的后续 issue 不进入 `ready-for-agent`。

目标：把现有简历评分评测从小样本历史诊断，推进为可复现的真实数据基线，并在安全护栏下产出六维权重和 `nextStep` 决策策略候选。

- [ ] A1 复跑最新代码基线并冻结运行清单（0.5d）
- [ ] A2 诊断标签可用样本的覆盖缺口（0.5d）← 前置闸门
- [ ] A3 增加真实样本只读重放输入与版本元数据（1d）
- [ ] A4 增加可续跑的真实样本 Agent 评测执行器（1d）
- [ ] A5 运行当前 Prompt 的真实样本基线（0.5d）← 前置闸门
- [ ] B1 审核代理标签并接入人工补强标签（1d）
- [ ] B2 固化按用人组织、Job Description 和时间留出的评测切分（0.5d）
- [ ] B3 生成可用于校准的金标基线报告（0.5d）← 前置闸门
- [ ] C1 实现可传权重和行动阈值的纯离线评分器（1d）
- [ ] C2 拟合六维权重候选并做交叉验证（1d）
- [ ] C3 离线模拟 `interview / hold / reject` 阈值策略（1d）
- [ ] C4 输出基线与候选策略的稳健性对比报告（1d）
- [ ] D1 完成生产采用决策与 ADR 对齐（0.5d）
- [ ] D2 接入选定策略及版本信息（1d）
- [ ] D3 固化单元、合成与离线回归门禁（1d）
- [ ] D4 更新评测文档并完成全量验证（0.5d）

合计约 16 项 / 13 人天。建议顺序：先完成 A、B 阶段的数据闸门；只有金标质量达标后再做 C 阶段拟合；D 阶段是否接入生产由对比报告决定。

## 详细版

### 对齐基准与范围

本计划只处理 `ai-recruitment` 的真实数据基线、六维权重和 `nextStep` 决策校准。Job Description 匹配 Agent、Top-N 推荐和现有合成 Prompt 优化不重复实施。

默认假设：

- 每次评测显式指定一个 workspace id；数据集和报告不得跨 workspace 合并。需要比较用人组织时，使用现有 `studio_interview.hiring_unit_id` 分层并分别报告。
- 真实样本评测只读生产或生产镜像数据，不回写候选人评价，不触发招聘流程状态变化。
- 候选人级数据和模型输出留在被 Git 忽略的 `.eval/`；仓库只提交无 PII 的聚合报告、脚本和测试夹具。
- 当前新写入评价是 schema v4：六维位于 `resume_review.dimensions`，综合分位于 `overall.baseScore`，行动建议位于 `nextStep.action`；读取路径继续兼容旧版 `overall.score`。当前没有评分策略快照或独立综合分列，不得在基线里伪造这些字段。
- 六维字段固定为 `skillMatch`、`experienceRelevance`、`projectMatch`、`educationBackground`、`potential`、`stability`。权重优化的主目标是提高分数排序能力，优先观察 Average Precision 和 ROC-AUC；Brier、ECE 用于校准诊断。
- `nextStep` 的主目标是降低正例误 `reject`，已录用误 `reject` 必须为 0；`hold` 作为不确定区间，不追求以降低覆盖率为代价的表面准确率。
- 在真实数据证明阈值策略更稳之前，`nextStep` 继续由定性 Agent 产生并接受确定性安全约束，不直接改成分数阈值决策。
- 目标仓库既有的 AI 面试禁用与招聘默认值行为保持不变：`aiInterviewDisabled` 岗位可以跳过 AI 面试阶段，`humanInterviewerIds`、`priority`、工作时段和 `workTimezone` 既不是评分输入，也不能直接充当正负标签。代理标签只读取实际流程结果和已发生的推进阶段。

### 目标仓库边界

- 人工标注、评测报告或策略管理若以后暴露为 Studio/API 能力，必须使用动态 workspace permission snapshot 和资源 action 守卫，不得硬编码 owner/admin 角色名。
- Job Description 的枚举、标注和策略绑定复用招聘组 → 用人组织可见域。面向成员的查询不得读取其不可见用人组织；受控离线 CLI 的 workspace 全量运行也必须在报告中按 `hiringUnitId` 分层。
- Resume Scoring Policy 不重复存 `hiringUnitId`；岗位范围沿用 `jobDescription → department → hiringUnit`，历史评价的组织归属使用 `studioInterview.hiringUnitId`。
- 目标仓库现有的 AI 面试禁用、启动守卫、候选人详情透传和 Job Description 招聘默认值定制不得被本计划改写。回归数据必须允许合法的“直接进入真人面试”路径，不能把缺少 AI 面试阶段视为负例。

### 现状摸底

当前已经具备以下基础：

- 代理标签抽取、数据质量诊断和 JSONL 导出脚本已经存在。
- 已有 ROC-AUC、Average Precision、Brier、ECE、macro-F1、六维差值和已录用误拒等指标。
- 合成评分回归、结构化输出重试、证据安全规则和 Prompt few-shot 已经落地。
- 六维总分仍使用固定的 `35/25/15/10/8/7` 权重，并从 `overall.baseScore` 读取；旧评价可回退到 `overall.score`。
- `nextStep` 当前由定性 Agent 直接输出；代码只在筛选建议为 `hold` 时把 `interview` 收紧为 `hold`，没有分数阈值决策器。
- 现有评测数据集只按 `organizationId` 读取，尚未携带 `hiringUnitId`，因此 A2/A3 必须先补齐用人组织分层，再把报告用于目标仓库校准。

上游参考报告生成于 2026-07-18，基于提交 `9298d26f`。这些数字只能作为待复跑的历史诊断，不能视为 `ai-recruitment` 当前基线：

- 原始记录 1118，标签可用 69，可评测 23，覆盖率仅 33.3%。
- 23 个样本中正例 15、负例 8；没有已录用样本，只有 1 个强负例。
- ROC-AUC 为 0.796，Average Precision 为 0.894，但样本过小且以弱标签为主，不能据此拟合或上线。
- 正例误 `reject` 为 20%；已录用误拒无法评估，因为已录用样本数为 0。
- 41 条标签可用记录没有 ready 的评价，5 条缺少 Job Description；这是覆盖率低的主要原因。
- 所有 23 条现有样本缺少 review run ID；历史记录也没有生成时的 Job Description/简历快照、模型和 Prompt 版本，无法严格重放。

### 前置风险与闸门

#### 闸门 G1：真实样本覆盖率

运行 `--strict` 时，可评测覆盖率必须至少达到 80%。如果缺评价记录无法安全恢复，不得用小样本拟合生产参数；降级为仅做诊断，并优先增加新的完整评价记录。总覆盖率达标但任一主要用人组织覆盖率不足时，也必须单独标记，不能用 workspace 汇总值掩盖缺口。

#### 闸门 G2：标签强度与已录用样本

如果目标 workspace 没有已录用样本，无法证明“已录用者不误 reject”：

- `reject` 阈值只能离线观察，不能作为自动或强制生产决策。
- 人工审核一批明确合格的强正例，作为安全回归补强，但必须与真实已录用指标分开报告。
- 生产行为维持“建议 + 人工确认”，低置信度结果优先落到 `hold`。
- AI 面试被禁用的岗位使用其实际真人面试、Offer 或已录用进展形成正例，不要求先经过 `ai_interview`。

#### 闸门 G3：`nextStep` 架构选择

二元录用结果可以用于排序和正负方向诊断，但不能天然给出三分类的最佳业务动作。C3 完成后需要明确选择：

1. 保留 Agent 行动建议，只增加确定性安全护栏；或
2. 由基础分的两个阈值确定 `reject / hold / interview`，Agent 只负责理由。

建议本轮默认选择 1；只有阈值策略在留出集上稳定优于 Agent，且已录用安全护栏可验证时，才进入方案 2。

#### 闸门 G4：生产权重承载方式

ADR 0016 已要求停止全局硬编码单一权重，并使用带快照的评分策略；目标代码当前仍是 schema v4 + 固定权重。D2 开始前必须确认：

- 先完成评分策略 P1，再把拟合结果作为默认策略；或
- 本轮只输出离线候选权重，不修改生产权重。

不建议直接替换全局常量，否则历史分数解释和后续策略迁移会继续失真。评分策略的权限和岗位绑定必须继续遵守动态 RBAC 与用人组织可见域。

### 阶段 A：获得当前版本的可复现真实基线

| ID  | 工作项                                | 估时 | 交付物                                                                                                                  |
| --- | ------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------- |
| A1  | 复跑最新代码基线并冻结运行清单        | 0.5d | 最新 `dataset/metrics/report` 三件套；记录 git SHA、workspace、数据集 hash、运行时间和脚本参数                          |
| A2  | 诊断标签可用样本的覆盖缺口            | 0.5d | 标签可用记录的互斥排除清单；review-not-ready、missing-Job Description、missing-hiring-unit 的处理结论；分层覆盖率报告   |
| A3  | 增加真实样本只读重放输入与版本元数据  | 1d   | 只读加载器；输出 `hiringUnitId`、当前结构化简历、Job Description、筛选结果的 hash，以及模型、Prompt、schema、git 版本   |
| A4  | 增加可续跑的真实样本 Agent 评测执行器 | 1d   | 支持 checkpoint、失败重试、并发限制和单样本错误记录的 CLI；按 workspace/用人组织隔离输出到 `.eval/`；单测覆盖中断后续跑 |
| A5  | 运行当前 Prompt 的真实样本基线        | 0.5d | 当前版本真实运行报告；结构成功率、覆盖率、动作混淆、正例误拒、六维指标；与上游历史参考报告分开展示                      |

当前执行入口：

```bash
pnpm --filter @arc/ai-recruitment-copilot-backend eval:resume-reviews -- \
  --org <workspace-id> --strict
```

这条现有命令只读取数据库中已经保存的评价，不能验证当前 Prompt，也没有用人组织筛选参数。A3/A4 的重放执行器完成后，才可以把“当前 Prompt 真实基线”和历史存量基线区分开。

### 阶段 B：把代理标签提升为可用于校准的金标基线

| ID  | 工作项                                          | 估时 | 交付物                                                                                                                   |
| --- | ----------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| B1  | 审核代理标签并接入人工补强标签                  | 1d   | 无 PII 的标注导出/回收格式；强弱样本抽查；人工标签与流程标签冲突清单；若提供 API，则有动态 permission 与用人组织范围测试 |
| B2  | 固化按用人组织、Job Description、时间留出的切分 | 0.5d | 固定随机种子和 split manifest；同一 Job Description 不跨拟合/验证折；样本足够后保留最新时间段作为最终留出集              |
| B3  | 生成可用于校准的金标基线报告                    | 0.5d | 代理标签与人工标签分层指标；workspace、用人组织、Job Description 分布；强弱标签指标和安全护栏；是否允许进入拟合的结论    |

进入 C 阶段的最低条件：

- 可评测覆盖率至少 80%，并报告各主要用人组织的覆盖率。
- 正负样本都存在，且报告明确区分强标签与弱标签。
- 至少存在可用于安全验证的强正例；没有已录用样本时，`reject` 阈值只做实验，不进入生产。
- 切分后每个验证折仍同时包含正负样本；无法满足时只报告 bootstrap 区间，不宣称泛化能力。
- AI 面试禁用与启用岗位的流程差异已单独检查，不把跳过 AI 面试造成的阶段差异当成模型效果。

### 阶段 C：拟合六维权重和行动阈值

| ID  | 工作项                                        | 估时 | 交付物                                                                                                      |
| --- | --------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| C1  | 实现可传权重和行动阈值的纯离线评分器          | 1d   | 不调用模型的纯函数；支持任意非负、总和 100% 的六维权重和双阈值；基线向量 `35/25/15/10/8/7` 的等价测试       |
| C2  | 拟合六维权重候选并做交叉验证                  | 1d   | 粗粒度、受约束的权重搜索；按用人组织和 Job Description 分组的折外指标；候选权重、相对基线增益和不确定区间   |
| C3  | 离线模拟 `interview / hold / reject` 阈值策略 | 1d   | 双阈值扫描；decision coverage、macro-F1、正例误拒和已录用误拒曲线；Agent 行动与阈值行动的差异样本清单       |
| C4  | 输出基线与候选策略的稳健性对比报告            | 1d   | 总体、强标签、逐用人组织、逐 Job Description 和时间留出结果；bootstrap 区间；明确“采用 / 不采用 / 继续收集” |

拟合原则：

- 使用粗粒度约束搜索，不使用高自由度模型；当前样本规模下复杂优化器极易过拟合。
- 权重非负、总和为 100%，并限制候选权重相对当前向量的变化幅度。
- 主目标优先 Average Precision；ROC-AUC、Brier、ECE、逐用人组织/Job Description 稳定性作为共同判断依据。
- 行动阈值优化必须把已录用误 `reject = 0` 作为硬约束；没有已录用样本时不得声称该约束已验证。
- 所有候选只看训练折选择，最终结论只看折外或时间留出指标。
- `aiInterviewDisabled`、招聘优先级、默认真人面试官和工作时段只作为流程分层诊断，不自动加入评分特征或阈值。

### 阶段 D：采用、接入与回归固化

| ID  | 工作项                       | 估时 | 交付物                                                                                                                        |
| --- | ---------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| D1  | 完成生产采用决策与 ADR 对齐  | 0.5d | 一页决策记录：候选权重、是否采用阈值、`hold` 语义、安全回退、与 ADR 0016 评分策略及用人组织边界的关系                         |
| D2  | 接入选定策略及版本信息       | 1d   | 通过评分策略快照或选定配置接入；新评价记录权重/阈值版本；旧评价分数不被静默重算；管理动作使用动态 permission snapshot         |
| D3  | 固化单元、合成与离线回归门禁 | 1d   | 权重数学、边界阈值、筛选约束、已录用不误拒、动态角色、跨用人组织隔离、AI 面试禁用岗位跳阶测试；固定聚合夹具的离线指标回归     |
| D4  | 更新评测文档并完成全量验证   | 0.5d | 更新 `docs/evaluation/resume-review.md`；回写 GitHub issue 决策；后端测试、共享包测试、TypeScript typecheck、格式检查全部通过 |

建议验证命令：

```bash
pnpm --filter @arc/shared exec vitest run src/__tests__/resume-screening.synthetic.test.ts
pnpm --filter @arc/ai-recruitment-copilot-backend eval:resume-reviews:synthetic -- \
  --execute --runs 3 --strict
pnpm --filter @arc/ai-recruitment-copilot-backend test
pnpm --filter @arc/ai-recruitment-copilot-backend typecheck
pnpm check
```

真实数据回归不建议直接放入普通 CI：它依赖数据库、模型密钥且包含候选人级数据。CI 只运行纯函数、脱敏固定夹具和不调用模型的合成契约；真实评测通过受控命令定期运行并保存聚合报告。

### 合计与建议里程碑

- 阶段 A：3.5 人天，获得当前版本的真实可复现基线。
- 阶段 B：2 人天，把代理数据提升到允许拟合的质量。
- 阶段 C：4 人天，得到权重和行动策略候选。
- 阶段 D：3.5 人天，完成采用决策、生产接入和回归。
- 总计：约 13 人天，不包含评分策略 P1 全量管理界面的独立实施成本，也不包含人工招聘标注等待时间。

第一个里程碑应只承诺 A1-A5：先确认目标 workspace 的真实覆盖率、用人组织分布和可重放性。若 G1/G2 不通过，停止参数拟合，转为数据补强；不要为了完成“调权重”而在少量弱标签样本上给出看似精确的结果。

### 待定项

1. 首轮使用哪个 workspace，以及是运行 workspace 全量还是指定用人组织。
2. 是否允许对历史标签可用记录做只读模型重放，并产生相应模型调用成本。
3. `nextStep` 的生产目标是“Agent 建议 + 安全护栏”，还是最终改为“分数阈值确定行动”。
4. 权重采用是否等待评分策略 P1 落地；在此之前建议只产出离线候选，不修改全局常量。
5. 人工标注只通过受控 CLI 完成，还是增加受动态 permission 和用人组织范围保护的 Studio/API 能力。

### 关键文件索引

- `docs/agents/issue-tracker.md`：GitHub issue、子 issue 与依赖约定。
- `docs/evaluation/resume-review.md`：现有运行方式、指标和解释边界。
- `apps/ai-recruitment-copilot-backend/src/scripts/resume-review-eval.ts`：真实历史评价评测 CLI。
- `apps/ai-recruitment-copilot-backend/src/scripts/resume-review-eval/dataset.ts`：代理金标数据集构造和只读数据库查询。
- `apps/ai-recruitment-copilot-backend/src/scripts/resume-review-eval/labels.ts`：招聘结果到强弱正负标签的映射。
- `apps/ai-recruitment-copilot-backend/src/scripts/resume-review-eval/metrics.ts`：离线指标实现。
- `apps/ai-recruitment-copilot-backend/src/server/agents/resume-analysis-review.ts`：定性 Agent、六维评分 Agent 和组装逻辑。
- `packages/db-schema/src/schema.ts`：`studio_interview` 的 workspace、`hiringUnitId` 和评价持久化字段。
- `packages/db-schema/src/resume-review.ts`：schema v4 六维、`overall.baseScore` 和 `nextStep` 定义。
- `packages/shared/src/resume-evaluation-decision.ts`：当前 `nextStep` 安全约束。
- `packages/shared/src/permissions.ts`：动态 workspace 权限资源与页面 action。
- `packages/shared/src/job-descriptions.ts`：AI 面试禁用和招聘默认值契约。
- `docs/adr/0016-resume-scoring-policies.md`：评分策略、动态权限、用人组织边界、快照和历史分数解释约束。
- `docs/superpowers/plans/2026-07-17-resume-scoring-policy-p1.md`：评分策略 P1 的目标仓库实施计划。
