# 面试报告数据契约、三路融合与审核闸门工作项拆分

## 简短版（拆成 GitHub Issues 用）

目标：把当前按会话生成的松散 AI 评估升级为“每轮一份”的严格三路融合报告，并在系统内完成可审计的真人复面准入闭环，同时保留 `ai-recruitment` 的岗位禁用 AI 面试规则和真人面试官默认值。

- [ ] A1 定义并导出 `InterviewReportV1` 共享 Zod 契约（1d）← 前置闸门
- [ ] A2 建立契约样例、无效输入和 legacy 解析测试（0.5d）
- [ ] B1 审计历史同轮会话、旧评估和证据可信度（1d）← 数据迁移闸门
- [ ] B2 新增轮次报告聚合与不可变版本表、生成迁移（1d）
- [ ] B3 实现报告草稿、版本递增、提交锁定 DAO（1d）
- [ ] C1 将证据快照投影为简历、表单、本轮面试三类证据（1d）
- [ ] C2 改造报告 workflow 与 prompt，输出严格三路融合结构（1d）
- [ ] C3 增加证据引用、来源冲突和覆盖状态的确定性校验（1d）← 质量闸门
- [ ] D1 增加类型化报告查询、重新生成和提交 API（1d）
- [ ] D2 把报告详情页迁移到共享类型并展示来源、证据和冲突（1d）
- [ ] D3 增加草稿重生成、提交确认和提交后锁定交互（1d）
- [ ] E1 增加真人复面准入决定 API 与权限校验（1d）
- [ ] E2 原子落库审核决定、候选人阶段变化和审计记录（1d）
- [ ] E3 统一轮次与候选人变更保护和并发锁协议（1d）
- [ ] E4 增加系统内二选一审核 UI 与时间线展示（0.5d）
- [ ] F1 完成 legacy 兼容、集成回归和并发测试（1d）
- [ ] F2 跑定向与全仓校验，形成发布和回滚检查表（0.5d）← 发布闸门

合计约 17 项 / 15.5 人天。建议顺序：A → B → C → D → E → F；A、B1、C3、E3 和 F2 未通过时不要进入下一依赖阶段或发布。

每个编号在 `agniwen/ai-recruitment` 中建立一个 GitHub Issue；阻塞关系使用 GitHub 原生 issue dependencies，无法使用时再在 issue 正文顶部写 `Blocked by: #...`。

---

## 详细版

### 1. 对齐基准与目标口径

本计划遵循 [ADR 0018](../adr/0018-use-round-scoped-evidence-backed-interview-reports.md)：

1. 一个 `AI Interview Round` 对应一份 `Interview Report`；候选人可以有多轮报告，不建立候选人级聚合报告。
2. 正式报告融合三个来源族：冻结简历、已提交候选人表单、本轮 AI 面试中的候选人陈述。
3. 每条实质性结论至少引用一条可定位的原始证据；综合建议只能引用结论；冲突双方均保留证据。
4. `schemaVersion` 表示契约版本，`reportVersion` 表示同一轮次内的不可变生成版本。
5. 报告由有权限的成员在系统内明确提交；提交后不再修改该版本，不重新生成或重置、删除对应轮次。
6. 有招聘可见范围且具备相应权限的成员可以作出二选一决定：进入真人复面，或不进入并结案淘汰。
7. 只有候选人的最终有效 AI 面试轮次可以作出准入决定：该轮为 `completed`、`sortOrder` 最大，且候选人现存所有 AI 轮次均已 `completed`。
8. 岗位的 `aiInterviewDisabled` 继续阻止进入 AI 面试阶段和发起新轮次，但不隐藏已经完成的历史报告。
9. 准入决定只切换候选人阶段，不自动创建真人复面轮次；后续安排仍由 HR 确认，岗位默认真人面试官只作为可编辑初始值。
10. 每个不可变 report version 使用 `contentKind=v1/legacy` 区分内容契约。恰好存在一份可验证旧评估的轮次可迁移为 legacy version；同轮多份候选评估进入 `migration_conflict`，经审计的人工映射后才能继续。

验收指标：

- 新报告写入、读取和 API 返回均通过共享 Zod Schema；报告消费链路中不再出现 `evaluationCriteriaResults as Record<string, unknown>` 或本地宽松类型守卫。
- `available` 来源中的每个 `evidenceRef` 都能解析到当前报告冻结输入中的唯一事实；不存在悬空引用和把 AI 结论再次当证据的情况。
- 必需来源为 `missing` 时提交返回可解释的 409；未配置表单使用 `not_applicable`，不伪造成已分析。
- 同一 `roundId` 并发提交只产生一个系统提交结果。
- 新报告状态严格遵循 `draft -> submitted -> decided`；legacy 迁移额外允许 `migration_conflict -> submitted` 的人工审计转换。
- “进入真人复面”与 `pipelineStage=human_interview` 同事务成功或失败；“不进入”与 `pipelineStage=closed/outcome=rejected` 同事务成功或失败。
- 非最终轮或存在未完成 AI 轮次时，准入决定 API 返回可解释的 409。
- 报告提交后，轮次 PATCH/status/reset/单删/批删均返回 409；候选人单删或批删命中锁定报告时也返回 409。
- 岗位禁用 AI 面试时，现有 launch 与阶段 guard 继续拒绝新轮次；已经完成的轮次报告仍可按权限读取和审核。
- 进入真人复面不会自动创建轮次；打开安排弹窗时仍使用岗位配置的真人面试官默认值，并允许 HR 修改。
- 所有生成、重生成、提交、最终决定和阶段推进均有操作者、轮次、报告版本、时间和原因可追踪。

### 2. 现状摸底

- 当前报告生成由 `interview-summary-job.ts` 在单个 conversation 上运行。证据快照已经冻结简历上下文、表单和 transcript，但 workflow 实际只接收格式化表单、问题和 transcript，简历没有进入评估输入。
- `evaluationCriteriaResults` 在数据库、`@arc/db-schema/interview-session`、DAO、API 和前端之间以 `Record<string, unknown>` 传播；前端各自做不完整的运行时判断。
- `GET /:roundId/reports` 已按 `scheduleEntryId` 查询，但返回该轮全部 conversations；轮次重置会清空 schedule 上的当前 `conversationId`，历史 conversation 仍可能保留。
- 当前只有 conversation 的 `pending/running/ready/failed` 汇总状态，没有轮次报告的草稿、提交状态和真人复面准入决定。
- 目标 fork 已在前后端同时执行岗位级 AI 面试禁用 guard；`transitionCandidateStage` 负责阶段权限和不变量，真人复面安排弹窗会用岗位配置的 `humanInterviewerIds` 作为可编辑默认值。

最关键的空白是：当前评估身份属于 conversation，而目标要求 round 只有一个权威报告。迁移前必须统计历史同轮多会话、有效旧评估和不可验证证据，不能直接加唯一约束或自动挑选一份评估。

### 3. 前置风险与闸门

#### 闸门 A：V1 契约必须先冻结

- 后续数据库、prompt、API 和 Web 只能依赖同一份 Schema。
- 若简历无法提供页码级引用，V1 降级为结构化 `fieldPath + valueExcerpt`；不能捏造页码或原文位置。
- 契约未通过正反例测试前，不创建迁移。

#### 闸门 B：历史评估基数审计

- B1 输出每个 round 的 conversation 数、有效旧评估数、legacy 解析状态和证据可信度，不输出候选人 PII。
- 证据至少区分 `verified_original` 与 `legacy_unverified`：只有原始 evidence snapshot 的 conversation、schedule entry、context snapshot 均可与目标轮次相互校验时才算前者。
- 若发现同轮多份有效旧评估，不删除、不覆盖、不自动选权威版本；记录为 `migration_conflict`，等待有审计记录的人工映射。

#### 闸门 C：证据完整性

- 模型输出通过 Zod 但引用不存在，仍算生成失败。
- 允许一次基于校验错误的结构化重试；仍失败则保留上一成功草稿或显示失败，不能降级成无证据正式报告。
- `missing` 与 `not_applicable` 必须由确定性来源装配逻辑产生，不能交给模型猜测。

#### 闸门 E：阶段与数据一致性

- 提交和最终决定必须在短数据库事务内完成，统一按 candidate → stable-ordered rounds → report 的顺序加锁，并在锁内重新检查 guard。
- 准入决定复用候选人阶段状态机、动态 RBAC 和招聘可见范围；不得新增绕过 `transitionCandidateStage` 规则的平行更新路径。
- `aiInterviewDisabled` 只阻止新的 AI 面试进入或发起，不改变历史报告归属和审核权限。
- 进入真人复面只写审核决定和阶段变化，不创建真人复面轮次；安排时间与面试官继续留在现有可编辑对话框。

### 4. 分阶段工作项

#### 阶段 A：统一报告契约

| ID  | 工作项                                                                                                                                                                                                                        | 估时 | 交付物                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------- |
| A1  | 在 `packages/shared/src/interview/report.ts` 定义 `InterviewReportV1`：轮次、会话和快照身份，版本，三类 `sourceCoverage`，可判别 `evidenceRef`，`conclusions`，`conflicts`，综合建议和生成元数据；所有对象使用严格 Zod 结构。 |   1d | 共享 Schema、推导类型、公开导出和合法 JSON 样例。 |
| A2  | 为契约补正反例和 legacy 解析器：拒绝未知来源、悬空字段形状、无证据结论和错误版本；把当前 evaluation 结构解析为显式 `LegacyInterviewEvaluation`。                                                                              | 0.5d | `report.test.ts`、legacy fixtures 和类型检查。    |

#### 阶段 B：轮次报告持久化与历史闸门

| ID  | 工作项                                                                                                                                                                                                       | 估时 | 交付物                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---: | ------------------------------------------------------------ |
| B1  | 编写只读审计脚本，按 `scheduleEntryId` 统计 conversation、ready evaluation、解析状态和证据可信度。                                                                                                           |   1d | `.eval/` 下无 PII 报告；重复评估 round 和迁移决策输入。      |
| B2  | 在 `@arc/db-schema` 增加 round-owned `interview_report` 与不可变 `interview_report_version`；version 保存 `contentKind=v1/legacy`，report 保存生命周期、提交和决定元数据，report → round 外键使用 restrict。 |   1d | Drizzle schema、生成迁移、状态约束、唯一索引和 DB 类型检查。 |
| B3  | 在 reports 路由目录内新增 DAO，TDD 实现创建首个草稿、内容变化才递增版本、读取当前版本、提交 compare-and-set、锁定 round、提交后禁止重生成，以及事务内显式删除 draft。                                        |   1d | DAO 与数据库测试；API 和前端不接触未解析 JSON。              |

#### 阶段 C：真正的三路融合

| ID  | 工作项                                                                                                                                                              | 估时 | 交付物                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ---------------------------------------------------------- |
| C1  | 从可信的 `Interview Evidence Snapshot` 构建确定性的 typed input：简历字段路径与摘录、表单模板和答案、本轮 transcript 的 turn locator，并计算三类覆盖状态和证据 ID。 |   1d | 纯投影函数、稳定 locator、覆盖状态测试和三类证据 fixture。 |
| C2  | 改造 `interview-report-workflow.ts` 和 `interview-report.ts`，让模型接收 typed 三路输入并直接输出 `InterviewReportV1` 的结论、证据引用和冲突。                      |   1d | 新 workflow 输入输出、prompt、few-shot 和单元测试。        |
| C3  | 增加生成后确定性校验：引用存在性、来源族一致性、当前轮次约束、每结论至少一条证据、综合建议只引用结论、冲突引用双方。                                                |   1d | provenance validator、错误码、重试策略和回归测试。         |

#### 阶段 D：类型化 API 与报告页面

| ID  | 工作项                                                                                                                                                 | 估时 | 交付物                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---: | ----------------------------------------------------------- |
| D1  | 在 `routes/interviews/routes/reports/` 增加当前报告查询、草稿重生成和提交接口；使用 `zValidator`、显式状态码、typed Hono RPC 和现有 visibility scope。 |   1d | 类型化 route/DAO tests、RPC 推断和明确的 409/404/403 契约。 |
| D2  | 报告详情改用共享类型，展示来源覆盖、逐条结论、三类证据、冲突和综合建议；证据点击定位 transcript、录音、简历或表单上下文。                              |   1d | 类型化报告 UI、来源标签和证据跳转测试。                     |
| D3  | 增加“重新生成草稿 / 提交审核”交互：提交前显示版本和来源完整性确认；提交后隐藏重生成、重置和删除入口并显示锁定原因。                                    |   1d | 前端状态流、mutation cache 更新、错误提示和组件测试。       |

#### 阶段 E：系统内审核与招聘流程

| ID  | 工作项                                                                                                                                                                                                              | 估时 | 交付物                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ---------------------------------------------------------------- |
| E1  | 增加 `advance_to_business_interview` / `do_not_advance` 决定 Schema 与 API。两种决定都要求 `interview.update` 和 recruiting visibility；只有进入真人复面额外要求 `humanInterview.create`。                          |   1d | 权限矩阵和 route tests；非最终轮、未完成轮次、重复决定均被拒绝。 |
| E2  | 把 `transitionCandidateStage` 的事务体提取为接受 `tx` 的内部原子函数。报告决定服务在一个外层事务内写 review，并复用同一 transition guard：进入真人复面写 `human_interview`；不进入写 `closed/rejected` 和必填原因。 |   1d | 无嵌套事务的原子 service/DAO、并发决定测试和失败回滚测试。       |
| E3  | 统一候选人和轮次变更保护：PATCH/status/reset/轮次单删/批删、候选人单删/批删和最终决定使用同一锁顺序，并在锁内重查 guard。                                                                                           |   1d | 事务化 mutation service、409 错误映射和竞争回归测试。            |
| E4  | 候选人详情增加二选一审核区，时间线增加报告生成、提交和准入决定文案；展示操作者、版本、时间和原因。进入真人复面后仍由现有安排弹窗承接可编辑岗位默认面试官。                                                          | 0.5d | 审核 UI、timeline 映射和组件/DAO 测试。                          |

#### 阶段 F：兼容、回归与发布

| ID  | 工作项                                                                                                                                                                                     | 估时 | 交付物                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---: | ------------------------------------------------ |
| F1  | 根据 B1 结果执行 legacy 迁移：单一可验证旧评估建立只读 typed version；同轮多份评估进入 `migration_conflict` 并禁止决定，只接受经审计的人工映射。补完整生成、提交、决定集成测试和并发回归。 |   1d | 可 dry-run/backfill 脚本、迁移报告和端到端回归。 |
| F2  | 运行 shared/backend/web 定向测试、`pnpm typecheck`、`pnpm check`、`pnpm test` 和 `git diff --check`；额外覆盖岗位禁用 AI 面试及真人面试官默认值不回归。                                    | 0.5d | 测试日志、发布和回滚检查表。                     |

### 5. 合计与建议排期

| 阶段               | 工作项 |      估时 |
| ------------------ | -----: | --------: |
| A 统一契约         |      2 |      1.5d |
| B 持久化与历史闸门 |      3 |        3d |
| C 三路融合         |      3 |        3d |
| D API 与页面       |      3 |        3d |
| E 系统内审核       |      4 |      3.5d |
| F 兼容与发布       |      2 |      1.5d |
| **合计**           | **17** | **15.5d** |

建议按 4 个可独立验收的里程碑推进：

1. **M1（A+B，4.5d）**：契约、历史审计和版本存储完成，但不切生产生成链路。
2. **M2（C+D，6d）**：系统内可生成、查看和提交前确认三路融合草稿；由默认关闭的 feature flag 验收。
3. **M3（E，3.5d）**：系统内审核、阶段转换和提交后数据保护闭环。
4. **M4（F，1.5d）**：legacy 兼容、fork guard 回归和发布验收。

估时是单人顺序实施的工程判断，不含生产数据审计审批或产品验收的日历时间。

### 6. 待定项

1. **同一轮重置后的 conversation 选择**：计划默认以 `studio_interview_schedule.conversation_id` 当前指向的、最新 `summaryStatus=ready` 会话生成草稿；历史 attempts 只用于查看和审计，不做内容合并。
2. **同轮多份历史评估**：处理策略必须以 B1 实测结果为准；本计划只承诺保留和隔离，不承诺自动合并或删除。
3. **来源必需性**：表单未配置时是 `not_applicable`；仍需在 A1 评审时明确简历或 transcript 缺失时哪些报告状态允许保存、哪些必须阻止提交。

### 7. 关键文件索引

- `packages/db-schema/src/interview-session.ts`：当前报告 DTO 与 `Record<string, unknown>` 来源。
- `packages/db-schema/src/schema.ts`：conversation、snapshot、audit、候选人阶段和岗位设置表。
- `packages/shared/src/interview/`：新共享报告 Schema 的目标目录。
- `apps/ai-recruitment-copilot-backend/src/server/routes/agent/utils/interview-report.ts`：当前评估 Schema 与 prompt。
- `apps/ai-recruitment-copilot-backend/src/server/agents/mastra/workflows/interview-report-workflow.ts`：当前报告 workflow。
- `apps/ai-recruitment-copilot-backend/src/server/routes/agent/utils/interview-summary-job.ts`：当前报告持久化触发点。
- `apps/ai-recruitment-copilot-backend/src/server/routes/agent/utils/evidence-snapshot.ts`：三路冻结输入的现有基础。
- `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/routes/reports/`：轮次报告 API 与新 DAO 的归属目录。
- `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/utils/candidate-stage-transition.ts`：候选人阶段规则和事务入口。
- `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/resumes/application/launch-ai-interview-round.ts`：岗位禁用 AI 面试的后端 launch guard。
- `apps/ai-recruitment-copilot/src/components/features/studio/interviews/interview-detail/evaluation-results.tsx`：当前宽松报告渲染。
- `apps/ai-recruitment-copilot/src/components/features/studio/studio-person-detail-controller.tsx`：当前报告选择与前端 AI launch guard。
- `apps/ai-recruitment-copilot/src/components/features/studio/human-interview-stage-dialogs.tsx`：岗位默认真人面试官的可编辑安排入口。
- `CONTEXT.md`：本轮确认后的领域词汇。
