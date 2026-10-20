# 2026-10-20 SSC Telegram 更新验证记录

验证代码对应提交 `b26c139f`，变更收录于 [PR #3](https://github.com/agniwen/ai-recruitment/pull/3)。

测试在独立目录和仅复制表结构的独立 PostgreSQL 数据库中运行，使用测试占位配置；未加载真实机器人凭据，未复制业务数据。7 个修改的 TypeScript 文件已核对与提交内容一致。

## 本次改动的检查

- TG 截图与确认相关 4 组专项测试：70 项通过。
- 审查新增用例先复现失败，再验证修复；覆盖上传目标切换、同一 Offer 并发提示、卡片登记失败、写入已提交但响应失败及恢复失败。
- 前端、后端 TypeScript 类型检查均通过。
- 修改的 7 个 TypeScript 文件格式和 lint 检查通过，0 警告、0 错误。
- 独立代码审查发现的问题已修复，最终复查无遗留可操作问题。

## 工作区全量回归

以下为补齐独立数据库与测试占位配置后的最终结果。未配置数据库时的首次初始化失败不混入本表。跳过项按各套件的条件记录，不计为通过。

| 范围 | 通过 | 失败 | 跳过 |
| --- | ---: | ---: | ---: |
| Backend | 2124 | 54 | 287 |
| Web | 1372 | 16 | 0 |
| Worker | 47 | 0 | 0 |
| Shared | 547 | 0 | 0 |
| Feishu Adapter | 92 | 0 | 0 |
| Resume Parse Queue | 35 | 0 | 5 |
| 合计 | 4217 | 70 | 292 |

全量共 4579 项，未达到全部通过；最终运行没有套件初始化错误。

## 失败归因与基线对比

对比分支基线 `70304241`（不包含本 PR 的 SSC 无邮箱审核和截图修复），使用相同依赖及独立数据库：

- 68 个失败用例在基线中逐项复现，其中 Backend 54 项、Web 14 项。此结论针对同一隔离环境的分支基线，不代表当前 main 分支已验证存在同样失败。
- 其余 2 项为导航和简历列表 SSR 在全量上下文中的失败。将对应的 2 个文件以单 worker 单独复跑时，当前代码与基线均为 3 项通过、0 项失败，记录为全量上下文或时序问题，不把单独复跑替换为全量通过。

本 PR 保留草稿状态，保留上述全量失败记录供后续评审；没有通过改动无关功能或测试断言来消除这些失败。

## 全量失败用例清单

### `apps/ai-recruitment-copilot-backend/src/server/__tests__/internal-error-response-boundary.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| internal error response boundary never returns raw internal error messages from 500 handlers | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/access/__tests__/resume-visibility-odc.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| ODC approval recipient visibility allows the designated ODC through the shared source, including subsequent stages | 基线中复现 |
| ODC approval recipient visibility denies another ODC on the same source even if they created the record or share the recruiting group | 基线中复现 |
| ODC approval recipient visibility does not let inherited unrestricted recruiting access bypass assignment | 基线中复现 |
| ODC approval recipient visibility allows cross-source review for approvers but never a cross-source offer or assignment | 基线中复现 |
| ODC approval recipient visibility does not grant unselected ODCs access to a multi-assigned candidate | 基线中复现 |
| ODC approval recipient visibility recognizes approvals written by the old version after migration | 基线中复现 |
| ODC approval recipient visibility clears stale multi-assignments when the old version approves to a | 基线中复现 |
| ODC approval recipient visibility clears stale multi-assignments when the old version approves to c | 基线中复现 |
| ODC approval recipient visibility stores new assignments only in the relation table and clears the stale legacy assignee | 基线中复现 |
| ODC approval recipient visibility preserves the other assignees if the legacy primary user is deleted | 基线中复现 |
| ODC approval recipient visibility preserves normal recruiting visibility for non-ODC roles | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/access/__tests__/workspace-authorization-boundary.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| request-scoped workspace authorization boundary does not use mutable active-organization session state in application code | 基线中复现 |
| request-scoped workspace authorization boundary mounts every workspace business router behind one URL-scoped boundary | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/platform/routes/resume-parse-cache/__tests__/route.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| platform resume parse cache routes passes list filters through the validated platform endpoint | 基线中复现 |
| platform resume parse cache routes uses 10 rows as the default page size | 基线中复现 |
| platform resume parse cache routes returns cache JSON and clears same-hash cache data | 基线中复现 |
| platform resume parse cache routes returns 404 for missing cache records | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/public/routes/entry-credentials/route.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| public credential request boundary validates a credential response and sanitizes verifier failures | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/hiring-units/__tests__/route-permissions.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| hiring units route permissions keeps management endpoints protected by hiring unit resource permissions | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/__tests__/context-snapshot-boundary-source.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| interview context snapshot creation boundary keeps creation on launch/transition/reset paths only | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/__tests__/patch-whitelist.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| interview PATCH whitelist (R7) does not include candidate-identity columns in the PATCH update set | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/__tests__/stage-permission-source.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| late-stage route permissions splits human interview routes by CRUD permissions | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/dao/__tests__/interview-rounds.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| queryPaginatedInterviewRounds serializes lastInterviewAt from conversation timestamps without timezone loss | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/dao/external-interviewers.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| external interviewer Telegram bindings accepts a system user's binding without a requester binding | 基线中复现 |
| external interviewer Telegram bindings rejects missing chat ids and bindings for an old profile username | 基线中复现 |
| external interviewer Telegram bindings preserves requester bindings and adds system user recipients | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/routes/round-emails/__tests__/route.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| POST /:roundId/send returns 400 when candidate email is missing; send not called | 基线中复现 |
| POST /:roundId/send returns 200 on success and persists a sent log in DB | 基线中复现 |
| POST /:roundId/send returns 400 and persists a failed log when Resend returns an error | 基线中复现 |
| POST /:roundId/send POST /:roundId/send -> 500 when Resend client throws, writes failed log | 基线中复现 |
| GET /summary returns 200 with correct count for rounds with logs, zero for others | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/job-descriptions/utils/job-description-code.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| job description code helpers normalizes an optional generated code in job description input | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/mail-ingest/__tests__/route.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| mailIngestRouter rejects platform create when the IMAP login cannot be validated | 基线中复现 |
| mailIngestRouter rejects platform update when the IMAP login cannot be validated | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/resume-pool/__tests__/bind.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| POST /:id/bind returns 400 when the job description does not exist | 基线中复现 |
| POST /:id/bind returns 400 when the job description belongs to another organization | 基线中复现 |
| POST /:id/bind returns 400 when the job description is outside the recruiter's hiring-unit scope | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/resume-pool/__tests__/dao.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| deleteOwnPoolItem rejects deleting another user's items | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/resume-upload-batches/__tests__/batches.dao.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| reviveOrphans 只复活超过阈值的 processing item，fresh processing item 保持不动 | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/resumes/__tests__/dao.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| queryPaginatedResumeRecords returns records without interview-only fields | 基线中复现 |
| queryPaginatedResumeRecords serializes lastInterviewAt from conversation timestamps without timezone loss | 基线中复现 |
| queryPaginatedResumeRecords aggregates humanInterview branch and excludes cancelled rounds from totals | 基线中复现 |

### `apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/resumes/__tests__/route.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| resume launch interview route source uses the shared candidate pipeline rule before launching AI interview | 基线中复现 |
| resume launch interview route source creates the interview context snapshot when launching AI interview | 基线中复现 |
| resume review generation queue source keeps review worker idempotent and status-driven | 基线中复现 |
| resume detail route database behavior resume detail DTO hides interview-only fields from the detail shape | 基线中复现 |
| resume duplicate match details route exposes duplicate match details for badge clicks | 基线中复现 |
| resume OCR text persistence persists parser text on direct uploads, batch uploads, pool rows, and pool imports | 基线中复现 |
| resume library list DTO exposes card-ready summary fields instead of full resume JSON blobs | 基线中复现 |
| resume review detail route exposes authenticated review endpoints without relaxing the existing library detail route | 基线中复现 |
| resume review detail route shows reactivation reason from candidate transition audit logs | 基线中复现 |
| candidate timeline audit deduplication prefers operator audit entries over duplicate system entity events | 基线中复现 |
| resume review v3 chain coverage does not generate structured resume review synchronously for resume-pool imports | 基线中复现 |

### `apps/ai-recruitment-copilot/src/__tests__/architecture/animation-motion-regressions.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| animation motion regressions keeps the text shimmer on CSS with a static reduced-motion state | 基线中复现 |

### `apps/ai-recruitment-copilot/src/__tests__/architecture/dark-theme-palette.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| dark theme palette derives touch and selection feedback from the active theme | 基线中复现 |

### `apps/ai-recruitment-copilot/src/__tests__/architecture/shared-badge-usage.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| shared Badge usage does not override the shared Badge dimensions or typography | 基线中复现 |

### `apps/ai-recruitment-copilot/src/__tests__/architecture/vite-dependency-optimization.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| Vite dependency optimization uses the cached dev command from the default Make target | 基线中复现 |

### `apps/ai-recruitment-copilot/src/components/__tests__/date-time-picker.test.tsx`

| 用例 | 同环境基线对比 |
| --- | --- |
| date and time pickers disables dates outside the configured date-only bounds | 基线中复现 |

### `apps/ai-recruitment-copilot/src/components/features/studio/human-interview-schedule-conflicts.test.tsx`

| 用例 | 同环境基线对比 |
| --- | --- |
| human interview scheduling conflict confirmation separates the progress summary and available times into a responsive row | 基线中复现 |
| human interview scheduling conflict confirmation refreshes on window transitions and every minute, then stops after unmount | 基线中复现 |
| human interview scheduling conflict confirmation checks again after cancellation and time changes | 基线中复现 |
| human interview scheduling conflict confirmation checks the existing-round meeting entry point, excluding itself, then waits for confirmation | 基线中复现 |

### `apps/ai-recruitment-copilot/src/components/features/studio/human-interview-stage-panel.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| human interview editing gates initializes scheduling from the configured interviewers and requires a selection | 基线中复现 |

### `apps/ai-recruitment-copilot/src/components/features/studio/resume-pool/__tests__/resume-pool-list.ssr.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| resume pool list SSR boundary loads without evaluating the client-only masonry package | 基线中复现 |
| resume pool list SSR boundary keeps existing cards fully opaque while more records load | 当前与基线单独复跑通过；全量上下文仍失败 |

### `apps/ai-recruitment-copilot/src/components/layout/app-sidebar/sidebar-inset-header.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| SidebarInsetHeader translucent sticky layout keeps platform and studio headers inside the scroll area | 基线中复现 |

### `apps/ai-recruitment-copilot/src/lib/client/router-pending-navigation.test.tsx`

| 用例 | 同环境基线对比 |
| --- | --- |
| platform/workspace navigation keeps the app mounted when a stale pending match outlives its load, then navigates both ways | 当前与基线单独复跑通过；全量上下文仍失败 |

### `apps/ai-recruitment-copilot/src/routes/__test__/-studio-crud-routes-migration.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| TanStack Start studio CRUD route migration prompts for selectable hiring unit before importing resume pool items | 基线中复现 |

### `apps/ai-recruitment-copilot/src/routes/__test__/-studio-resumes-migration.test.ts`

| 用例 | 同环境基线对比 |
| --- | --- |
| TanStack Start studio resumes migration adds a permission-scoped copy detail link action to resume-library rows | 基线中复现 |

## 真人验收与部署范围

上传后自动出卡的前序版本已在本地发出新的测试 Offer；本次审查补充修复尚需随 PR 更新服务。尚未收录上传后自动出卡及最终确认的真人验收结果；发卡成功不作为整条审核链路验收通过。
