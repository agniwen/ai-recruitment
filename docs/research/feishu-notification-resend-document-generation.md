# Platform 飞书通知重发与评价表生成链路调研

日期：2026-07-20

## 结论

目标仓库已经实现了评价表的“有 URL 则复用、没有则创建”基础能力，但它目前只接在 **AI 报告完成后的自动通知**与 **`failed`/`pending` 通知恢复**链路中。源项目所描述的 Platform 通知 Debugger、“重新发送通知”按钮、`POST /api/platform/notifications/:id/resend` 和 `resendInterviewSummaryNotification()` 在本 fork 中都不存在；当前 Platform 导航和后端挂载也没有 notifications 模块。[源码：Platform 导航](../../apps/ai-recruitment-copilot/src/components/features/platform/platform-sidebar-slots.tsx#L40) [源码：Platform 后端挂载](../../apps/ai-recruitment-copilot-backend/src/server/routes/platform/route.ts#L575)

因此，本仓库现在不能声称“已发送通知可由 Platform 管理员手动重发”。现有 `claimNotification()` 遇到 `sent` 会直接跳过，只有失败或待发送记录重试时才会复用 `feishu_document_url`。若要补齐源项目的用户故事，应复用现有 ensure 入口并新增一条显式重发服务，而不是再造文档生成链路。[源码：claim 与 ensure](../../apps/ai-recruitment-copilot-backend/src/server/routes/agent/utils/feishu-interview-notifications.ts#L245)

## 文档当前在何时生成

主流程不是在 LiveKit 通话断开时创建文档，而是在 AI 报告生成完毕后创建：

1. `runSummaryJob()` 生成 summary 和 evaluation。
2. 把会话的 `summaryStatus` 更新为 `ready`，同时写入 `transcriptSummary` 与 `evaluationCriteriaResults`。
3. 随即以 fire-and-forget 方式调用 `notifyInterviewSummaryReady()`。[源码：interview-summary-job.ts](../../apps/ai-recruitment-copilot-backend/src/server/routes/agent/utils/interview-summary-job.ts#L121)
4. 通知函数要求上下文存在、状态为 `ready`、存在创建人和面试轮次；之后为创建人的每个飞书账号 claim 一条通知，ensure 评价表，再发送卡片。[源码：feishu-interview-notifications.ts](../../apps/ai-recruitment-copilot-backend/src/server/routes/agent/utils/feishu-interview-notifications.ts#L523)

自动生成的精确业务时点是：**AI 报告已落库并变为 `ready`，准备发送 summary-ready 通知时**。

另有一个受 `X-Agent-Secret` 保护的恢复接口。传入会话和面试记录时，它重新调用同一通知函数；不传时批量扫描 `failed`/`pending` 记录，并补扫缺失的 Google 邮件通知。[源码：agent/route.ts](../../apps/ai-recruitment-copilot-backend/src/server/routes/agent/route.ts#L334) [源码：批量重试](../../apps/ai-recruitment-copilot-backend/src/server/routes/agent/utils/feishu-interview-notifications.ts#L602)

## 本 fork 的飞书架构

本仓库不是单一 Lark adapter：

- Better Auth 注册两个飞书 provider：`feishu` 和 `feishu-jiguang-hr`，分别使用 `FEISHU_APP_ID/SECRET` 与 `FEISHU_APP_ID2/SECRET2`。[源码：auth.ts](../../apps/ai-recruitment-copilot-backend/src/lib/server/auth.ts#L276) [源码：provider.ts](../../apps/ai-recruitment-copilot-backend/src/server/routes/feishu/utils/provider.ts#L1)
- 卡片发送走 `Chat` + 本地 workspace package `@arc/adapter-feishu`。bot/adapter 按 provider 缓存，PostgreSQL state 使用 `feishu:${providerId}` 隔离，并有双 provider 的初始化、失败回滚和 shutdown 生命周期。[源码：bot.ts](../../apps/ai-recruitment-copilot-backend/src/server/routes/feishu/utils/bot.ts#L1) [源码：adapter](../../packages/adapter-feishu/src/index.ts#L1)
- Docx 创建不经过 `@arc/adapter-feishu`。它按 provider 取应用凭据和 `tenant_access_token`，直接调用飞书 Docx/Drive Open API；卡片才通过 `postFeishuDirectCard()` 发出。[源码：feishu-docx.ts](../../apps/ai-recruitment-copilot-backend/src/server/routes/feishu/utils/feishu-docx.ts#L110)
- 通知表还承载 Google/Resend 邮件，但 Google 分支不创建飞书文档。讨论“双 provider”时应特指两个飞书 provider，不能把 Google 邮件与飞书机器人混为一条 transport。

## 自动通知与重试生命周期

1. `loadRecipientAccounts(createdBy)` 查找创建人的两个飞书 provider 账号；同一用户绑定两个 provider 时，会产生两条独立通知。
2. `claimNotification()` 以面试记录、会话、通知类型、接收用户和 provider 标识记录。新记录为 `pending`；旧的 `failed`/`pending` 会清错并回到 `pending`；`sent` 直接跳过。
3. `ensureInterviewEvaluationDocument()` 先读该通知的 `feishu_document_url`。存在则复用；为空才创建、写块、授权接收人的 Open ID，并保存 ID/URL。
4. 卡片发送成功后保存 message ID、`sentAt` 并转为 `sent`；任一步失败都写入 `error` 并转为 `failed`。
5. 批量恢复一次最多扫描 20 条 `failed`/`pending`，按“面试记录 + 会话”去重后重新进入通知函数。它不会重发 `sent`，也不会发现从未 claim 的缺失飞书记录；缺少轮次时函数在 claim 前返回，后续只能靠显式 scoped retry 或其他补偿再次触发。Google 邮件另有缺失记录补扫逻辑，飞书当前没有对等补扫。

数据库已经提供 `feishu_document_id` 和 `feishu_document_url`，并用“面试记录 + 会话 + 通知类型 + 接收用户 + provider”唯一索引约束通知身份。[源码：schema.ts](../../packages/db-schema/src/schema.ts#L1724)

这里的复用粒度是**每条通知记录**，不是每场面试全局一份文档。同一面试按“接收用户 + 飞书 provider”分别标识通知；命中两个 provider 时会分别创建评价表，同一条失败/待发送记录重试时才稳定复用自己的文档。

## 权限、招聘组与 hiringUnit 边界

自动通知和 `X-Agent-Secret` 恢复接口属于内部 agent 流程，没有当前 workspace 用户作为 actor；它们以记录的 `organizationId`、`createdBy` 和 provider 账号选择接收人，不经过动态 workspace 权限快照。这不等于文档里的系统链接绕过权限：面试详情、报告和简历接口仍由 workspace 路由的 `requirePermission("interview", "read")` 与招聘可见域保护。[源码：动态权限快照](../../apps/ai-recruitment-copilot-backend/src/server/access/workspace-permission-snapshot.ts#L58) [源码：报告路由](../../apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/routes/reports/route.ts#L7)

本 fork 的数据域有两个需要分别处理的维度：

- `resolveRecruitingVisibilityScope()` 按 workspace 角色和招聘组层级计算可见创建人；当前面试详情/报告以轮次 `createdBy` 落这个过滤。[源码：招聘可见域](../../apps/ai-recruitment-copilot-backend/src/server/access/recruiting-visibility.ts#L19) [源码：轮次详情过滤](../../apps/ai-recruitment-copilot-backend/src/server/routes/studio/routes/interviews/dao/interview-rounds.ts#L403)
- `studioInterview.hiringUnitId` 与 `recruiting_group_hiring_unit` 表达用人组织范围；`resolveHiringUnitAccessScope()` 是目标仓库已有的 hiringUnit scope 入口。当前通知上下文没有读取或检查 `hiringUnitId`，所以不能把招聘组 creator 可见域等同于用人组织可见域。[源码：hiringUnit scope](../../apps/ai-recruitment-copilot-backend/src/server/routes/studio/utils/hiring-unit-scope.ts#L29) [源码：studioInterview schema](../../packages/db-schema/src/schema.ts#L399)

若重发入口保留在 `/platform`，它应继续由全局 `adminMiddleware` 保护，并明确这是跨 workspace 的运维权限，故意不套动态 workspace 权限或招聘组/hiringUnit 数据域。[源码：admin middleware](../../apps/ai-recruitment-copilot-backend/src/server/middlewares/admin.ts#L4) 若以后把按钮放进 Studio，则必须放在 `/api/w/:slug/...` 下，至少要求 `requirePermission("interview", "update")`，校验通知属于当前 workspace，并同时执行招聘可见域与 hiringUnit scope；不能照搬全局 Platform 路由的授权假设。

## “有则复用，无则创建”当前如何工作

`ensureInterviewEvaluationDocument()` 是自动通知与失败重试共用的唯一入口：

- 先按 `notificationId` 查询 `interview_notification.feishu_document_url`。
- URL 非空：立即返回，不调用飞书创建 API。
- URL 为空：从面试上下文生成评价表 block，按该通知的 provider 创建飞书 Docx、写入 block、把该 provider 下的接收人 Open ID 加为编辑协作者，再把 `documentId` 和 `documentUrl` 保存到通知记录。[源码：ensure](../../apps/ai-recruitment-copilot-backend/src/server/routes/agent/utils/feishu-interview-notifications.ts#L348)

底层飞书调用顺序是：

1. 使用对应 provider 的 `tenant_access_token` 创建新版文档。
2. 向文档根 block 及各 callout 父 block 分批追加内容。
3. 以接收人的 Open ID 增加 `edit` 协作者。
4. 返回 `documentId` 和 URL。[源码：feishu-docx.ts](../../apps/ai-recruitment-copilot-backend/src/server/routes/feishu/utils/feishu-docx.ts#L110)

飞书官方资料确认：新版文档是一棵 block 树；创建接口支持应用或用户 access token；增加协作者接口支持 `tenant_access_token`、`openid` 和 `edit` 权限角色，但要求应用与用户满足可见性且调用身份有添加协作者权限。[飞书：创建文档](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/create) [飞书：新版文档数据结构](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/docx-structure) [飞书：增加协作者权限](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create)

## 建议的技术方案

### 第一阶段：补齐目标仓库原生的手动重发

不新增另一套 Docx client。若产品确认需要 Platform Debugger，可新增目标仓库风格的 `platform/routes/notifications/{route,dao}.ts`、feature 组件和薄 route module，并在现有 admin middleware 下挂载。重发服务复用当前 ensure 与 `postFeishuDirectCard()`，至少完成以下校验与状态迁移：

1. 通知存在、类型为 `summary_ready`、conversation 非空、provider 是两个飞书 provider 之一。
2. 报告为 `ready` 且存在轮次；在任何创建文档或发卡动作前失败。
3. 将通知清错并置为 `pending`，即使原状态为 `sent` 也显式进入本次人工重发。
4. 调用 ensure；已有 URL 时复用，URL 为空时按记录 provider 创建并授权。
5. 使用 `postFeishuDirectCard(providerId, recipientOpenId, card, { headerTemplate })`，保持 `@arc/adapter-feishu` 的卡片转换和双 provider 隔离；成功写新 message ID/发送时间/`sent`，失败写 `failed`/error。

服务级测试至少覆盖：已有 URL 不创建 Docx、URL 为空只创建一次、非 ready/缺轮次/非飞书 provider 在副作用前失败、双 provider 不串凭据或 state、发送失败可诊断，以及 `sent` 人工重发仍复用文档。当前 Docx 单测已覆盖创建、写块、授权与限频重试。[源码：feishu-docx.test.ts](../../apps/ai-recruitment-copilot-backend/src/server/routes/feishu/__tests__/feishu-docx.test.ts#L8)

### 第二阶段：如业务要求“绝不重复”，增加强幂等

基础复用仍有两个竞态：

- 两个请求同时重发同一条 URL 为空的记录，可能都通过查询并各自创建文档。
- 飞书已创建文档，但写 block、授权或数据库更新失败；下次重试看不到已创建的 ID/URL，会留下孤儿文档并再建一份。

可在 ensure 外围按 notification ID 获取 PostgreSQL advisory transaction lock，锁内重读 URL。若还要覆盖远端部分成功，则在创建空文档后立即持久化 `documentId` 和分步状态，后续重试续写/授权同一文档，并避免对已写 block 重复追加。

## 风险与验证点

- **陈旧 URL**：当前只判断 URL 非空，不验证文档是否删除、应用权限是否撤销、接收人是否仍可编辑。不要因任意网络错误静默重建。
- **双 provider 隔离**：文档 token、卡片 adapter、Open ID 和数据库 provider 必须来自同一通知；不能用默认 provider 代替记录 provider。
- **授权边界**：Platform admin 是跨 workspace 运维角色；Studio 操作必须走动态权限、招聘可见域与 hiringUnit scope，且越权时不泄露候选人信息。
- **缺少轮次**：新飞书通知在 claim 前返回时没有记录供批量 retry 扫描，需要明确补偿策略。
- **报告更新**：URL 已存在时不会刷新文档内容。若报告重新生成，重发仍指向历史文档；“更新文档”应是单独的显式动作。
- **多 provider**：复用按 notification ID，而不是按面试；不同 provider/接收用户应分别验证文档归属和权限。
- **可观察性**：Debugger 若落地，应显示 provider、状态、错误、`feishu_document_url`、用人组织，并区分“复用文档”与“新建后发送”。

## 验收矩阵

| 场景                          | 当前行为 / 目标行为                                  |
| ----------------------------- | ---------------------------------------------------- |
| 自动通知、URL 为空            | 当前会创建、保存、授权并发送                         |
| `failed`/`pending` 且已有 URL | 当前重试会复用                                       |
| `sent` 后手动重发             | 当前不支持；补齐后应复用并刷新 message ID/时间       |
| 双飞书 provider               | 当前每条 provider 通知独立文档与卡片链路             |
| 报告未 ready / 缺少轮次       | 不创建、不发卡；手动入口应返回明确错误               |
| 创建、授权或发卡失败          | 状态为 `failed`，错误可供运维诊断                    |
| Studio 越权重发               | 补齐后必须被动态权限、招聘组与 hiringUnit 数据域拒绝 |
| 两个请求并发重发              | 若实施强幂等，只应存在一个 document ID               |
