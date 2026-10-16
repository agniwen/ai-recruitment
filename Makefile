AGENT_DIR := apps/livekit-agent
WEB_DIR   := apps/ai-recruitment-copilot
WORKER_PACKAGE := @arc/ai-recruitment-copilot-worker
VENV      := $(AGENT_DIR)/.venv
PY        := uv run --project $(AGENT_DIR)
AGENT_SCRIPT := src/agent.py

.DEFAULT_GOAL := help

.PHONY: help install web-install agent-install agent-download \
        dev web-dev web-dev-fresh worker-dev worker-start worker-typecheck \
        dev-prod-config dev-prod-up dev-prod-down dev-prod-status dev-prod dev-prod-web \
        agent-dev agent-console agent-start agent-shell \
        agent-deploy agent-update-secrets agent-clean clean

help: ## 显示所有可用命令
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------- install ----------

install: web-install agent-install agent-download ## 一键安装前后端依赖 + 下载模型

web-install: ## pnpm install (TanStack Start 前端)
	pnpm install
	pnpm hooks

agent-install: ## 创建 venv 并安装 Python 依赖 (uv sync)
	cd $(AGENT_DIR) && uv sync

agent-download: ## 下载 Silero VAD + turn-detector 模型
	cd $(AGENT_DIR) && uv run $(AGENT_SCRIPT) download-files

# ---------- dev ----------

DEV_PROD_COMPOSE := docker compose --env-file .env.dev-prod.local -f dev-prod.yaml

dev-prod-config: ## 备份并统一本机 .env，生成 dev-prod 的本地密钥与配置
	node scripts/configure-dev-prod.mjs

dev-prod-up: ## 启动本地数据库、队列、存储、向量库及 LiveKit/录像依赖
	$(DEV_PROD_COMPOSE) up -d

dev-prod-down: ## 停止本项目依赖并保留数据卷
	$(DEV_PROD_COMPOSE) down

dev-prod-status: ## 查看本项目 Docker 依赖状态
	$(DEV_PROD_COMPOSE) ps

dev-prod: dev-prod-up ## 启动 Docker 依赖和本机 Web / worker / 语音 agent
	@$(MAKE) -j3 dev-prod-web worker-dev agent-dev

dev-prod-web: ## 启动可被本地 Docker 回调访问的 Web（固定 3000 端口）
	pnpm --filter @arc/ai-recruitment-copilot dev --host 0.0.0.0 --port 3000 --strictPort

dev: ## 并行启动 TanStack Start + LiveKit agent worker + 简历解析 worker
	@$(MAKE) -j3 web-dev agent-dev worker-dev

web-dev: ## 复用缓存启动 TanStack Start dev server
	pnpm --filter @arc/ai-recruitment-copilot dev

web-dev-fresh: ## 仅在依赖预构建异常时清理缓存并强制启动
	pnpm --filter @arc/ai-recruitment-copilot dev:fresh

worker-dev: ## 仅启动简历异步解析 worker (dev 模式，热重载)
	pnpm --filter $(WORKER_PACKAGE) dev

worker-start: ## 启动简历异步解析 worker (生产模式，不热重载)
	pnpm --filter $(WORKER_PACKAGE) start

worker-typecheck: ## 检查简历异步解析 worker TypeScript 类型
	pnpm --filter $(WORKER_PACKAGE) typecheck

agent-dev: ## 仅启动 LiveKit agent worker (dev 模式，热重载)
	cd $(AGENT_DIR) && uv run $(AGENT_SCRIPT) dev

agent-console: ## 在终端里直接和 agent 对话 (不开房间)
	cd $(AGENT_DIR) && uv run $(AGENT_SCRIPT) console

agent-start: ## 启动 LiveKit agent worker (生产模式，不热重载)
	cd $(AGENT_DIR) && uv run $(AGENT_SCRIPT) start

agent-shell: ## 进入激活了 venv 的子 shell (手动调 python/pytest 等)
	@echo "Entering venv shell for $(AGENT_DIR). Type 'exit' to leave."
	@cd $(AGENT_DIR) && $$SHELL -c '. .venv/bin/activate && exec $$SHELL'

# ---------- deploy ----------

agent-deploy: ## 构建并部署 agent 到 LiveKit Cloud (代码+环境变量)
	cd $(AGENT_DIR) && lk agent deploy --secrets-file .env.secrets --project interview

agent-update-secrets: ## 仅更新 agent 环境变量并重启 (不重新构建)
	cd $(AGENT_DIR) && lk agent update-secrets --secrets-file .env.secrets --project interview

# ---------- clean ----------

agent-clean: ## 删除 Python venv
	rm -rf $(VENV)

clean: agent-clean ## 清理所有生成目录
	rm -rf apps/ai-recruitment-copilot/.output apps/ai-recruitment-copilot/node_modules/.vite node_modules/.cache
