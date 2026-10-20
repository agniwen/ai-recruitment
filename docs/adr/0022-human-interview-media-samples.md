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
- `interview_media_asset`：每份图片/音频的参与身份、participant SID、track SID、采样时间/时长、状态、大小、SHA-256、加密的私有存储 key，以及设备环境快照。
- `interview_media_access`：管理员查看、删除的 actor ID 及时间。
- 文件使用私有 `RECORDING_R2_*` 存储的 `human-interview-samples/` 前缀，PostgreSQL 不存二进制。管理员通过鉴权的内容接口读取，浏览器关闭预览后释放 Blob URL；不发公开 URL。
- 开发可显式指定绝对路径 `INTERVIEW_MEDIA_LOCAL_DIR`；Web/后端与采样器须指向同一目录，生产禁止使用本地目录。
- 先落库登记文件 key 密文，再上传，再改成 ready。新文件名使用独立随机 ID，不能从列表里的档案 ID 推导存储 key。Worker 只在本次采集的内存中持有上传 key，使用公钥写入密文，无需私钥。超过两分钟仍 pending 的记录标记中断，可由管理员清理，即使上传后进程中断也能追踪文件。
- 2026-10-19 起，存储 key 使用 JWE `RSA-OAEP-256` + `A256GCM`，复用现有 `IP_ENCRYPTION_*` 密钥与环境命名空间，但使用独立的 `media-location:v1:` 格式和 `arc-media-location-v1` 类型；密文绑定工作区、会议、档案 ID、存储后端及字段用途。普通列表不解密、不返回定位信息；点击查看截图、播放录音或清理文件时，服务端在平台管理员及有效两步验证授权下解密。内容仍由后端返回二进制，不向浏览器返回真实存储地址。文件字节和历史对象位置保持不变；本期仅覆盖真人面试留底截图、采样录音，不改完整面试录像。
- 环境快照使用同一 meeting + participant + attempt（或 participant SID）的后端请求证据，以及同一 visit 的指纹事件。不得用同 IP 推定是同一设备/同一人。客户端标识均属于关联线索，无法读取硬件序列号、MAC 或 IMEI。2026-10-16 起，IP 默认优先读取有效的 `X-Real-IP`，缺失或无效时取 `X-Forwarded-For` 第一个地址，不再依赖请求头名称配置；生产代理须覆盖这两个头并限制后端直连，未知就保留未知。

## 长期保留与管理

用户选择长期保留，由平台管理员手动清理。三张留底表不受普通日志保留策略影响，不级联关联到会议或普通事件。会议删除/普通日志到期后，Platform → 面试日志 → 长期留底档案仍可查询。

列表、详情、媒体读取、清理接口均检查 `user.role === 'admin'`，工作区管理员身份不足以访问。清理文件成功后保留 tombstone 与删除审计；存储删除失败则不标记完成，可以重试。正在采集的文件不能清理。R2 桶必须私有，且该前缀不能配置自动过期或历史版本永久保留策略；管理员清理语义依赖底层对象删除行为。

## 启用及验证

1. 应用 `20261009200000_interview_media` 迁移。
2. Web/后端与 Worker 配置一致的 LiveKit、数据库、私有录音桶，并在 Worker 设置 `HUMAN_INTERVIEW_MEDIA_ENABLED=true`（默认关闭）。检查 webhook 正常送达、RTC 端口可达。
3. 本地使用 Web 的 `.env`，配置本地数据库/LiveKit及 `INTERVIEW_MEDIA_LOCAL_DIR`，运行 `pnpm --filter @arc/ai-recruitment-copilot-worker dev:interview-media`。此入口校验本机地址，仅启动采样器，不启动 TG 或简历处理。
4. 验证两种参与身份的图片、音频、环境信息，以及静音/关闭摄像头、重连、结束会议、管理员清理。生产桶、Linux 原生依赖和实际网络容量仍需部署环境验收。

### 已有存储地址加密

不增加数据库表或列。发布前备份数据库及现有密钥，并安排停止旧版 Web/Worker 写入的维护窗口；旧版不能直接读取新的存储 key 密文。使用已有环境原有的密钥，不能重新生成覆盖。

```sh
# 默认只统计，不输出地址、密文或密钥。
pnpm --filter @arc/ai-recruitment-copilot-backend security:backfill-media-locations
# 验证引用完整后分批加密；按旧值条件更新，可以重复运行。
pnpm --filter @arc/ai-recruitment-copilot-backend security:backfill-media-locations --apply
# 使用读取端的私钥校验全部已有密文，再启动新版并实际点击查看/播放验收。
pnpm --filter @arc/ai-recruitment-copilot-backend security:backfill-media-locations --verify
```

有孤立档案或无效 key 时，脚本在首次写入前停止。读取端拒绝未迁移的明文，不降级绕过加密。使用项目的 dotenv 加载方式；不要直接把带引号的 Compose `.env` 传给 `docker run --env-file`。新加密逻辑会拒绝含字面引号的配置，避免迁移端与正式应用解析出的环境标识/密钥版本不一致。回滚须保留兼容密文的代码和原密钥；不能恢复旧代码并重新写明文。

定向自动化覆盖 WAV 格式与采样时间上限、停止时释放、平台管理员边界、精确连接关联、租约/采样去重、档案独立保留、清理失败重试及审计。另使用本地 LiveKit 与两路合成媒体做实际采集测试，不使用真实候选人的音视频。
