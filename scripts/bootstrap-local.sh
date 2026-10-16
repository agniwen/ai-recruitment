#!/usr/bin/env bash
# Prepare tools only. Never creates/overwrites application .env files or databases.
set -euo pipefail

task_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$task_root/.devtools/bootstrap/node/bin:$task_root/.devtools/bootstrap/npm/bin:$task_root/.devtools/bootstrap/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
task_mode="${1:-install}"
case "$task_mode" in
  install|--check) ;;
  --help)
    echo '首次准备工具：bash scripts/bootstrap-local.sh'
    echo '只检查，不安装：bash scripts/bootstrap-local.sh --check'
    echo '支持 macOS、Ubuntu/Debian；Windows 请先配置 WSL2 和 Docker Desktop。'
    exit 0 ;;
  *) echo "未知选项：$task_mode" >&2; exit 1 ;;
esac

fail() { echo "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }
node_ok() { has node && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; }
pnpm_version="$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' "$task_root/package.json")"
[[ -n "$pnpm_version" ]] || fail '无法从 package.json 读取 pnpm 版本。'
pnpm_ok() { has pnpm && [[ "$(pnpm --version)" == "$pnpm_version" ]]; }
docker_ok() { has docker && docker compose version >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

if [[ "$task_mode" == --check ]]; then
  task_missing=0
  for tool in git make uv; do
    if has "$tool"; then echo "${tool}：已安装"; else echo "${tool}：缺少"; task_missing=1; fi
  done
  if node_ok; then echo 'Node.js：可用'; else echo 'Node.js：需要 24 LTS'; task_missing=1; fi
  if pnpm_ok; then echo "pnpm：$pnpm_version"; else echo "pnpm：需要 $pnpm_version"; task_missing=1; fi
  if docker_ok; then echo 'Docker 和 Compose：可用'; else echo 'Docker/Compose 未安装、未启动或当前用户无访问权限'; task_missing=1; fi
  exit "$task_missing"
fi

task_os="$(uname -s)"
[[ "$task_os" == Darwin || "$task_os" == Linux ]] || fail '请在 macOS、Ubuntu/Debian 或 WSL2 的 Bash 中运行。'
task_tmp="$(mktemp -d)"
trap 'rm -rf "$task_tmp"' EXIT
download() { curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$1" -o "$2"; }

if [[ "$task_os" == Darwin ]]; then
  if ! node_ok || ! has git || ! has make || ! has uv || ! has docker || ! docker compose version >/dev/null 2>&1; then
    if ! has brew; then
      echo '安装 Homebrew；安装器可能请求管理员密码和 Apple 命令行工具。'
      download https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh "$task_tmp/brew.sh"
      /bin/bash "$task_tmp/brew.sh"
    fi
    has brew || fail 'Homebrew 尚不可用，请完成系统安装提示后重跑。'
    if ! node_ok; then brew install node@24; fi
    if ! has git; then brew install git; fi
    if ! has make; then brew install make; fi
    if ! has uv; then brew install uv; fi
    if ! has docker || ! docker compose version >/dev/null 2>&1; then
      if [[ ! -d /Applications/Docker.app ]]; then brew install --cask docker; fi
    fi
  fi
  if ! docker_ok; then
    echo '正在打开 Docker Desktop。首次使用请在弹出的窗口中完成系统授权和初始化。'
    open -a Docker || fail '无法打开 Docker Desktop，请手动完成安装后重跑。'
    # Wait in short intervals so Ctrl-C remains responsive.
    for ((task_attempt=0; task_attempt<60; task_attempt++)); do
      if docker_ok; then break; fi
      sleep 3
    done
    docker_ok || fail 'Docker 尚未就绪；完成 Docker Desktop 提示后，再运行本脚本。'
  fi
else
  # Use the existing Desktop daemon inside WSL; do not install a second daemon.
  task_wsl=0
  if [[ -r /proc/sys/kernel/osrelease ]] && grep -qi microsoft /proc/sys/kernel/osrelease; then
    task_wsl=1
    docker_ok || fail 'WSL：请先在 Windows 安装并启动 Docker Desktop，在 Settings > Resources > WSL Integration 中启用当前发行版，然后重跑。安装说明：https://docs.docker.com/desktop/setup/install/windows-install/'
  fi
  [[ -r /etc/os-release ]] || fail '无法识别 Linux 发行版，请手动安装工具。'
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "$ID" == ubuntu || "$ID" == debian ]] || fail 'Linux 自动安装仅支持 Ubuntu/Debian。其他发行版请手动安装后运行 --check。'
  task_sudo=()
  if [[ "$(id -u)" != 0 ]]; then
    task_sudo=(sudo)
  fi
  need_admin() {
    if [[ "$(id -u)" != 0 ]] && ! has sudo; then
      fail '安装或启动系统软件需要 sudo，请让电脑管理员处理缺少的工具。'
    fi
  }
  task_apt_ready=0
  apt_prepare() {
    if [[ "$task_apt_ready" == 0 ]]; then
      need_admin
      "${task_sudo[@]}" apt-get update
      "${task_sudo[@]}" apt-get install -y ca-certificates curl xz-utils git make
      task_apt_ready=1
    fi
  }
  if ! has curl || ! has git || ! has make || ! has xz; then apt_prepare; fi
  if [[ "$task_wsl" == 0 ]] && { ! has docker || ! docker compose version >/dev/null 2>&1; }; then
    apt_prepare
    "${task_sudo[@]}" install -m 0755 -d /etc/apt/keyrings
    download "https://download.docker.com/linux/$ID/gpg" "$task_tmp/docker.asc"
    "${task_sudo[@]}" install -m 0644 "$task_tmp/docker.asc" /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" > "$task_tmp/docker.list"
    "${task_sudo[@]}" install -m 0644 "$task_tmp/docker.list" /etc/apt/sources.list.d/arc-docker.list
    "${task_sudo[@]}" apt-get update
    "${task_sudo[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  if [[ "$task_wsl" == 0 ]] && ! docker_ok; then
    has systemctl || fail 'Docker 已安装；当前系统没有 systemd，请手动启动 Docker 服务后重跑。'
    need_admin
    "${task_sudo[@]}" systemctl enable --now docker
    if ! docker_ok; then
      fail 'Docker 已启动，但当前用户没有访问权限。请由管理员配置当前用户的 Docker 权限，重新登录后重跑；不要用 sudo 运行项目。参考：https://docs.docker.com/engine/install/linux-postinstall/'
    fi
  fi
  if ! node_ok; then
    apt_prepare
    case "$(uname -m)" in x86_64) task_arch=x64 ;; aarch64|arm64) task_arch=arm64 ;; *) fail 'Node 自动安装只支持 x64/arm64。' ;; esac
    download https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt "$task_tmp/SHASUMS256.txt"
    task_archive="$(awk -v suffix="-linux-$task_arch.tar.xz" 'substr($2,length($2)-length(suffix)+1)==suffix {print $2}' "$task_tmp/SHASUMS256.txt")"
    [[ "$task_archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || fail '无法确定 Node 24 安装包。'
    task_node_version="${task_archive#node-}"
    task_node_version="${task_node_version%%-linux-*}"
    download "https://nodejs.org/dist/$task_node_version/$task_archive" "$task_tmp/$task_archive"
    awk -v file="$task_archive" '$2==file' "$task_tmp/SHASUMS256.txt" > "$task_tmp/node.sha256"
    (cd "$task_tmp" && sha256sum --check node.sha256)
    mkdir -p "$task_root/.devtools/bootstrap/node"
    tar -xJf "$task_tmp/$task_archive" --strip-components=1 -C "$task_root/.devtools/bootstrap/node"
  fi
  if ! has uv; then
    download https://astral.sh/uv/install.sh "$task_tmp/uv.sh"
    UV_INSTALL_DIR="$task_root/.devtools/bootstrap/bin" UV_NO_MODIFY_PATH=1 sh "$task_tmp/uv.sh"
  fi
fi

if ! pnpm_ok; then
  npm install --prefix "$task_root/.devtools/bootstrap/npm" "pnpm@$pnpm_version"
fi
hash -r
bash "$task_root/scripts/bootstrap-local.sh" --check
echo '工具准备完成。填写 .env.local-providers 后，执行：'
echo 'bash scripts/local.sh setup .devtools/handoff/incoming'
echo 'bash scripts/local.sh up'
