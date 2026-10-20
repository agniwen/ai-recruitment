# AI Recruitment 本地部署说明

**接收方只需要把 ZIP 解压，在 AI 编程助手中打开解压出来的 `ai-recruitment-local` 文件夹，然后说：**

> 请阅读根目录《AI部署说明.md》，按文档在我的电脑上完成本地部署、恢复随包数据库并启动系统。请直接执行可完成的步骤，只有管理员密码、系统界面授权、账号或 API 凭据需要我本人处理时再告诉我。

本文同时是给 AI 编程助手的执行指令。默认目标是接收方自己的电脑，不操作发送方机器或线上服务。

## 一、包里有什么

- 当前项目源代码、静态资源、数据库迁移及 pnpm/uv 依赖锁文件。
- `scripts/bootstrap-local.sh`：安装或检查缺少的 Docker、Node、pnpm、uv、Git、Make。
- `scripts/local.sh`：初始化、启动、状态检查、数据导入导出及迁移入口。
- `handoff/database/`：发送方本地 PostgreSQL 的快照、相应数据密钥和校验清单。
- `handoff/package-manifest.json`、`handoff/SHA256SUMS.txt`：代码来源、打包信息和文件完整性清单。
- `docs/local-providers.env.example`：模型与可选登录凭据模板，不含发送方的 API Key。

包中没有 `.git`，**不需要先克隆 Git 仓库或执行 git init**；可直接从这份完整代码运行。
依赖中的 lefthook 是开发提交钩子工具，安装时可能提示 `not a git repository`；若 pnpm 最终退出码为 0，继续部署即可，不要为此创建 Git 仓库或修改业务代码。
没有预装 `node_modules`、Python 虚拟环境、Docker 镜像和语音模型，首次部署需要联网下载。
模型、OCR、STT、TTS 仍使用外部 API，本地部署不等于离线推理。

数据库包含真实业务记录、账号、权限及现有密文需要的密钥。该 ZIP 仅供获准的同事使用，不能公开发布，也不要把数据库内容和密钥粘贴到聊天里。

## 二、给 AI 的执行要求

1. 先阅读本文件及根目录 `AGENTS.md`；需要排错时再参考 `docs/local-handoff.md`、`docs/dev-prod.md`。
2. 所有项目命令以本文件所在文件夹为工作目录。不要使用发送方电脑的绝对路径。
3. 先检查系统类型和现有工具、环境文件、Docker 数据卷及端口。保留接收方已有数据；不要通过删除数据卷、清库、覆盖现有 `.env` 来绕过初始化检查。
4. 只在本机完成部署，不连接生产数据库、不配置正式 TG 机器人、不修改任何线上 Webhook。包内没有发送方的模型、OAuth、TG、邮件或云存储凭据。
5. 读取密钥用于本机配置时，不要把值打印到聊天、命令日志或报告中。检查环境时仅展示地址、是否配置和错误类别。
6. 采用下文规定的脚本和顺序执行。不运行生产构建，不改业务代码来绕过错误，也不执行 `drizzle-kit push` 代替迁移。
7. 遇到可以独立处理的依赖下载、配置、数据库恢复、服务启动问题，继续排查和修复。遇到管理员密码、Docker/WSL 界面授权或必需凭据缺失，明确指出需要本人完成的具体一步，完成后继续。

## 三、先准备运行工具

### macOS

在项目根目录执行：

```sh
bash scripts/bootstrap-local.sh
```

脚本会按需安装 Homebrew、Node 24、固定版本的 pnpm、uv、Git、Make、Docker Desktop，并打开 Docker Desktop 等待就绪。系统可能要求管理员密码、Apple 命令行工具安装及 Docker Desktop 首次授权，请让本人完成界面操作。
如果等待超时，在 Docker Desktop 初始化完成后重跑相同命令；不要把超时当作已部署成功。

### Ubuntu / Debian

同样运行 `bash scripts/bootstrap-local.sh`。脚本从官方来源安装工具，系统包安装需要 sudo 权限。
Docker 安装后若当前用户无访问权限，需要管理员按 Docker 官方的安装后说明配置权限，并重新登录后继续。不要用 sudo 启动整个项目。

### Windows

项目在 **WSL2 的 Ubuntu** 中运行；Docker Desktop 在 Windows 上安装并运行。

1. 在 Windows 终端检查 WSL2 和 Ubuntu。没有安装时，用管理员终端执行 `wsl --install -d Ubuntu`，按系统提示重启并完成 Ubuntu 用户初始化。
2. 没有 Docker Desktop 时，在 Windows 终端执行 `winget install --exact --id Docker.DockerDesktop`，完成安装并打开软件。
3. 在 Docker Desktop 的 `Settings > Resources > WSL Integration` 中启用当前 Ubuntu 发行版。
4. 将解压后的完整项目放在 WSL 文件系统下，例如 `~/projects/ai-recruitment-local`；让 AI 的终端在 WSL 中执行后续命令。不要在普通 PowerShell 中直接运行 Bash 脚本。
5. 在项目目录执行 `bash scripts/bootstrap-local.sh`。WSL 分支复用 Docker Desktop，不再安装第二个 Docker 守护进程。

如已安装完整工具，可只检查：

```sh
bash scripts/bootstrap-local.sh --check
```

工具安装在项目私有目录时，普通终端未必直接找得到 Node/pnpm。因此统一使用 `bash scripts/local.sh` 运行后续步骤。

## 四、准备凭据与确认数据包

确认以下文件存在：

```text
handoff/database/database.dump
handoff/database/data-keys.env
handoff/database/manifest.json
```

包清单 `handoff/package-manifest.json` 记录了打包时间、源代码提交和数据库快照时间。先校验 `handoff/SHA256SUMS.txt`：Linux/WSL 使用 `sha256sum -c handoff/SHA256SUMS.txt`，macOS 使用 `shasum -a 256 -c handoff/SHA256SUMS.txt`。不要继续使用校验失败的数据包。
初始化脚本会再次核对数据库和数据密钥文件的 SHA-256。

若根目录还没有 `.env.local-providers`，从模板复制：

```sh
cp docs/local-providers.env.example .env.local-providers
```

由接收方填写其获准使用的模型 API Key。该文件只在首次 setup 时读取；不要覆盖接收方已经填写的内容。

| 能力                 | 需要的凭据                                                            |
| -------------------- | --------------------------------------------------------------------- |
| 简历结构化处理、对话 | `ALIBABA_API_KEY`；按账号权限确认模型与地域                           |
| 简历 OCR             | `QWEN_OCR_API_KEY`；为空时使用阿里云主 Key，需支持相应 OCR 计费和端点 |
| 语音面试对话         | `DASHSCOPE_API_KEY`；为空时沿用 `ALIBABA_API_KEY`                     |
| 语音识别             | `ELEVEN_API_KEY`                                                      |
| 语音合成             | `MINIMAX_API_KEY`                                                     |
| 面试报告             | `AI_GATEWAY_API_KEY`                                                  |

没有 Key 时仍可完成本地基础服务、数据库恢复及业务页面启动，最终报告必须写明 AI 能力未验证，不要把缺少模型 Key 误报成数据库或部署失败。

## 五、初始化并启动

先确认端口未被其他服务占用：`3000`、`8790`、`54324`、`16379`、`16333`、`19100`、`19101`、`17890`、TCP `17891`、UDP `17892`。

新电脑首次执行：

```sh
bash scripts/local.sh setup handoff/database
```

它会安装项目依赖，生成本机专用基础设施密钥，创建并启动本地 PostgreSQL，把随包数据库及对应数据密钥恢复到空库，执行迁移，下载语音模型，再启动 Docker 基础设施。
基础设施包括 PostgreSQL、Redis、MinIO、Qdrant、LiveKit 和 Egress。

多网卡、VPN 或 WSL 环境下，需要选接收方自己电脑可达的 IPv4 地址。例如：

```sh
DEV_PROD_HOST_IP=192.168.1.10 bash scripts/local.sh setup handoff/database
```

不要照抄示例 IP，也不要使用发送方电脑的旧地址。

初始化成功后，用能持续运行的终端启动三个应用进程：

```sh
bash scripts/local.sh up
```

Web 已挂载后端 API；无需另起 standalone backend。浏览器访问 **http://localhost:3000**。
使用 AI 工具时，不要让命令超时自动杀掉服务；使用其后台终端会话保留进程，记录会话位置和停止方法。

## 六、验收和登录

检查基础设施：

```sh
bash scripts/local.sh status
curl --fail http://localhost:3000/api/ready
curl --fail http://127.0.0.1:8790/readyz
curl --fail http://127.0.0.1:16333/readyz
```

确认 Web、worker 正常，并从日志确认 Python agent 成功连接本地 LiveKit。
检查应使用数据库连接的只读统计，或登录后查看记录数量，不输出候选人简历、手机号、邮箱等个人信息。

随包数据库保留原有账号和密码哈希。**登录需要发送方提供一个允许接收方使用的账号，或另行配置获准的 OAuth 应用。**系统关闭公开注册；脚本不会新建管理员，也不会重置原账号密码或绕过 MFA。
没有真实 OAuth 凭据时，初始化脚本使用禁用占位值满足现有必填校验，飞书/Google 登录不可用；请使用已有邮箱密码账号。

模型凭据可用后，上传新的测试简历验证解析和文件存储，再完成一次测试语音面试验证识别、合成、回调及录像。没有实际跑过的能力，明确标记为未验证。

## 七、数据和 TG 的范围

- 包含 PostgreSQL 的结构、业务数据、账号、权限和迁移历史，以及已有密文相应的应用密钥。
- **不包含历史简历原文件、附件、录像、MinIO 数据卷、Qdrant 索引及 Redis 队列。**历史记录缺少原文件时，无法预览、下载或重新解析；历史向量检索需另行同步或重建。不要报告这些内容已同步。
- 使用接收方独立的本地队列和文件存储。worker 仍可能恢复普通未完成的解析/评价任务；存在模型 Key 时可能发生模型调用，旧任务缺文件时可能失败。
- 默认关闭自动收邮件、真人面试定时提醒和历史批量解析。初始化包不携带正式 TG Token，因此不要尝试连接正式机器人。
- 如需本地 TG 测试，先使用独立测试机器人和 HTTPS 隧道，单独配置两份应用 `.env`、测试 Webhook 及接收人绑定。不要更改正式机器人的 Webhook，不要把本地业务链接简单替换成生产域名。

## 八、重复运行、排错和停止

`setup` 只用于首次初始化，遇到已有配置或 PostgreSQL 数据卷会拒绝覆盖。这是保护已有数据，**不要删除配置或数据卷来反复重试**。
如果首次初始化中断，请根据报错确定已完成的阶段，继续缺失的安装、恢复、迁移或模型下载；数据库已经恢复成功时，不要再次导入。
需要补跑迁移可执行 `bash scripts/local.sh migrate`。如果数据库非空，单独 import 也会拒绝覆盖。

以后启动只用：

```sh
bash scripts/local.sh up
```

停止时，在启动终端按 Ctrl-C，然后运行 `make dev-prod-down`；不要添加 `-v`。停止后数据库及其他数据卷保留。
电脑局域网 IP 改变时，参考 `docs/dev-prod.md` 更新 LiveKit/Egress 地址并重启相关进程。

## 九、AI 最终交付内容

完成后用中文告知接收方：访问地址、数据库是否恢复、各服务状态、后台终端位置、日常启动/停止命令、登录方式是否可用，以及哪些模型、语音、文件或 TG 能力已经实际验证。
遇到需要本人处理的项目，只列出具体缺失项及下一步，不要笼统地声称“部署成功”或让本人重新做一遍全部操作。
