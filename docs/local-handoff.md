# 同事本地启动与数据库交接

适用 macOS / Linux；Windows 请在 WSL2 中运行，并启用 Docker Desktop 的 WSL 集成。
所有命令都在仓库根目录执行。

目标是同事拥有一套独立的本地数据库、队列、文件存储、向量库和语音服务，Web、worker、语音 agent 在宿主机运行。
复用现有 `dev-prod.yaml` 和 `scripts/configure-dev-prod.mjs`，不改变应用架构。
大模型、OCR、语音识别和语音合成仍使用外部 API；“本地启动”不等于离线运行。

## 你需要交给同事的东西

1. **一致的项目代码**：包括 `dev-prod.yaml`、`scripts/configure-dev-prod.mjs`、`scripts/local-dev.mjs`、`scripts/local.sh`、`scripts/bootstrap-local.sh`、当前数据库对应的所有迁移，以及依赖锁文件。代码应通过同一个提交或完整工作副本交付。只拉取旧的远程分支可能缺少本机尚未提交的结构变更。
2. **数据库交接包**：在你的电脑执行 `node scripts/local-dev.mjs export`，将输出的整个目录通过私密渠道交给同事，建议放到他仓库的 `.devtools/handoff/incoming/`。
3. **开发用途的 API 凭据**：参考 `docs/local-providers.env.example`，单独提供同事获准使用的模型 Key；导出脚本不会复制你的模型 API Key、飞书/Google 应用凭据或整个 `.env`。
4. **可用登录方式**：数据库会保留原有账号、密码哈希、组织、成员权限和 MFA 设置。给同事已有账号的邮箱密码，或配置获准使用的 OAuth 应用。系统关闭了公开注册；空库初始化后不会自动创建管理员。启用 MFA 的管理员仍需原有验证器；不能用数据库包绕过验证。

如果收到的是一个 `.tar` 文件，先创建目录并解包，再把目录路径交给 setup：

```sh
mkdir -p .devtools/handoff/incoming
tar -xf /absolute/path/to/ai-recruitment-local.tar -C .devtools/handoff/incoming
```

交接包包括 `database.dump`、`data-keys.env`、`manifest.json`。数据库使用 PostgreSQL 自定义压缩格式导出，包含结构、业务数据、账号和 `drizzle` 迁移历史；清单记录来源代码提交、是否存在未提交文件和 SHA-256 校验和。
`data-keys.env` 只包含现有数据需要的认证、邮箱密码加密、管理员 MFA、IP 加密密钥与上下文。缺少对应密钥，数据库里已有的密文可能无法解密。
交接包包含真实业务数据、账号信息和敏感密钥，仅限获准的同事使用；存放在 Git 忽略的 `.devtools/` 中，不要提交仓库或发送到公开位置。

## 同事首次启动

即使没有 Node 和 Docker，也可以先在仓库根目录执行 Bash 入口：

```sh
# 自动检查并安装缺少的启动工具；不会初始化项目配置或导入数据库。
bash scripts/bootstrap-local.sh

# 如果只想检查现有工具，不安装、不打开软件：
bash scripts/bootstrap-local.sh --check
```

安装行为：

- **macOS**：缺少 Homebrew 时先安装 Homebrew；按需安装 Node 24、uv、Git、Make 和 Docker Desktop，再打开 Docker Desktop 等待就绪。首次安装可能需要管理员密码、Apple 命令行工具和 Docker Desktop 的界面确认；这些系统提示需要本人完成。如果等待超时，完成提示后重跑即可。
- **Ubuntu / Debian**：从 Docker 官方 apt 仓库安装 Docker Engine 和 Compose，启动服务；缺少 Node 24 时下载安装官方二进制并校验 SHA-256，uv 使用官方安装器。系统软件安装需要 sudo 权限。当前用户没有 Docker 权限时，会提示管理员配置权限、重新登录后重跑；脚本不会自动授予 Docker 用户组权限。
- **Windows**：先安装 WSL2/Ubuntu，并在 Windows 安装、启动 Docker Desktop。在 Docker 设置中启用当前发行版的 WSL Integration，再在 WSL 的项目目录运行本脚本。WSL 分支不会另装第二个 Docker 守护进程。可在 Windows 终端使用 `winget install --exact --id Docker.DockerDesktop` 安装 Docker Desktop；WSL 安装可用管理员终端执行 `wsl --install -d Ubuntu`，系统可能要求重启。
- 其他 Linux 发行版暂不自动安装，按其官方方式安装工具后执行 `--check`。

脚本会准备以下工具：

- Node.js **24 LTS**，pnpm **11.5.2**（以根目录 `packageManager` 为准）。
- Docker Desktop / Docker Engine，支持 `docker compose`。
- `uv`、Git、GNU Make。脚本通过 uv 使用 Python 3.12。
- 保证本机 `3000`、`8790`、`54324`、`16379`、`16333`、`19100`、`19101`、`17890`、`17891`、`17892` 端口可用；有可用局域网 IPv4。

Linux 的 Node、uv 和固定版本的 pnpm 可以安装在 Git 忽略的 `.devtools/bootstrap/` 下，不替换系统 Node、不修改个人 Shell 配置。因此后续统一使用 `bash scripts/local.sh`，它会加载正确的工具路径；该入口与原来的 `node scripts/local-dev.mjs` 使用同一份业务脚本。

准备代码和交接包后执行：

```sh
# 填写获准使用的模型凭据；不要把填写后的文件提交 Git。
cp docs/local-providers.env.example .env.local-providers
# 用编辑器填写 .env.local-providers

# 一次性完成依赖安装、环境配置、空库恢复、迁移、模型文件下载及基础设施启动。
bash scripts/local.sh setup .devtools/handoff/incoming

# 启动 Web、简历 worker、Python 语音 agent。
bash scripts/local.sh up
```

浏览器访问 **http://localhost:3000**。集成 Web 已挂载 Hono API，不需要额外启动 standalone backend。
首次下载 JavaScript/Python 依赖、Docker 镜像和语音模型需要联网，时间取决于网络。

脚本自动选择一个非回环 IPv4；多网卡、VPN、Linux/WSL 下建议显式指定同事自己电脑可达的局域网地址：

```sh
DEV_PROD_HOST_IP=192.168.1.10 bash scripts/local.sh setup .devtools/handoff/incoming
```

`setup` 只用于新电脑。它会拒绝覆盖已有应用 `.env`、`.env.local`、本地凭据文件或已有 PostgreSQL 数据卷。
为保持现有环境，脚本不会自动删除旧卷或清空数据库。初始化中断后，保留报错信息，由 AI 按失败步骤继续，不能通过删除已有配置和数据反复尝试。

如果暂时没有数据包，可运行 `bash scripts/local.sh setup` 创建空库并迁移；这不会创建登录账号。
后续 `import` 仅接受**没有任何业务表或序列的空数据库**；已经跑过迁移的库不再符合条件，因此需要同步现有数据时，应首次 setup 就传入交接包。

`.env.local-providers` 仅在 setup 时读取，会分发到 Web、worker、agent 的 `.env`；后续改 Key 要同步修改对应应用 `.env` 并重启。
没有提供真实 OAuth 配置时，脚本使用明确的本地禁用占位值满足当前应用的必填项校验，OAuth 登录不可用；已有的邮箱密码登录可以使用。
没有提供模型 Key 时可启动业务页面，但 AI 功能需要配置对应 Key 才能验证。

## 平时启动、检查和停止

```sh
bash scripts/local.sh up
bash scripts/local.sh status

# 在另一个终端检查 Web 和 worker。
curl --fail http://localhost:3000/api/ready
curl --fail http://127.0.0.1:8790/readyz
curl --fail http://127.0.0.1:16333/readyz
```

在启动终端按 Ctrl-C 停止三个应用，再执行 `make dev-prod-down` 停止基础设施。普通停止保留数据卷；不要加 `-v`。
局域网 IP 变化后，按 [本地完整依赖环境](./dev-prod.md) 重新生成 RTC 配置并重启相关服务。

## 数据同步范围和后续更新

| 内容                                | 本次交接包 | 同事获得的效果                                                 |
| ----------------------------------- | ---------- | -------------------------------------------------------------- |
| PostgreSQL 结构与数据、迁移历史     | 包含       | 岗位、简历解析结果、候选人、面试、组织权限、账号等与导出时一致 |
| 与现有密文对应的应用密钥            | 包含       | 保留原有密文解密能力；不把它们当成新的独立生产密钥             |
| MinIO 简历原文件、附件、录像        | 不包含     | 历史记录可以存在，但缺少本地对象时无法预览或下载原文件         |
| Qdrant 向量索引                     | 不包含     | 本地是新的向量库；历史语义检索/推荐需另外重建或同步索引        |
| Redis 队列与缓存                    | 不包含     | 使用同事自己的新队列，避免复制当前机器的队列状态               |
| 模型、OAuth、飞书、邮件等第三方凭据 | 不包含     | 获准后单独配置；默认关闭自动收邮件、真人面试提醒和历史批量解析 |

这是一次数据库快照，不是持续双向同步。同事本地修改不会回写你的数据库。
导出过程中 PostgreSQL 自行保证数据库快照一致性，不需要停止你当前服务。文件与向量没有参与该快照。
如果需要历史原文件也可用，需要另外交接对应对象存储的文件；原本就不在你本地 MinIO 的云端文件，不能从数据库中还原。
历史向量索引未复制时，不应把“页面能打开”当作语义检索验证通过；重建索引可参考根目录现有的 semantic-index backfill 命令，并先确认模型 Key、费用和范围。
worker 启动时仍会从数据库恢复普通未完成的解析/评价任务；关闭历史批量开关不等于关闭这些恢复，缺文件的旧任务可能失败，也可能发生模型调用。

需要再次导出时，在你的电脑重新执行：

```sh
node scripts/local-dev.mjs export
```

在同事的**空库**上单独恢复：

```sh
# 先停止 Web、worker、agent；数据库服务保持启动。
bash scripts/local.sh import /absolute/path/to/new-bundle
bash scripts/local.sh migrate
bash scripts/local.sh up
```

导入会检查校验和、拒绝远程库/非目标端口/非空库，在单个事务内恢复数据库，不执行 `DROP` 或 `--clean`。
恢复成功后同步 Web 和 worker 的数据密钥，并将导入前的环境文件备份至 `.devtools/handoff/import-backups/`；初始化配置备份另存于 `.devtools/dev-prod/backups/`。
如果同事已有自己的开发数据，需要先另行备份并决定如何保留，然后人工准备新的独立空环境；本脚本不合并两个库，也不提供一键覆盖。

## 可直接交给 AI 的启动指令

把下面文字粘贴给同事的 AI 编程助手，并把交接包实际路径填进去：

> 请帮我在当前仓库完成 AI Recruitment 的本地启动。先阅读 AGENTS.md、docs/local-handoff.md 和 docs/dev-prod.md，执行 `bash scripts/bootstrap-local.sh` 准备缺少的 Node 24、pnpm、Docker Compose、uv、make 和 Git，并检查端口。遇到管理员密码、Docker Desktop 首次授权或 WSL 启用提示时，让我完成系统操作后继续。
> 数据库交接包位于 `<填写交接包绝对路径>`；先校验 manifest.json，再检查当前代码是否包含对应数据库的所有迁移。若来源工作区存在未提交变更，不要只凭提交号认为代码一致。
> 我获准使用的模型凭据写在仓库根目录 .env.local-providers；不要把任何 Key、数据库密码、导出内容或账号个人信息打印到聊天中。
> 新电脑用 `bash scripts/local.sh setup <交接包路径>`，然后 `bash scripts/local.sh up`；如果发现已有配置、数据卷或数据库，先检查并保留它们，不要清库、删除数据卷或覆盖配置来绕过检查。初始化中断时按失败步骤恢复。
> 选择这台电脑正确的局域网 IPv4。确认 Web、worker 健康检查通过，并确认语音 agent 成功连接本地 LiveKit。再用获准使用的账号登录，确认岗位/简历等数据可见；使用新的测试简历和一次实际语音面试分别验证模型、文件存储和语音链路。没有真实模型 Key 或没有实际测试时，要明确标记未验证。
> 历史文件、录像、向量索引不在数据库包里，不要误报它们已同步。不要运行生产构建、修改业务代码或连接生产数据库来完成本地初始化。
