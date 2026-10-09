# ADR 0021：真人面试会议级 Telegram 延迟提醒

日期：2026-10-09

## 业务规则

以 `meetingId` 为调度主体，预约时间前十分钟通过现有 Telegram 机器人私聊提醒：候选人录入人、岗位简历联系人、实际面试官（含外部面试官），以及候选人当前分配的 ODC。兼容 ODC 多分配表和旧单分配字段，不广播给整个部门。内部收件人必须仍是工作区成员；岗位联系人沿用唯一匹配规则。

同一会议可关联多个候选人轮次。执行时按 Telegram chat ID 合并消息，每位收件人只看到其关联候选人的信息，合并通知角色。`roundId` 保留作候选人和评价的关联，不再决定提醒任务的生命周期。未关联会议的独立轮次不触发本功能；删除会议后不能从遗留轮次继续提醒。

消息展示候选人、岗位、招聘主体、轮次和明确的北京时间。面试官获得以自己身份签名的会议入口；招聘人员和 ODC 获得相关候选人详情入口。兼任面试官时合并其本人入口，不发送候选人的入会凭证。未绑定 TG 的成员记录为 `unbound`，窗口内绑定后随重试补发。

未排期、取消、结束、失效或已到开始时间的会议不发送。已完成/取消的轮次，以及已离开真人面试阶段或不在招聘流程中的候选人不进入通知。提前入会导致 `scheduled → in_progress` 时仍会提醒其他人，不增加排期版本。

## 调度和事务一致性

复用 Redis/BullMQ 基础设施，使用独立的 `human-interview-reminders` 队列。现有 Worker 进程消费，默认并行处理四个会议，每个会议最多同时处理四位收件人，不排在简历解析队列后面。消息发送入口通过 Redis 共享限流：本提醒功能每秒最多二十次发送、同一 chat 每秒最多一次。其他 TG 功能独立发送，Telegram 自身限流或网络错误仍由失败重试处理。

数据库触发器 `human_interview_reminder_schedule_changed` 在会议创建、预约时间变化、取消、结束、删除的同一个事务内更新 `studio_human_interview_reminder_schedule`。这是每场会议一条、带版本的 Outbox 记录，随会议变更递增 `revision`，并标记 `next_sync_at`。同一时间改走又改回来仍然得到新版本。标题、备注、提前入会不重置已发送提醒。

触发器同时调用 `pg_notify`，通知在事务提交后才发布。Worker 通过 PostgreSQL LISTEN 收到通知后立即同步 Outbox，创建执行时间为 `scheduledAt - 10 分钟` 的延迟任务。只依赖提交后的持久化记录，不在保存会议的请求中等待 Redis。任务 payload 只有会议 ID 和版本，job ID 由两者确定，重复入队自动去重。

改期时移除尚未执行的旧任务，建立新版本；取消、删除时清理任务。已开始执行的旧任务无法强制撤回，发送前会重新读取会议版本、状态和最新收件人，过期任务跳过。发送过程中数据库变更与 Telegram 请求没有分布式事务，已经提交给 TG 的请求无法撤销。

Worker 启动、LISTEN 重连以及每六十秒的补偿检查只读取 `next_sync_at` 索引下的到期 Outbox 记录（每批最多一百条），不再定期关联扫描面试业务表。已入队的远期会议不会每分钟被检查；在提醒应执行后检查尚未完成的任务，修复 Redis 任务丢失、入队失败或漏收 NOTIFY。补偿完成通过版本条件更新，旧的同步结果不能覆盖新改期。临时排期进入十分钟窗口立即入队，开始时间已过则停止补发。

正常送达由队列驱动，不再有三十秒轮询等待；实际延迟仍取决于 Worker 负载、网络和 TG 限流。补偿不是严格实时，故障恢复会产生额外延迟。

## 发送记录、重试和删除

新表 `studio_human_interview_meeting_reminder_delivery` 按会议 ID、排期版本、收件人唯一，保存关联轮次快照、角色、chat ID、状态、尝试次数和错误代码。数据库原子领取防止多 Worker 重复发送已记录成功的提醒。每位收件人最多三次发送尝试，失败至少隔一分钟重试；发送中断的领取两分钟后可恢复，旧尝试不能覆盖新尝试的结果。队列每分钟重试未完成或未绑定的收件人，最多二十次任务尝试，且执行时始终检查面试是否已经开始。

任务表和新发送记录不对会议/轮次建立级联删除外键，删会后仍可排查。旧的 `studio_human_interview_reminder_delivery` 表保留历史数据，不再写入新提醒。迁移会引入已关联未来会议的旧成功记录，避免升级后再次提醒同一收件人。

Telegram 和 PostgreSQL 不能共享事务：如果 TG 已接受消息而响应或成功落库丢失，恢复重试可能重复。这是至少一次投递的边界，不宣称端到端 exactly-once。

## 配置和上线

先执行 `20261009160000_meeting_reminder_queue`（依赖旧提醒迁移），再发布 Worker；切换时先停止旧轮询 Worker，避免两套发送器重叠。新迁移一次性为已有未来会议建立任务记录，无需长期扫描旧业务数据。

Worker 需要 `DATABASE_URL`、`REDIS_URL`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET_TOKEN`，以及与 Web/Backend 一致的 `NEXT_PUBLIC_BASE_URL`、`BETTER_AUTH_SECRET`。现有队列前缀按数据库隔离；如设置 `RESUME_PARSE_QUEUE_PREFIX`，同一环境的 Worker 必须一致。配置 TG 时默认启用，`HUMAN_INTERVIEW_REMINDERS_ENABLED=false` 可关闭；缺少 Redis 会明确报错并保留待同步记录。

该方案使用数据库触发器，必须运行 SQL 迁移，仅通过 schema push 创建表不完整。LISTEN 需要直连 PostgreSQL 或支持会话模式的连接；NOTIFY 不可用时由 Outbox 检查补偿。Redis 应启用持久化；数据库 Outbox 额外覆盖任务丢失恢复。退出时停止监听与同步，等待队列处理中任务结束，再关闭队列、TG 和数据库连接。

本地验证使用临时 PostgreSQL 数据库、独立 Redis 和模拟 TG；包括真实的提交通知 → Outbox → BullMQ 到期 → 模拟发送链路，不会给实际招聘人员发送测试消息。真实 TG 送达及生产部署单独验收。

## 查询

```sql
SELECT meeting_id, revision, scheduled_at, active, queued_revision,
       next_sync_at, error_code, updated_at
FROM studio_human_interview_reminder_schedule
WHERE meeting_id = $1;

SELECT meeting_id, revision, scheduled_at, recipient_key, round_ids,
       roles, status, attempts, last_attempt_at, sent_at, error_code
FROM studio_human_interview_meeting_reminder_delivery
WHERE meeting_id = $1
ORDER BY revision, recipient_key;
```
