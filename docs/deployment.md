# Mac mini + 外接 SSD + FRP

## 当前布局

Mac 服务监听 `127.0.0.1:18080`，独立 FRPC 代理把同一个端口交给公网 Windows 的 FRPS。论文不在公网服务器编译。

```text
/Volumes/KIOXIA/PaperEditor/
  app/                  源码、dist、生产依赖
  runtime/node/         独立 Node 24 ARM 运行时
  texlive/              便携 TeX Live 2026
  data/                 SQLite、资源、构建缓存、PDF、快照
  config/frpc.toml      私有 FRP 配置，不提交 Git
  cache/                安装缓存
  tmp/                  临时文件
  logs/                 安装与验收日志
```

系统盘只保留 LaunchAgent 配置和 `~/Library/Logs/PaperEditor` 中的启动日志。launchd 无法直接打开受隐私保护的外接盘日志，因此这些少量启动日志采用 macOS 标准目录；项目数据和 TeX 仍在 SSD。

## 安装

先挂载 SSD，准备 `PaperEditor/app` 并上传源码。在 Mac 上执行：

```bash
export PAPEREDITOR_ROOT=/Volumes/KIOXIA/PaperEditor
cd "$PAPEREDITOR_ROOT/app"
python3 deploy/install-node.py
bash deploy/install-tex-mac.sh
export PATH="$PAPEREDITOR_ROOT/runtime/node/bin:$PATH"
npm ci
npm run build
```

也可以在开发机完成构建，上传源码、锁文件和 `dist`，随后在 Mac 执行 `npm ci --omit=dev`。不要上传 Windows 的 `node_modules`；SQLite 原生模块必须匹配 Mac ARM 和 Node ABI。

`install-tex-mac.sh` 默认安装原生 Mac 工具，不依赖 Docker。可选的 `INSTALL_DOCKER_PLATFORM=true` 才安装 Linux ARM 工具。宏包镜像可由 `TEX_REPOSITORY` 指定。现有环境默认不自动更新 TeX；升级前先留存可恢复副本并编译真实论文验证。

## 后台启动与权限

`deploy/configure-launchd.py` 是当前机器的配置脚本：从 `~/frp/frpc-public.toml` 读取已有连接参数，生成项目自己的 FRPC 配置，然后注册：

- `com.papereditor.app`
- `com.papereditor.frpc`

它不会修改既有 FRPC 服务或打印认证 token。换服务器时，应先修改/准备自己的 FRP 源配置，并调整脚本中的目标服务器断言。

```bash
python3 deploy/configure-launchd.py
launchctl print "gui/$(id -u)/com.papereditor.app"
launchctl print "gui/$(id -u)/com.papereditor.frpc"
curl http://127.0.0.1:18080/api/health
```

macOS 必须允许 `/bin/bash` 和 `~/frp/frpc` 访问可移动宗卷。收到系统提示时允许；若后台程序被拒绝，检查「系统设置 → 隐私与安全性 → 文件与文件夹」，必要时在「完全磁盘访问权限」中添加实际可执行文件并打开开关，再重启自己的服务。

```bash
launchctl kickstart -k "gui/$(id -u)/com.papereditor.app"
launchctl kickstart -k "gui/$(id -u)/com.papereditor.frpc"
tail -50 ~/Library/Logs/PaperEditor/com.papereditor.app.error.log
```

当前 App 的 LaunchAgent 配置已保存，但因 bash 外接盘权限仍被拒绝，失败作业已暂时卸载，避免重复启动。实际运行进程的 PID 保存在 `tmp/acceptance-app.pid`；待权限生效后，先核对该 PID 的进程确为本项目 Node 服务并停止它，再运行 `python3 deploy/configure-launchd.py`，最后验证健康接口。FRPC 的 LaunchAgent 已正常运行。`kickstart` 仅适用于已经成功 bootstrap 的作业。

临时手动恢复：在能正常读取 SSD 的 Mac 终端或 SSH 会话中执行以下命令。健康接口正常时不会重复启动；启动后再次检查健康接口和日志。这只启动本次后台进程，不注册自动启动。

```bash
python3 - <<'PY'
from pathlib import Path
import subprocess, urllib.request
root = Path('/Volumes/KIOXIA/PaperEditor')
try:
    with urllib.request.urlopen('http://127.0.0.1:18080/api/health', timeout=3) as response:
        print(response.read().decode())
    raise SystemExit('App is already running.')
except OSError:
    pass
with (root / 'logs/acceptance-app.log').open('ab') as log:
    process = subprocess.Popen(
        ['/bin/bash', str(root / 'app/deploy/start-mac.sh')],
        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
(root / 'tmp/acceptance-app.pid').write_text(str(process.pid))
print('Started PID', process.pid)
PY
curl http://127.0.0.1:18080/api/health
```

这是用户级 LaunchAgent：权限就绪后，用户登录时启动、进程退出后重启。没有在本次工作中重启整台 Mac，也不宣称能绕过 FileVault 登录。若要求断电后无人值守启动，需要单独选择系统级服务、磁盘解锁和开机登录方案。

## 公网入口

访问 `https://fblerp.com/papereditor/`。Nginx 在既有 fblerp.com HTTPS server 中仅加入一个独立路由 include，使用现有证书；根路径、ERP API 和其他站点保持原有路由。`/papereditor` 自动跳转到带末尾斜线的路径。

- `deploy/nginx-papereditor.conf`：在 http 上下文定义独立 upstream 和 WebSocket map。
- `deploy/nginx-papereditor-route.conf`：在 fblerp.com HTTPS server 中代理 /papereditor/，转发时去除前缀。
- `deploy/configure-nginx-windows.ps1`：核对目标 server、备份、插入两处 include、校验和平滑重载。

前端采用相对构建资源，根据页面入口计算 API/PDF/WebSocket 前缀，因此同一构建产物也能在本机根路径运行。Nginx 将会话 Cookie 的 Path 改为 /papereditor/；应用开启 `COOKIE_SECURE=true`、`TRUST_PROXY=true`，只信任回环代理提供的客户端地址。

执行配置脚本时使用当前 Nginx 的运行身份。本次服务使用 SYSTEM，其他已有站点证书也限制 SYSTEM 读取，因此通过一次性 SYSTEM 任务校验并重载，任务已在完成后删除。既有站点证书权限没有放宽。

公网 18080 的临时防火墙规则与 portproxy 已移除，FRPS 仅在 `127.0.0.1:18080` 监听。用户提供的 wh1234567.com 因未备案没有继续使用；该域名的独立虚拟主机已移除，其证书只留在服务器的私有目录，未提交 Git。

验证三层接口：Mac 的 `http://127.0.0.1:18080/api/health`、公网 Windows 的同一回环接口、外部的 `https://fblerp.com/papereditor/api/health`。还要验证实际登录、WebSocket 保存确认与 PDF，不能只看健康接口。

## 更新与恢复

更新先完成构建和测试，再上传 `dist`、`deploy`、服务端源码及锁文件；依赖变化时在 Mac 执行 `npm ci --omit=dev`，随后重启自己的 App 服务。FRPC 配置未变化时不必重启它。

完整冷备份：停止正在运行的 App 实例（包括 SSH 后台实例），复制整个 `data` 目录至另一设备，再恢复 App；只备份数据库文件可能丢失 WAL 中的数据和外部图片资源。快照只在当前 SSD 上，不能替代异地或异盘备份。

卸载本项目时，仅移除 Nginx 中 Paper Editor 的 include、站点配置和两个 `com.papereditor.*` LaunchAgent。不要停止共享 FRPS、Nginx 或改动其他代理。

## Docker 替代后端

仓库保留 `deploy/Dockerfile.tex`、`bootstrap-mac.sh` 和 `install-tex.sh`。只有确认 Docker Desktop 能访问外接盘后才使用它们，并设置 `COMPILE_BACKEND=docker`。当前 `start-mac.sh` 固定采用已通过实际编译的 `macos-sandbox`；切换前需要修改此配置并独立验收。原生 Mac 的格式缓存不能直接视为 Linux 格式缓存，两种架构切换后应重新生成相应格式。
