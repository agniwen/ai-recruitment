# 本地完整依赖环境

`dev-prod.yaml` 管理 PostgreSQL、Redis、Qdrant、MinIO、LiveKit 和 Egress；Web、简历 worker、Python 语音 agent 在宿主机运行，保留热更新。

## 配置依据

2026-10-14 通过 SSH 只读检查了 `root@172.237.14.213`：

- `/opt/arc-infra/docker-compose.yml`：PostgreSQL 15、Redis 7、Qdrant 1.12.4、MinIO。
- `/opt/ai-recruitment`：Web、worker、agent 共用业务数据库、Redis、文件桶和 LiveKit 配置。
- `/opt/livekit`：自托管 LiveKit、Egress、独立 Redis DB 2；该目录的配置存在，但检查时相应容器未运行。

本地只复用服务结构，不复制生产凭据或生产数据。PostgreSQL 和 Qdrant 与线上配置同版本；Redis 固定为本机已有的 7.2。MinIO 使用本机已有的官方 Quay 镜像；LiveKit 固定为 1.13.6，Egress 为 1.15.0。线上旧 Egress 1.9.4 标签无法从仓库拉取，因此没有照搬该标签。公网 TLS/TURN 配置不适用于本机回环测试，未复制线上证书或域名。

## 启动

在仓库根目录执行：

```sh
# 首次配置或电脑局域网 IP 改变时执行。先备份，再修改三个应用现有的 .env。
make dev-prod-config

# 启动 Docker 依赖及本机三个应用；先退出此前的 make dev，避免端口冲突。
make dev-prod
```

也可以分别启动：

```sh
make dev-prod-up
make dev-prod-web
# 另外两个终端：
make worker-dev
make agent-dev
```

Web 使用 `0.0.0.0:3000`，供 Docker 内的 LiveKit webhook 回调访问。浏览器使用 `http://localhost:3000`。不要让 Vite 自动换端口，否则回调和登录地址会不一致。

配置脚本默认读取 macOS `en0` 的 IPv4 地址作为 RTC 地址；其他网卡或系统可显式指定：

```sh
DEV_PROD_HOST_IP=192.168.1.10 make dev-prod-config
make dev-prod-up
```

局域网 IP 改变后，重新生成配置并重启 LiveKit/Egress，再重启本机应用：

```sh
docker compose --env-file .env.dev-prod.local -f dev-prod.yaml restart livekit egress
```

## 地址和数据

| 组件         | 宿主机地址                       | 说明                                           |
| ------------ | -------------------------------- | ---------------------------------------------- |
| PostgreSQL   | `127.0.0.1:54324/ai_recruitment` | 复用现有 `ai-recruitment-local-db_data` 数据卷 |
| Redis        | `127.0.0.1:16379`                | 业务队列 DB 0；LiveKit/Egress DB 2             |
| Qdrant       | `http://127.0.0.1:16333`         | 本地独立向量存储                               |
| MinIO S3     | `http://127.0.0.1:19100`         | 私有简历桶和录像桶                             |
| MinIO 管理台 | `http://127.0.0.1:19101`         | 凭据在 `.env.dev-prod.local`                   |
| LiveKit      | `ws://127.0.0.1:17890`           | RTC 使用本机局域网 IP 的 TCP 17891 / UDP 17892 |
| Web          | `http://localhost:3000`          | 本机开发进程                                   |
| worker       | `http://127.0.0.1:8790/readyz`   | 本机开发进程                                   |

Compose 保留原来的项目名 `ai-recruitment-local-db`，从旧配置接管已有 PostgreSQL 容器，并挂载同一个外部数据卷；不会重新导入或清空数据库。其余服务使用该项目的新数据卷，与 `business/ai-it/local` 和 `env-docker` 中的服务分开。

现有数据库记录保留，但云端简历文件、历史录像和远程 Qdrant 索引不会自动复制到本地。请上传一份新的测试简历验证本地流程。历史记录可能因本地桶缺少对应对象而无法预览或重新解析；worker 启动恢复旧待处理任务时也可能记录此类失败。

## 环境变量

`scripts/configure-dev-prod.mjs` 保留当前三个应用的模型配置和 API Key，只替换本地基础设施、agent 名称及回调配置。大模型、STT、TTS、Embedding 仍调用原有外部提供商，不是离线推理。

- Web 和 worker 使用相同的数据库、Redis 地址及队列前缀，解决 Web 中空 Redis 值遮蔽 worker 配置的问题。
- Web 和 Python agent 使用相同的本地 LiveKit 密钥、`arc-local` agent 名称及回调密钥，并启用 `INTERVIEW_SELF_HOSTED=1`。
- Web 的录像访问地址为 `http://127.0.0.1:19100`；Python agent 将 `http://minio:9000` 传给 Docker 内的 Egress，用于上传录像。这两个地址访问同一个 MinIO。
- 启用 `HUMAN_INTERVIEW_MEDIA_ENABLED=true`，由本机 worker 为真人面试日志采集留底：摄像头每 30 秒截图，麦克风每 2 分钟采样最多 15 秒，存入本地 MinIO 的 `ai-recruitment-recordings` 桶。采样要求参与者已发布且未静音对应轨道；这与 Egress 完整录像是独立功能。修改开关后需重启 worker，未采集的历史内容无法补录。
- 清空旧的 `INTERVIEW_MEDIA_LOCAL_DIR` 覆盖项，让留底统一使用上述 MinIO 桶；已有本地目录中的历史文件不会自动迁移。
- 本地模式关闭自动收邮件、真人面试提醒和历史批量解析；已有第三方凭据保留，不自动同步线上数据。
- `.env.dev-prod.local` 保存本地服务凭据；`.devtools/dev-prod/` 保存 LiveKit/Egress 私有配置和备份。两者都被 Git 忽略。
- 每次运行配置脚本前，三个原始 `.env` 备份到 `.devtools/dev-prod/backups/<时间>/`，重复配置会保留已生成的本地密钥。
- 如果存在额外 `.env.local`，脚本会在写入前退出，避免高优先级配置悄悄连接到其他环境。

## 检查与停止

```sh
make dev-prod-status
curl --fail http://127.0.0.1:3000/api/ready
curl --fail http://127.0.0.1:8790/readyz
curl --fail http://127.0.0.1:17890
curl --fail http://127.0.0.1:16333/readyz

# 在运行 make dev-prod 的终端按 Ctrl-C 停止本机应用，再停止 Docker 依赖。
make dev-prod-down
```

普通 `down` 保留数据。不要添加 `-v`，它会删除本项目的 Redis、MinIO 和 Qdrant 数据卷。恢复之前的应用配置时，将同一备份目录里的 `web.env`、`worker.env`、`agent.env` 分别复制回对应应用的 `.env`，再重启应用。

服务就绪、agent 注册和存储连通只证明基础设施正常；简历解析与评价仍需模型调用验证，完整语音与录像仍需完成一次实际面试验证。
