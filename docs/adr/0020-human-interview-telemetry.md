# 0020 — 真人面试诊断事件与 Platform 时间线

日期：2026-10-08。状态：采纳。

## 目的与边界

真人面试断线排查需要关联页面操作、入会凭证签发、RTC 会话和网络质量。单凭 IP、浏览器 User-Agent 或 `CLIENT_REQUEST_LEAVE` 不能判定是谁操作，也不能判定主动点击离开。保留可查询的原始事件，让管理员按证据来源核对。

第一版覆盖真人面试候选人与面试官（包括外部面试官、旁听角色）的有效邀请页面。诊断 UI 仅位于 `/platform/interview-logs`，沿用平台 `user.role === 'admin'`；接口同样校验，工作区 owner、HR 不因此获得权限。候选人和业务工作区没有日志查看入口。此功能不改变 LiveKit identity、入会权限、同身份互斥策略，也不自动标记作弊。

无效/过期邀请、SSR 失败或 JavaScript 完全未运行时无法形成页面采集记录。AI 面试 Agent 的内部推理、音视频内容、聊天正文不在此次诊断采集范围。

## 数据链路

1. 有效邀请页面挂载时创建独立的 `visitId` 和 `tabId`，立即记录 `page_opened`；FingerprintJS 5 在浏览器本地异步运行，禁用 monitoring，仅保存 visitorId 和版本，不保存原始指纹组件。
2. `browserId` 是本域 localStorage 中的随机 UUID；它不是用户 ID。每次点击入会创建新的 `attemptId`，标签页复制不会复用页面 ID。
3. 入会/结束请求携带 visit/tab/attempt 和已采集的 browser/fingerprint trace 请求头。后端从已验证的邀请确定参与者 identity 与角色，记录 `token_issued`，把 trace 写进 LiveKit token metadata。邀请、JWT、密钥不进入结构化事件表。
4. 客户端记录连接、断线原因、重连、离开按钮、结束请求、页面显隐/离开/恢复、设备切换/错误、轨道发布/静音、运行异常、网络变化。30 秒心跳，连接期间 15 秒 RTC 质量采样。
5. 浏览器通过 `POST /api/public/interview-telemetry` 批量提交，以 Authorization Bearer 携带邀请。服务端重新解析邀请，禁止客户端指定身份/会议/角色/证据来源。
6. LiveKit POST `/api/livekit/webhook`，以 SDK 校验 Authorization JWT 与原始请求体 SHA-256，再写入 `livekit` 来源事件（包括服务端 disconnect reason、Room SID、Participant SID）。写入失败返回 503，重复事件去重。
7. 后端结束/取消/删除房间记录请求、成功或失败，保留动作与操作者账户 ID；公共邀请操作表示该邀请对应的身份，不证明使用链接的自然人。已删除会议的迟到服务端事件可从已保存快照恢复会议归属。
8. 管理员通过分页列表、会议时间线筛选来源、参与者、事件、访问 ID、入会 ID、IP、指纹。指纹筛选会关联该指纹对应页面访问的全部事件，不只返回 `fingerprint_ready`。

Platform 时间线默认显示关键事件。心跳、定时网络采样、成功的指纹采集、组件卸载、普通连接状态（connecting/connected/disconnected）和良好/未知的质量变化仍然入库，可切换到“全部事件”查询。信令重连、质量变差、未知的新状态，以及所有后端与 LiveKit 事件保留在关键视图中。筛选在数据库分页前执行；指定具体事件类型时可直接查该类原始事件。原始事件没有删除、合并或降采样。

“参与者与浏览器”按参与身份汇总整场会议，直接展示完整指纹、User-Agent 解析的浏览器/系统、IP、访问次数与入会尝试数，且不受时间线当前页或筛选影响。多个指纹、IP 和浏览器值不能按数组位置配对成物理设备；精确关联继续使用访问 ID。点击姓名、指纹或 IP 会替换时间线筛选条件。页面实例 ID 的展示明确提示刷新后变化。

会议列表展示整场去重的浏览器指纹数量，悬停或点击可按参与身份查看姓名、角色、完整指纹及各自数量。统计只采用客户端 `fingerprint_ready` 中的非空指纹，按当前页会议批量查询，不随搜索命中的事件范围缩小。同一候选人身份有超过一个不同指纹时显示“疑似浏览器环境变化”提醒；多人共享指纹、不同候选人各一个指纹或仅面试官有多个指纹均不触发候选人提醒。未采集显示未知，指纹数量不等于人数，提醒不能单独证明更换浏览器、设备或作弊。

## 存储、顺序与证据解释

表：`interview_telemetry_event`，新增迁移 `20261008120000_add_interview_telemetry`。采用追加写入，不提供修改/删除日志的业务 API。会议与身份快照不设级联删除外键，避免删会后丢失排查记录。

- `source`：`client`、`server`、`livekit`，UI 分别显示客户端上报、后端确认、LiveKit 确认。
- `occurred_at`：来源提供的发生时间；客户端时钟可能偏移。
- `received_at`：数据库接收时间。UI 先按接收时间，再按发生时间、页面事件序号、ID 排序。
- `client_sequence`：同一页面内递增，用于发现缺口及离线上报顺序。跨来源不保证全局严格顺序。
- `visit_id` / `tab_id` / `attempt_id`：客户端相关标识；`room_sid` / `participant_sid`：RTC 会话标识。Webhook 中 trace 来自签发时的客户端输入，即使 webhook 已签名，也不能据此证明物理设备或操作者。
- `(meeting_id, participant_identity, source, event_key)` 唯一约束处理重试；同一个 identity 的不同 Participant SID 仍为不同 RTC 会话。
- IP 从显式信任的代理请求头提取，默认不信任任何转发头。LiveKit webhook 的请求 IP 是服务器 IP，因此不把它记成参与者 IP。
- RTC 记录可获得的 RTT、jitter、累计丢包/收包、发送/接收字节与估算码率、连接质量、候选连接类型及协议。不同浏览器可用字段不同；`sampleAvailable=false`/缺失字段不代表网络良好。
- `navigator.onLine`、Network Information API 的 RTT/downlink 是浏览器估计；网络 change 事件及后续请求 IP 是网络变化线索，不能证明所有网络切换。

客户端事件可被伪造或缺失。IP 可能由多人共享，指纹可能变化或碰撞；它们只供调查关联。`CLIENT_REQUEST_LEAVE` 可能由按钮、组件卸载、刷新或 SDK 调用触发，应同时核对 `leave_clicked`、`page_exit`、`component_unmounted` 和后端操作。不能仅据 LiveKit 的离开原因断言用户主动退出。

## 可靠性与保留期

客户端每 3 秒尝试上报，每批最多 20 条且约 12 KB UTF-8；内存队列最多 200 条，失败保留原事件 ID 重试，丢弃数量进入 `droppedEvents`。页面离开时使用 keepalive，优先发送末尾事件，不等待可能被浏览器取消的普通请求；最多 4 个约 12 KB keepalive 批次同时在途。异常断电、杀进程、长期断网仍可能丢失最后事件；不使用持久化离线队列保存邀请凭证。

入口限制请求体 32 KiB，严格校验允许字段，每个邀请每个服务进程最多 120 批/分钟（并非分布式全局限流）。诊断失败不阻止入会/关闭会议；后端签发事件写入失败会输出不含事件正文的告警。LiveKit 回调保存失败返回 503；LiveKit 只做有限次重试，不能保证永不丢失，应检查回调投递结果。

Worker 启动时及每小时清理一次，默认保留 90 天；`INTERVIEW_TELEMETRY_RETENTION_DAYS` 允许 7–365，每次最多删除 10000 条旧记录。Worker 停止或过期数据积压时，清理会延后。表按会议时间、接收时间、访问、入会尝试、Participant SID、房间索引；客户端事件不直接写应用文件日志。

Hono 请求日志对真人面试邀请路径脱敏，并去除诊断查询的参数。反向代理/网关的访问日志需要独立配置，不能只依赖应用层脱敏。

## 正式环境启用顺序

下面是发布操作说明，代码合入或本地测试通过不表示已在正式环境启用。

1. 在目标库的发布流程中执行现有 `pnpm --filter @arc/ai-recruitment-copilot db:migrate`，使用运维提供的目标 `DATABASE_URL`。先迁移再发布 Web/Backend/Worker；迁移仅新增表与索引。
2. 发布含采集代码和 Platform 页面的 Web、相应 Backend 及 Worker。独立 Backend 和集成 Web 挂载复用同一 Hono router。
3. 在处理浏览器 API 请求的 Web/Backend 容器配置 `INTERVIEW_TELEMETRY_IP_HEADER=x-real-ip`。仅当入口代理**覆盖**该头且禁止绕过代理直连应用时启用：

   ```nginx
   proxy_set_header X-Real-IP $remote_addr;
   ```

   多级代理/CDN 须先正确配置 Nginx 的可信 real_ip 来源；不要直接信任浏览器提交的 X-Forwarded-For。未配置时 UI 会明确显示 IP 未采集。

4. 给 Worker 配置 `INTERVIEW_TELEMETRY_RETENTION_DAYS=90`（或约定的 7–365 天值），确认 Worker 正常运行。
5. 自托管 LiveKit 的 `webhook` 配置示例：

   ```yaml
   webhook:
     api_key: "<与接收端 LIVEKIT_API_KEY 对应的已有 key>"
     urls:
       - "https://recruitment.hirecopilot.bar/api/livekit/webhook"
   ```

   对应 secret 必须与接收端 `LIVEKIT_API_SECRET` 一致。保留已有 webhook 目标，按运维发布流程应用配置；确认 LiveKit 可访问 HTTPS 目标，网关透传 Authorization 和 `application/webhook+json` 原始正文。不要为诊断绕过签名校验。

6. 网关访问日志对 `/human-interview/(interviewer/)?<invite>`、`/api/public/human-interview-meetings/(interviewer/)?<invite>` 脱敏。可使用以下 `http` 层配置示例并沿用现有非敏感字段；日志中使用 `$interview_safe_path`，不要再输出含原始路径的 `$request`/`$request_uri` 或 referrer：

   ```nginx
   map $uri $interview_safe_path {
     ~^(/(?:human-interview|api/public/human-interview-meetings)/(?:interviewer/)?)[^/]+(.*)$ $1[REDACTED]$2;
     default $uri;
   }
   log_format interview_safe '$remote_addr [$time_local] "$request_method $interview_safe_path $server_protocol" $status $body_bytes_sent';
   # 在对应 server/location 中接入该格式；上线前 nginx -t 验证现有网关配置。
   ```

## 验收场景

| 场景                                 | 核对结果                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| 同一浏览器打开候选人链接和面试官链接 | 两个 identity，独立 visit/attempt；不会因为此功能互踢                                |
| 同一候选人链接在两个标签页入会       | 两个 visit/attempt/Participant SID；如 LiveKit 淘汰旧连接，关联 `DUPLICATE_IDENTITY` |
| 点击离开 / 刷新 / 关闭页面           | 分别观察按钮事件、页面事件、组件卸载与 LiveKit 离开，不能混为同一原因                |
| 断网、恢复、Wi-Fi/热点切换           | network change / reconnect 事件与前后 IP、RTT、质量采样；缺失项显示未知              |
| 结束会议 / 工作区取消轮次            | 后端动作及操作者、room delete 结果、LiveKit 离开/房间结束                            |
| 普通用户调用日志 API                 | 401/403；平台管理员 200 且 Cache-Control 为 no-store                                 |
| 重复客户端批次 / 重复签名 webhook    | 数据库只有一条对应事件                                                               |
| webhook 写库失败 / 请求体被修改      | 分别 503/401，不把未验证事件作为 LiveKit 证据                                        |

自动化验证覆盖上述核心数据边界和组件交互；真实浏览器与生产 LiveKit 的网络切换、实际 disconnect reason 和网关 IP 仍需发布后走一次真实会议验收。旧会议中未采集的事件、指纹和退出原因不会自动恢复。

## 直接 SQL 排查

`browser_id`、`fingerprint_id`、`fingerprint_version` 为独立字段，带中文注释；指纹索引用于直接查询。新客户端在采集成功后的事件中持续携带指纹，不依赖 `details`。指纹就绪后按同一会议、参与身份、visit 回填较早的空字段；迁移也按此范围回填旧 JSON 中的唯一证据。不同访问、不同参与者以及冲突指纹不相互推断。旧客户端的 JSON 继续接收并映射到独立字段。

使用参数化查询。按 UI 相同顺序读取整场：

```sql
SELECT received_at, occurred_at, source, type, participant_name, participant_identity,
       visit_id, tab_id, attempt_id, client_sequence, room_sid, participant_sid,
       browser_id, fingerprint_id, fingerprint_version, ip, ip_source, user_agent, details
FROM interview_telemetry_event
WHERE meeting_id = $1
ORDER BY received_at, occurred_at, client_sequence, id;
```

同一天发生重复 identity 的其他会议（使用业务时区边界）：

```sql
SELECT meeting_id, max(meeting_title) AS title, participant_identity,
       count(*) AS disconnects, min(occurred_at) AS first_at, max(occurred_at) AS last_at
FROM interview_telemetry_event
WHERE source = 'livekit' AND type = 'participant_left'
  AND details->>'reason' = 'DUPLICATE_IDENTITY'
  AND occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
GROUP BY meeting_id, participant_identity;
```

从浏览器指纹展开相关访问，包括不同参与身份：

```sql
WITH visits AS (
  SELECT DISTINCT meeting_id, participant_identity, visit_id
  FROM interview_telemetry_event
  WHERE source = 'client' AND type = 'fingerprint_ready' AND fingerprint_id = $1
)
SELECT e.* FROM interview_telemetry_event e
JOIN visits v USING (meeting_id, participant_identity, visit_id)
ORDER BY e.received_at, e.occurred_at, e.client_sequence, e.id;
```

参考：[LiveKit Webhooks & events](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events.md)、[Hono RPC](https://hono.dev/docs/guides/rpc)。
