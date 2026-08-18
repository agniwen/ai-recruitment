# ODC 分析看板实现方案

> 对应需求文档：[`docs/odc-analysis-dashboard-data-requirements.md`](./odc-analysis-dashboard-data-requirements.md)
>
> 状态：实现初稿。本文按当前仓库的数据模型和 TanStack Start + Hono + Drizzle 架构编写，用于评审、拆分任务和验收，不代表所有待确认业务口径已经最终冻结。

## 1. 实现目标

在现有 `/w/:slug/studio/odc-analysis` 页面上实现招聘运营分析看板，覆盖：

1. 招聘需求概览。
2. 招聘整体进度 / 当前存量。
3. 今日工作台 / 当日动态及未来 3 天安排。
4. 时间、岗位筛选和指标下钻。
5. 全角色数据采集、按页面权限展示。

“ODC 分析”是页面名称和主要使用视角，不是数据采集范围。统计时不得使用“操作人当前角色是否为 ODC”作为基础过滤条件。ODC、HR、管理员、面试官、自定义角色和自动化产生的招聘事实都进入同一套统计。

## 2. 本期范围与非目标

### 2.1 本期范围

- 复用现有岗位、候选人、AI 面试、真人面试、Offer 和结案数据。
- 补齐看板无法可靠推导的关键时间与操作人快照。
- 新增 ODC 看板专用聚合查询，不修改现有招聘看板口径。
- 通过 URL 搜索参数保存筛选条件，并在下钻时继承筛选。
- 所有日期按 `Asia/Shanghai` 解释和展示。
- 指标查询限定在当前工作区 `organizationId` 内。

### 2.2 本期不做

- 不单独建立一套可人工编辑的“看板数字表”。
- 不按 ODC 角色过滤基础招聘数据。
- 不实现跨工作区汇总。
- 不新增招聘组实体；当前仓库尚无统一招聘组模型，先按工作区、用人组织、部门和岗位控制范围。
- 不在首期实现任意历史日期的岗位 HC / 空缺回放；该能力放到第二阶段的岗位变更历史中。
- 不把“当前角色”反写到历史记录中。

## 3. 已确认和建议采用的统计口径

### 3.1 已确认口径

- **当前待评估**：当前 `pipelineStage = 'screening'`、`outcome = 'in_pipeline'` 且 `resumeEvaluationStatus IS NULL` 的候选人，即简历筛选待评估；不包含已评估但尚未推进、AI 面试待完成或其他人工复核状态。
- **AI 面试**：统计去重候选人数。一个候选人在筛选范围内有多轮或多次会话，只计 1 人。
- **今日新增 Offer**：按逻辑 Offer 的首次成功发送时间统计。草稿、发送失败、同岗位改版和重复发送不重复计数。

当前系统中一条 `studioInterview` 表示候选人与当前岗位的一条招聘记录，因此 Offer 的逻辑去重键首期采用 `interviewRecordId`。同一候选人应聘不同岗位时可分别计数。

### 3.2 本方案建议冻结的默认口径

| 指标        | 实现口径                                                               | 日期字段                                        |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| 对接岗位数  | 去重的有效岗位数                                                       | `jobDescription.requestedDate`                  |
| 总 HC       | 筛选岗位 `headcount` 求和，空值按 0                                    | `requestedDate`                                 |
| 已到岗      | `outcome = 'hired'` 的去重招聘记录数                                   | `actualOnboardedAt`，历史数据回退到结案到岗日期 |
| 空缺        | `max(总 HC - 已到岗, 0)`                                               | 当前值                                          |
| 已关联简历  | 去重 `studioInterview.id` 数                                           | `studioInterview.createdAt`                     |
| 当前待评估  | 当前在简历筛选阶段且 `resumeEvaluationStatus IS NULL` 的去重招聘记录数 | 选择时间范围时按 `createdAt` 限制进入范围       |
| AI 面试     | 存在符合条件 AI 面试安排的去重 `interviewRecordId` 数                  | `scheduledAt`                                   |
| 面试环节数  | 符合条件、未取消的真人面试轮次数                                       | `scheduledAt`                                   |
| Offer       | 在范围内首次成功发送的逻辑 Offer 数                                    | 同一 `interviewRecordId` 的最早 `sentAt`        |
| 即将到岗    | 当前有效且已接受 Offer 的去重招聘记录数                                | Offer `joiningDate`                             |
| 实际到岗    | 已确认到岗的去重招聘记录数                                             | `actualOnboardedAt`                             |
| 淘汰 / 撤回 | `outcome IN ('rejected', 'withdrawn')` 的去重招聘记录数                | `closedAt`                                      |

“当前有效 Offer”指最新非 `superseded` 版本。预计到岗首期只统计 `accepted`，避免把未接受、已拒绝或已过期 Offer 误当成确定到岗计划。如果产品最终要求“已发送也算预计到岗”，只调整查询条件，不修改数据结构。

### 3.3 时间筛选规则

- 未传时间范围表示不限制。
- `from`、`to` 使用 `YYYY-MM-DD`，包含起止日。
- 服务端转换为北京时间的 `[from 00:00, to + 1 day 00:00)` 半开区间。
- 每个指标使用上表自己的业务日期，不使用通用 `updatedAt` 代替业务发生时间。
- 今日工作台固定以当前北京时间自然日统计；页面可显示日期，但首期不允许把它改成任意历史日。
- 未来 3 天定义为今天之后的三个自然日，不重复包含今天。

## 4. 总体技术方案

```text
ODC 页面 URL 搜索参数
        ↓
TanStack Router loader / createServerFn（页面权限校验）
        ↓
ODC analytics server module（10 秒短缓存）
        ↓
Backend DAO 并行聚合查询
        ↓
PostgreSQL 现有事实表 + 补充字段
```

实现原则：

- 页面路由保持薄层，只负责搜索参数校验、loader 和页面组件挂载。
- DTO 和搜索参数 schema 放在 `@arc/shared`，供前后端共同使用。
- 聚合 SQL 放在后端 ODC 路由拥有的 `dao.ts`，不继续扩张现有简历看板的 `resumes/dao/metrics.ts`。
- TanStack Start 的 server function 负责解析工作区和 `page:odcAnalysis` 权限，再调用后端 DAO。
- 聚合卡片按模块并行查询；不要逐岗位、逐候选人发起 N+1 查询。
- 指标由事实表实时计算，首期只做短缓存，不建物化汇总表。

## 5. 数据模型调整

### 5.1 必须补齐的字段

#### `interview_audit_log`

新增：

| 字段            | 类型                             | 说明                                                |
| --------------- | -------------------------------- | --------------------------------------------------- |
| `operator_role` | `text nullable`                  | 操作发生时的工作区角色快照                          |
| `source`        | `text not null default 'manual'` | `manual`、`agent`、`api`、`system`、`import` 等来源 |

同时扩展 `CandidateActivityInput`，所有调用处在可取得 `c.var.member.role` 时显式传入 `operatorRole`。系统自动事件允许 `operatorId = null`、`operatorRole = null`，但必须提供 `source = 'system'`。

已有日志无法准确还原历史角色，不应使用用户当前角色批量回填。旧数据保持 `null`，UI 统一显示“历史角色未知”。

#### `studio_interview`

新增：

| 字段                          | 类型                    | 说明                     |
| ----------------------------- | ----------------------- | ------------------------ |
| `created_by_role`             | `text nullable`         | 简历关联岗位时的角色快照 |
| `actual_onboarded_at`         | `timestamptz nullable`  | 实际到岗业务日期         |
| `onboarded_confirmed_at`      | `timestamptz nullable`  | 系统中执行到岗确认的时间 |
| `onboarded_confirmed_by`      | `text nullable FK user` | 到岗确认人               |
| `onboarded_confirmed_by_role` | `text nullable`         | 到岗确认人角色快照       |

当候选人以 `outcome = 'hired'` 结案时，同一事务写入以上到岗字段；重新激活时清空这些当前事实，并保留原 `candidate_transition` 审计日志。

#### `studio_interview_schedule`

新增：

| 字段              | 类型                   | 说明                |
| ----------------- | ---------------------- | ------------------- |
| `completed_at`    | `timestamptz nullable` | AI 面试明确完成时间 |
| `cancelled_at`    | `timestamptz nullable` | 取消时间            |
| `cancel_reason`   | `text nullable`        | 取消原因            |
| `created_by_role` | `text nullable`        | 安排人角色快照      |

并将 `ScheduleEntryStatus` 增加 `cancelled`。完成时写 `completedAt`，取消时写 `cancelledAt`，不再用 `updatedAt` 推断完成日期。

#### `studio_human_interview_round`

新增：

| 字段                | 类型                    | 说明                   |
| ------------------- | ----------------------- | ---------------------- |
| `started_at`        | `timestamptz nullable`  | 候选人本轮实际开始时间 |
| `created_by`        | `text nullable FK user` | 安排人                 |
| `created_by_role`   | `text nullable`         | 安排人角色快照         |
| `completed_by`      | `text nullable FK user` | 完成人                 |
| `completed_by_role` | `text nullable`         | 完成人角色快照         |

线上会议可在候选人首次 `joinedAt` 时同步写 `startedAt`；线下或外部会议由操作人在标记“进行中/完成”时写入。

#### `studio_offer_draft`

新增：

| 字段              | 类型                    | 说明           |
| ----------------- | ----------------------- | -------------- |
| `created_by`      | `text nullable FK user` | 版本创建人     |
| `created_by_role` | `text nullable`         | 创建人角色快照 |
| `sent_by`         | `text nullable FK user` | 成功发送人     |
| `sent_by_role`    | `text nullable`         | 发送人角色快照 |

发送 Offer 时在同一更新中写入 `sentAt`、`sentBy`、`sentByRole`。看板仍通过同一招聘记录的最早 `sentAt` 得到“首次成功发送”，不把新版重发计为新增 Offer。

### 5.2 索引

为看板常用范围查询增加组合索引：

- `studio_interview (organization_id, job_description_id, created_at)`。
- `studio_interview (organization_id, pipeline_stage, outcome, created_at)`；若现有相近索引可覆盖则不重复创建。
- `studio_interview (organization_id, outcome, actual_onboarded_at)`。
- `studio_interview_schedule (organization_id, scheduled_at, status, interview_record_id)`。
- `studio_human_interview_round (organization_id, scheduled_at, status)`。
- `studio_offer_draft (organization_id, interview_record_id, sent_at)`。
- `studio_offer_draft (organization_id, joining_date, status)`。
- `interview_audit_log (organization_id, action, created_at)`。

生成迁移后必须用 `EXPLAIN (ANALYZE, BUFFERS)` 检查真实查询计划，再决定是否保留所有候选索引，避免仅凭文档一次性创建冗余索引。

### 5.3 历史数据回填

迁移分为结构迁移和安全回填：

1. AI 面试 `status = 'completed'` 的旧数据，将 `completedAt` 临时回填为 `updatedAt`，并在数据说明中标记为推定时间。
2. 已到岗旧数据从 `closedMeta.hiredDetails.joiningDate` 解析 `actualOnboardedAt`；无法解析时回退 `closedAt`。
3. Offer 首次发送无需新增字段，可按 `MIN(sentAt)` 回算。
4. 历史操作人角色不回填，保持 `null`。
5. 真人面试历史 `startedAt` 不用 `completedAt` 反推，保持 `null`。

回填脚本需要可重复执行，并输出成功、跳过和失败数量。

### 5.4 第二阶段：岗位历史回看

如果产品确认时间筛选必须回答“某个历史日期当时的 HC、缺口和岗位状态”，新增 `job_description_change_log`：

- `organizationId`、`jobDescriptionId`。
- `changedAt`、`changedBy`、`changedByRole`、`source`。
- `before`、`after` JSONB 快照，只保留招聘分析相关字段。

所有手工修改和 Google Sheet 同步必须通过同一写入入口追加日志。首期需求概览只显示当前岗位值，并按 `requestedDate` 过滤，不伪装成历史快照。

## 6. 共享类型与接口契约

新增 `packages/shared/src/odc-analysis.ts`：

```ts
interface OdcAnalysisFilters {
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  jobDescriptionIds?: string[];
}

interface OdcAnalysisMetric {
  key: string;
  label: string;
  value: number;
  unit: "candidate" | "job" | "round" | "headcount" | "offer";
  drilldown: OdcAnalysisDrilldown;
}

interface OdcAnalysisData {
  generatedAt: string;
  timeZone: "Asia/Shanghai";
  filters: OdcAnalysisFilters;
  demand: {
    connectedJobs: number;
    totalHeadcount: number;
    onboarded: number;
    vacancies: number;
  };
  overall: OdcAnalysisMetric[];
  today: OdcAnalysisMetric[];
  upcoming: {
    aiInterviews: Array<{ day: string; candidates: number }>;
    arrivals: Array<{ day: string; candidates: number }>;
  };
  todayInterviewStates: {
    completed: number;
    inProgress: number;
    upcoming: number;
  };
}
```

实际实现使用 Zod schema 生成类型，并限制：

- 最多选择 100 个岗位。
- `from <= to`。
- 单次时间范围最长建议 366 天；不传范围不受此限制。
- 岗位 ID 必须属于当前工作区，非法或越权 ID 返回 400，不静默忽略。

## 7. 后端聚合实现

新增目录：

```text
apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/odc-analysis/
├── dao.ts
├── route.ts
├── schema.ts
└── __tests__/
```

并在 Studio router 中挂载 `.route("/odc-analysis", odcAnalysisRouter)`。

虽然页面首期通过 TanStack Start server function 直接调用 DAO，仍保留 Hono JSON GET 接口，便于后续导出、外部 BI 和独立后端运行：

```text
GET /api/w/:slug/studio/odc-analysis
  ?from=2026-08-01
  &to=2026-08-31
  &jobDescriptionIds=jd_1,jd_2
```

接口要求：

- 使用 `requirePermission("page", "odcAnalysis")` 对等的页面访问校验；若现有 Hono 权限中间件只支持资源权限，则新增专用页面权限校验，不用 `jd:read` 替代。
- 使用 `zValidator("query", ...)` 和显式 `c.json(data, 200)` 保留 Hono RPC 类型。
- 查询条件始终包含 `organizationId`。
- 岗位过滤以数组条件下推到 SQL，不在内存中过滤。

### 7.1 DAO 查询拆分

`loadOdcAnalysisData(organizationId, filters)` 内部并行执行：

1. `loadDemandSummary`：岗位数、HC、已到岗、空缺。
2. `loadOverallCandidateMetrics`：已关联、当前待评估、淘汰、撤回、实际到岗。
3. `loadAiInterviewMetrics`：AI 面试去重候选人和未来 3 天安排。
4. `loadHumanInterviewMetrics`：真人轮次和今日状态分布。
5. `loadOfferMetrics`：逻辑 Offer、预计到岗、今日新增、未来 3 天到岗。
6. `loadJobOptions`：筛选器岗位选项可单独复用现有岗位接口，不放进每次指标查询。

关键 SQL 规则：

- AI 面试统一使用 `COUNT(DISTINCT studio_interview_schedule.interview_record_id)`。
- 逻辑 Offer 首次发送先按 `interviewRecordId` 做 `MIN(sentAt)` CTE，再按范围计数。
- 当前有效 Offer 使用窗口函数按 `version DESC` 取每个 `interviewRecordId` 最新版本，再判断状态。
- 真人面试环节使用 `COUNT(studio_human_interview_round.id)`，不按候选人去重。
- 淘汰与撤回底层分别聚合，卡片值相加，DTO 保留分项供悬停和下钻。
- 取消的 AI / 真人面试不进入计划数。
- 所有时间条件使用半开区间，禁止对有索引的时间列包 `date()` 后再过滤。

### 7.2 缓存与失效

参考现有 Studio dashboard：

- server module 使用最大 100 条的 LRU，成功结果缓存 10 秒。
- cache key 包含 `organizationId + from + to + 排序后的岗位 ID`。
- 并发相同请求共享同一 Promise。
- 写入侧不强制逐路径精准失效；10 秒 TTL 足以满足首期运营看板。
- 若后续要求操作后立即刷新，再由候选人、面试、Offer 和岗位写入入口统一调用 `clearOdcAnalysisCache(organizationId)`。

## 8. TanStack Start 页面数据加载

新增：

```text
apps/ai-recruitment-copilot/src/lib/start/studio/odc-analysis.functions.ts
apps/ai-recruitment-copilot/src/lib/start/studio/odc-analysis.server.ts
```

`loadOdcAnalysisState` 的处理顺序：

1. 校验 `slug + filters`。
2. 调用 `resolveAuthorizedStudioPageAccessFromRequest(slug, "odcAnalysis")`。
3. 未登录返回 `unauthenticated`，无权限返回 `not_found`。
4. 使用解析后的 `workspace.id` 调用后端 DAO。
5. 返回 `ready + data`。

路由 `w.$slug.studio.odc-analysis.tsx` 增加：

- `validateSearch`：规范化 `from`、`to`、`jdIds`。
- `loaderDeps`：只包含稳定、排序后的筛选值。
- `loader`：调用 server function。
- ready / unauthenticated / not found 分支，与现有 Studio dashboard 保持一致。

## 9. 前端页面实现

页面代码继续放在：

```text
apps/ai-recruitment-copilot/src/components/features/studio/odc-analysis/
```

建议拆分：

```text
odc-analysis-page.tsx
odc-analysis-filters.tsx
demand-summary.tsx
metric-card.tsx
overall-progress-panel.tsx
today-workbench-panel.tsx
interview-state-legend.tsx
odc-analysis-skeleton.tsx
odc-analysis-empty-state.tsx
odc-analysis-drilldown.ts
```

### 9.1 页面布局

1. 页面标题：“ODC 分析”。描述改为“查看工作区招聘需求、候选人流转与当日安排”，避免暗示只统计 ODC 数据。
2. 顶部筛选栏：时间范围、岗位多选、重置。
3. 招聘需求概览：对接岗位、总 HC、已到岗、空缺。
4. 招聘整体进度：8 个指标卡，响应式网格。
5. 今日工作台：8 个指标卡及未来 3 天、面试状态辅助信息。

页面状态：

- 首次加载使用与最终布局等高的 skeleton，避免跳动。
- 查询失败展示局部重试，不清空用户筛选。
- 无岗位数据展示空状态。
- 某一指标为 0 时仍显示卡片和 0，不把它当成加载失败。

### 9.2 筛选状态

URL 参数：

- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`
- `jdIds=jd_1,jd_2`

修改筛选使用 replace navigation，避免每次勾选都污染浏览器历史。岗位选项显示岗位名称和编码，已关闭岗位在历史筛选中保留但做状态标识。

### 9.3 指标下钻

不新增一套重复列表页面，优先跳到已有业务页面：

| 指标                                | 目标页面          | 附加筛选                        |
| ----------------------------------- | ----------------- | ------------------------------- |
| 已关联、待评估、淘汰/撤回、实际到岗 | 简历库            | 岗位、阶段、结果、日期范围      |
| AI 面试                             | 面试管理          | 类型 AI、计划日期、岗位         |
| 面试环节                            | 面试管理          | 类型真人、计划日期、岗位        |
| Offer、预计到岗                     | 简历库 Offer 阶段 | Offer 状态、发送/到岗日期、岗位 |
| 对接岗位、HC、空缺                  | 岗位管理          | 岗位 ID、招聘状态               |

现有目标页面如果暂不支持某个筛选参数，应先补齐其搜索参数解析，再启用该卡片跳转。禁止跳转后丢失筛选却显示为“同一批数据”。

悬停内容至少展示：统计口径、日期维度、单位；淘汰/撤回展示两项拆分，面试展示状态拆分。

## 10. 权限与数据范围

- 页面入口和路由继续使用已有 `page:odcAnalysis`。
- 所有有该页面权限的角色看到同一工作区范围内、符合岗位筛选的数据；数据是否由 ODC 创建不影响计数。
- 页面权限只控制能否查看看板，不授予修改候选人、岗位或 Offer 的权限。
- 下钻目标页仍执行自身权限。用户有 ODC 看板权限但没有简历库权限时，卡片展示数字但不提供可点击跳转，或展示“无明细查看权限”。
- 操作人角色快照只用于后续角色维度分析和审计，首期 UI 不提供角色筛选。
- 所有 DAO 必须以服务端解析的 `organizationId` 为准，不能信任客户端传入组织 ID。

## 11. 测试方案

### 11.1 共享 schema 单元测试

- 正常日期、缺失日期、反向日期、非法日期。
- 岗位 ID 去重、排序、最多 100 个。
- DTO 中单位和指标 key 完整。

### 11.2 DAO 集成测试

至少覆盖：

1. 同一候选人两轮 AI 面试只计 1 人。
2. 两名候选人同一天 AI 面试计 2 人。
3. 同一招聘记录两版 Offer 都发送，今日新增只计首次发送的 1 个逻辑 Offer。
4. 草稿、发送失败、已被新版替代版本不造成重复新增。
5. 真人面试按轮次计数，同一候选人两轮计 2。
6. 取消面试不进入今日和未来安排。
7. 当前待评估只包含 `screening + in_pipeline + resumeEvaluationStatus IS NULL`。
8. 淘汰和撤回卡片合计正确、明细分项正确。
9. 实际到岗使用 `actualOnboardedAt`，不因预计到岗日已到自动计入。
10. 岗位筛选和时间边界正确。
11. 北京时间 00:00 边界正确。
12. 工作区 A 的查询不会泄漏工作区 B 数据。
13. 最新有效 Offer 的预计到岗不会被旧版本重复计算。
14. 无数据时所有指标返回 0 而非 `null`。

### 11.3 权限测试

- 有 `page:odcAnalysis` 可以加载。
- 无权限直接访问得到 404 语义。
- 页面权限不会绕过简历库等下钻页面权限。
- owner/admin 默认权限和自定义角色配置保持现有测试覆盖。

### 11.4 前端测试

- 搜索参数与筛选控件双向同步。
- 重置恢复默认“不限时间、不限岗位”。
- 今日工作台显示未来 3 天且不包含今天。
- 指标为 0、加载中、失败、无岗位四种状态。
- 下钻 URL 正确保留日期和岗位参数。
- 页面文案不描述为“只看 ODC 产生的数据”。

### 11.5 验证命令

实施完成后至少运行：

```bash
pnpm db:generate
pnpm --filter @arc/ai-recruitment-copilot-backend test
pnpm --filter @arc/ai-recruitment-copilot-backend typecheck
pnpm --filter @arc/ai-recruitment-copilot test
pnpm --filter @arc/ai-recruitment-copilot typecheck
pnpm check
```

## 12. 实施顺序

### 阶段 A：数据基础

1. 新增 schema 字段、状态枚举和索引。
2. 生成迁移并编写可重复回填脚本。
3. 修改候选人流转、AI 面试、真人面试、Offer 写入路径，保证新字段从上线后可靠产生。
4. 为角色快照和关键事件时间补集成测试。

验收：新产生的数据不依赖 `updatedAt` 推断业务事件，操作人角色变更不会改写历史角色。

### 阶段 B：聚合服务

1. 新增共享 schema / DTO。
2. 实现 ODC DAO 和 Hono GET 接口。
3. 实现聚合测试、权限测试和短缓存。

验收：固定测试数据下每个指标、边界和去重结果准确。

### 阶段 C：页面

1. 改造 ODC route loader 和搜索参数。
2. 实现筛选器、概览、整体进度、今日工作台。
3. 接入 loading / error / empty 状态。
4. 实现有权限感知的下钻链接。

验收：页面刷新后筛选不丢失，各卡片数字可解释并与下钻明细一致。

### 阶段 D：历史能力和性能

1. 评审是否需要岗位历史回放。
2. 若需要，增加岗位变更日志并改造 Google Sheet 与手工更新入口。
3. 根据生产查询计划决定是否增加物化视图或异步汇总。

## 13. 上线与观测

- 先迁移新增可空字段，再发布双写代码，最后启用看板查询和 UI。
- 回填期间不阻塞正常招聘流转。
- 对聚合查询记录耗时、筛选范围和结果行数，不记录候选人姓名、电话等个人信息。
- 建议告警阈值：P95 超过 1 秒或单次查询超过 3 秒。
- 上线首周抽样核对至少 5 个岗位：简历数、AI 候选人数、真人轮次、Offer 首发、预计到岗、实际到岗和淘汰/撤回。
- 若新旧字段不一致，以明确业务事实字段为准，并记录数据质量问题，不静默使用 `updatedAt` 长期兜底。

## 14. 完成标准

满足以下条件才视为实现完成：

- ODC 页面展示需求概览、整体进度和今日工作台。
- 当前待评估、AI 面试候选人数、Offer 首次发送三个已确认口径有自动化测试。
- 所有角色产生的数据均进入统计，不存在 ODC 角色硬编码过滤。
- 页面和服务端均验证 `page:odcAnalysis`。
- 时间与岗位筛选可刷新保留，并传递到可访问的下钻页面。
- 指标和下钻明细在同一筛选下能够对账。
- AI 完成、取消、实际到岗、Offer 发送不再依赖通用更新时间推断。
- 历史角色未知时明确为空，不使用当前角色伪造快照。
- 类型检查、测试和代码检查全部通过。

## 15. 实施前仍需产品确认

以下问题不阻塞数据基础建设，但会影响最终查询条件或交互：

1. 空缺是否仅为 `HC - 实际到岗`，还是扣除已接受 Offer 待到岗；本方案默认不扣。
2. 即将到岗是否只统计已接受 Offer；本方案默认只统计 `accepted`。
3. “面试环节”是否包含笔试；本方案默认只统计真人面试轮次。
4. ODC 页面是否始终查看整个工作区，还是未来增加用人组织 / 招聘组数据范围；首期按整个工作区加岗位筛选。
5. 点击 Offer 是否进入简历库 Offer 阶段，还是后续新增独立 Offer 列表；首期进入简历库。
6. 岗位 HC 是否需要历史时点回放；首期只展示当前值。
