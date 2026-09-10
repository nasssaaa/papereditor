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

这是用户级 LaunchAgent：用户登录后启动、进程退出后重启。没有在本次工作中重启整台 Mac，也不宣称能绕过 FileVault 登录。若要求断电后无人值守启动，需要单独选择系统级服务、磁盘解锁和开机登录方案。

## 公网入口

现有 FRPS 的 `proxyBindAddr` 是 `127.0.0.1`。本项目保留这个全局配置，通过 Windows `portproxy` 只把本机网卡的 18080 转到 `127.0.0.1:18080`，避免把其他 FRP 服务一起暴露。

当前服务器内网网卡地址为 `172.17.8.78`；更换服务器时必须先查询并使用实际网卡地址：

```powershell
New-NetFirewallRule -DisplayName 'PaperEditor-HTTP-18080' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 18080
netsh interface portproxy add v4tov4 listenaddress=172.17.8.78 listenport=18080 connectaddress=127.0.0.1 connectport=18080 protocol=tcp
```

还需在阿里云安全组入方向放行 TCP 18080。测试链路按以下次序：

1. Mac：`http://127.0.0.1:18080/api/health`。
2. Windows 公网服务器：本机 `127.0.0.1:18080` 及网卡地址的健康接口。
3. 外部浏览器：公网 IP 的 18080，登录、编辑并等待“已保存”，然后编译。

健康接口正常不等于协同完成；浏览器端还需通过 WebSocket、PDF 字体和双向定位验收。

## 更新与恢复

更新先完成构建和测试，再上传 `dist`、`deploy`、服务端源码及锁文件；依赖变化时在 Mac 执行 `npm ci --omit=dev`，随后重启自己的 App 服务。FRPC 配置未变化时不必重启它。

完整冷备份：停止 App LaunchAgent，复制整个 `data` 目录至另一设备，再恢复 App；只备份数据库文件可能丢失 WAL 中的数据和外部图片资源。快照只在当前 SSD 上，不能替代异地或异盘备份。

卸载本项目的公网入口时，仅移除名为 `PaperEditor-HTTP-18080` 的 Windows 防火墙规则、对应 18080 的 `portproxy` 项、以及两个 `com.papereditor.*` LaunchAgent。不要停止共享 FRPS 或改动其他代理。

## Docker 替代后端

仓库保留 `deploy/Dockerfile.tex`、`bootstrap-mac.sh` 和 `install-tex.sh`。只有确认 Docker Desktop 能访问外接盘后才使用它们，并设置 `COMPILE_BACKEND=docker`。当前 `start-mac.sh` 固定采用已通过实际编译的 `macos-sandbox`；切换前需要修改此配置并独立验收。原生 Mac 的格式缓存不能直接视为 Linux 格式缓存，两种架构切换后应重新生成相应格式。
