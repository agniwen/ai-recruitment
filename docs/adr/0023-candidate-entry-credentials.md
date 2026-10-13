# 候选人真人面试入场凭据

状态：已实现，默认关闭；2026-10-12 改为平台管理员逐候选人开启。

## 行为

- 候选人详情的「真人面试」区域提供开关，存于 `studio_interview.entry_credential_enabled`，每位候选人默认关闭。仅平台管理员（账号 `user.role = admin`）可查看和调整；工作空间 owner/admin 或具备简历编辑权限的 HR 均不等同于平台管理员。前端不展示且不查询，后端 GET/PATCH 同样验证平台管理员身份，并保留工作空间权限与简历可见性校验。关闭时保留原入会流程；面试官不参与此流程。
- 开启后，候选人在麦克风检查后先验证已有凭据；失败后，已成功创建 0 个凭据时，弹窗主操作仅显示「创建凭证进入面试」；已有 1 个时，同时显示「重新验证」和创建按钮。少于两个时不展示创建数量提示；达到两个后只显示「重新验证」及上限提示。创建次数尚未获取时保留重新验证入口。系统通行密钥弹窗需用户操作，不无感创建；取消、超时或认证失败不会自动转为注册。
- 同一工作空间、候选人、会议及 RP ID 最多成功创建两个凭据，不限制凭据管理器类型。次数来自既有成功注册记录（`candidate_entry_credential_use.method = register` 按凭据去重），旧记录同样计入；取消、验证失败和使用已有凭据不计数，短期许可过期、刷新、清缓存或更新邀请链接不重置次数。达到上限后隐藏创建按钮，后台 options 和 verify 都拒绝新增；verify 在事务内锁定候选人记录并再次检查，防止并发超额。创建次数复用已有记录，不单独存储计数器。
- 验证失败可重试或联系 HR 协助，由平台管理员在真人面试面板填写原因后关闭验证，候选人点击「重新检查入会要求」继续。候选人不能自行跳过。
- 开关按候选人记录生效，覆盖当前及后续真人面试，直到平台管理员再次调整，不影响其他候选人。原因、操作人、时间保存在候选人字段，完整历史写入候选人活动日志，与变更在同一事务中提交。保存中显示加载状态、禁止重复提交和关闭弹窗，成功后更新开关。
- 管理后台的面试日志展示成功验证的凭据编号，以及同一工作空间内关联的候选人记录、会议、浏览器标识、指纹和来源 IP。多个候选人记录使用同一凭据仅提示复核，不做作弊结论。

## 验证与数据

使用 SimpleWebAuthn 服务端验签，要求用户验证（UV），使用可发现凭据。入场凭据使用随机用户句柄，与招聘账号或候选人身份解耦。候选人身份始终来自有效邀请链接。同一凭据可以在不同候选人邀请中验证，以形成关联证据，不能因此获得其他候选人的业务权限。

`candidate_entry_credential` 保存凭据关联编号、域名、原始凭据 ID、公钥、签名计数器和 BE/BS 属性。`aaguid` 从服务端验证通过的注册认证数据解析，便于后续归类凭据提供方或认证器型号；不信任客户端额外传入的同名标签。历史未采集为 NULL，全零表示未知。AAGUID 与凭据提供方不是一一对应关系，且当前 `attestation: none` 不提供可信厂商证明，不能作为设备唯一标识或强防作弊条件。

每次注册或验证成功，`candidate_entry_credential_use.webauthn_response` 在同一事务中保存完整 WebAuthn 响应 JSON。沿用 SimpleWebAuthn 的标准序列化：`id`、`rawId`、`type`、`authenticatorAttachment`、`clientExtensionResults` 及 `response`；注册包含浏览器实际提供的 `attestationObject`、`clientDataJSON`、`transports`、`publicKey`、`publicKeyAlgorithm`、`authenticatorData`，验证包含 `authenticatorData`、`clientDataJSON`、`signature`、`userHandle`。二进制及扩展里的二进制使用 Base64URL 编码；不裁掉附加 JSON 字段，不补造浏览器没有返回的字段。附加客户端字段只作为排查材料，不保证真实性；关键验签和 AAGUID 解析由服务器完成。

这些记录不包含私钥、PIN 或生物识别数据。历史未采集的完整响应为 NULL，不尝试还原；取消未返回凭据或服务端验证失败时不写成功记录、不增加创建次数，错误仍沿用原面试遥测。完整响应不加入现有后台展示接口，管理员可查询数据库。临时浏览器调试面板、sessionStorage 记录、文件下载和对原生 create/get 的拦截已移除。

`candidate_entry_challenge` 保存五分钟的一次性挑战。绑定邀请摘要、工作空间、候选人、会议、轮次和页面访问编号；匹配后原子删除再验签，验签失败也不能重放。生成新挑战时清理过期挑战。同一凭据的验签计数器通过数据库行锁串行更新，允许同步凭据使用零计数器。

`candidate_entry_credential_use` 保存验签成功的证据及三十分钟的入场许可摘要。原始许可仅返回当前页面内存，不存 localStorage，不写遥测。申请 LiveKit token 时重新读取该候选人的开关，严格匹配全部绑定字段和有效期。页面刷新后会重新验证；同一页面短期重新入会可以复用已验签许可。浏览器里缓存凭据 ID 不构成放行依据。许可到期不会中断已在进行的会议。

关联记录与短期许可分开理解：许可过期后，关联证据继续保留，不随候选人、会议删除级联清除。后台仅返回关联编号和证据，不返回公钥、原始凭据 ID、用户句柄或许可/邀请摘要。关联列表每个凭据最多最近 50 次，本场最多最近 20 个凭据，统计查询覆盖对应工作空间全部记录；界面提示截断。

凭据可以同步、共享或通过另一台设备完成验证，单机也能创建多个凭据。BE/BS 来自签名认证数据，但不能证明当前操作的物理设备。界面名称使用「入场凭据」，不叫机器码。浏览器标识、指纹为客户端上报；指纹尚未生成时留空，可通过访问编号查询后续面试日志。

## 配置与上线

按顺序执行数据库迁移 `20261010120000_candidate_entry_credentials`、`20261012120000_candidate_entry_opt_in`，再发布应用。后者将旧豁免字段改为候选人开关、移除工作空间总开关，并统一置为关闭；旧配置不自动转换为开启。旧的最近调整快照清空，历史活动日志及凭据、验证关联记录继续保留。迁移不自动为任何候选人注册凭据。

`20261013120000_entry_credential_responses` 增加可空的 `aaguid` 和 `webauthn_response` 字段及中文备注；发布本次代码前执行该迁移，不修改旧记录或创建次数。

服务端 `INTERVIEW_ENTRY_CREDENTIAL_ORIGIN` 应为候选人实际访问的唯一页面源（含本地端口），未设置则沿用 `NEXT_PUBLIC_BASE_URL`。例如生产页面为 `https://recruitment.example.com`，本地为 `http://localhost:3000`。不使用请求 Host 或代理头推导可信源。生产必须 HTTPS，仅本机 localhost / 127.0.0.1 允许 HTTP；origin 必须与浏览器一致。后端独立部署时仍配置前端页面源。RP ID 使用该源的主机名，变更域名后不能直接复用旧域名凭据。

SimpleWebAuthn 服务端运行于支持 WebCrypto 的现代 Node.js 环境；当前依赖要求 Node.js 20 及以上，项目开发和部署推荐 Node.js 22 及以上。来源 IP 沿用 `INTERVIEW_TELEMETRY_IP_HEADER` 可信代理配置；缺少可靠来源时记录为空，不猜测地址。

可在不修改配置的情况下保持功能关闭；由平台管理员关闭该候选人的开关均可处理系统凭据管理器不可用、用户取消、浏览器不兼容等情况。系统弹窗不能保证完全无网络依赖，也不能保证每个浏览器都能发现同一凭据。

## 验证

后端使用独立本地 PostgreSQL 和合成认证器运行真实 WebAuthn 注册与签名校验，覆盖绑定作用域、过期、重放、原点与域名、签名、用户句柄、签名计数器、重复注册和关联统计隔离。独立测试库通过 `ENTRY_CREDENTIAL_TEST_DATABASE_URL` 显式提供，库名须为 `entry_credentials_test_` 前缀，禁止对业务库运行破坏性测试。

前端使用组件测试验证显式创建、取消不自动注册、重试、管理员关闭后的重查、关闭开关时原有入会行为及麦克风异常放行路径。真实 macOS / Windows 通行密钥系统交互仍需在目标浏览器和凭据管理器上人工验收，自动化签名测试不等同于系统弹窗验收。

当前创建参数为 `authenticatorAttachment: "platform"`，创建和验证均携带 `hints: ["client-device"]`。这些参数不保证凭据不可同步，也不构成设备唯一标识。

## 排查查询

查看某场面试的新采集完整返回（`:meeting_id` 替换为实际会议 ID）：

```sql
SELECT u.created_at, u.candidate_name, u.method, u.credential_ref,
       c.aaguid, u.ip, u.fingerprint_id, u.webauthn_response
FROM candidate_entry_credential_use u
JOIN candidate_entry_credential c ON c.id = u.credential_ref
WHERE u.meeting_id = :meeting_id
ORDER BY u.created_at;
```

按工作空间统计已观测到的 AAGUID 及凭据数量（不等于设备数量或提供方数量；NULL 和全零须分别作为未采集、未知处理）：

```sql
SELECT c.rp_id, c.aaguid, count(DISTINCT c.id) AS credential_count
FROM candidate_entry_credential c
JOIN candidate_entry_credential_use u ON u.credential_ref = c.id
WHERE u.organization_id = :organization_id
GROUP BY c.rp_id, c.aaguid
ORDER BY credential_count DESC;
```
