# 0022 真人面试音视频间歇留底

状态：本地实现，生产启用需部署迁移及采样 Worker。

## 约定

- 候选人和面试官按参与者分别留底，只采集会议中已发布的麦克风与摄像头轨道。
- 入会后首次采样；音频每 120 秒采样最多 15 秒，摄像头每 30 秒取一张，JPEG 长边最多 960 像素。音频为 16 kHz 单声道 PCM WAV，每份最多约 480 KB。
- 摄像头关闭、没有麦克风轨道、静音、订阅超时、无媒体数据和采集/上传失败分别记录；不绕过设备权限，也不自动开启设备。屏幕共享不在本次采样范围内。
- 采样是间歇证据，无法完整覆盖会议；不实现人脸/声纹识别、自动匹配或作弊结论。变声等客户端处理会体现在发布后的音轨里。
- 入会页展示采样、长期保留及管理员访问说明。

## 链路

签名 LiveKit webhook 在房间开始、参与者加入及发布轨道时创建 `interview_media_room` 档案并通过 PostgreSQL NOTIFY 唤醒 Worker。Worker 读取 LiveKit 的当前房间及参与者，建立订阅专用的隐藏 recorder 身份 `arc_interview_media_recorder`。每分钟仅恢复可能漏掉的通知和中断记录，不扫描全部招聘数据。房间人数计数可能滞后，是否需要采样以 `listParticipants` 为准。

Worker 使用 `@livekit/rtc-node` 的原始媒体流，音频同时限制墙钟时间及样本数，采样窗口之外不缓存媒体。截图读取一帧后立即释放流；轨道只在采样窗口内订阅。每个 Worker 同时最多订阅 10 个房间，超过时保持 waiting，可增加 Worker 实例分担；生产容量需按真实并发压测。每个房间的数据库租约有效 30 秒、每 10 秒续租；断开、结束、失去租约或进程退出时关闭流和连接。唯一采样槽约束防止多 Worker 重复写入。

采样器身份不计入面试日志中的业务参与者，也不写入业务人员入离会状态。

## 存储与关联

- `interview_media_room`：会议 ID/标题、工作区、LiveKit room SID、运行状态、心跳、租约和错误码。
- `interview_media_asset`：每份图片/音频的参与身份、participant SID、track SID、采样时间/时长、状态、大小、SHA-256、私有存储 key，以及设备环境快照。
- `interview_media_access`：管理员查看、删除的 actor ID 及时间。
- 文件使用私有 `RECORDING_R2_*` 存储的 `human-interview-samples/` 前缀，PostgreSQL 不存二进制。管理员通过鉴权的内容接口读取，浏览器关闭预览后释放 Blob URL；不发公开 URL。
- 开发可显式指定绝对路径 `INTERVIEW_MEDIA_LOCAL_DIR`；Web/后端与采样器须指向同一目录，生产禁止使用本地目录。
- 先落库登记文件 key，再上传，再改成 ready。超过两分钟仍 pending 的记录标记中断，可由管理员清理，即使上传后进程中断也能追踪文件。
- 环境快照使用同一 meeting + participant + attempt（或 participant SID）的后端请求证据，以及同一 visit 的指纹事件。不得用同 IP 推定是同一设备/同一人。客户端标识均属于关联线索，无法读取硬件序列号、MAC 或 IMEI。IP 只来自已配置并由可信代理覆盖的 `INTERVIEW_TELEMETRY_IP_HEADER`；未知就保留未知。

## 长期保留与管理

用户选择长期保留，由平台管理员手动清理。三张留底表不受普通日志保留策略影响，不级联关联到会议或普通事件。会议删除/普通日志到期后，Platform → 面试日志 → 长期留底档案仍可查询。

列表、详情、媒体读取、清理接口均检查 `user.role === 'admin'`，工作区管理员身份不足以访问。清理文件成功后保留 tombstone 与删除审计；存储删除失败则不标记完成，可以重试。正在采集的文件不能清理。R2 桶必须私有，且该前缀不能配置自动过期或历史版本永久保留策略；管理员清理语义依赖底层对象删除行为。

## 启用及验证

1. 应用 `20261009200000_interview_media` 迁移。
2. Web/后端与 Worker 配置一致的 LiveKit、数据库、私有录音桶，并在 Worker 设置 `HUMAN_INTERVIEW_MEDIA_ENABLED=true`（默认关闭）。检查 webhook 正常送达、RTC 端口可达。
3. 本地使用 Web 的 `.env`，配置本地数据库/LiveKit及 `INTERVIEW_MEDIA_LOCAL_DIR`，运行 `pnpm --filter @arc/ai-recruitment-copilot-worker dev:interview-media`。此入口校验本机地址，仅启动采样器，不启动 TG 或简历处理。
4. 验证两种参与身份的图片、音频、环境信息，以及静音/关闭摄像头、重连、结束会议、管理员清理。生产桶、Linux 原生依赖和实际网络容量仍需部署环境验收。

定向自动化覆盖 WAV 格式与采样时间上限、停止时释放、平台管理员边界、精确连接关联、租约/采样去重、档案独立保留、清理失败重试及审计。另使用本地 LiveKit 与两路合成媒体做实际采集测试，不使用真实候选人的音视频。
