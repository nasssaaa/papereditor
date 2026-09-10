# 权限与安全边界

本版本用于邀请制小团队。公网入口为 `https://fblerp.com/papereditor/`，浏览器使用 HTTPS/WSS，服务端已打开 `COOKIE_SECURE=true`。TLS 使用 fblerp.com 现有证书，Nginx 将独立子路径转给 FRP，再到 Mac 的回环端口。FRP 客户端连接参数沿用管理员已有设置。

Nginx 将 Paper Editor 会话 Cookie 限定在 `/papereditor/`，客户端资源、API、下载和 WebSocket 使用同一前缀。它与 ERP 共用浏览器 origin，路径隔离不等于独立 origin 的安全隔离；两者都应作为可信应用维护。

最初提供的 wh1234567.com 证书未用于当前入口，其私钥只留在服务器私有目录，限制 SYSTEM 与管理员访问，不在 Git 中。该域名未备案，已停止使用其虚拟主机。

## 应用层

- 密码使用随机盐 scrypt；会话令牌随机生成，数据库只保存 SHA-256 摘要。
- HttpOnly + SameSite=Lax Cookie、会话过期、登录速率限制、变更请求 Origin 校验。线上会话另带 Secure 标记。
- `TRUST_PROXY=true` 时只信任回环代理；Nginx 覆盖传入的客户端地址头，避免用户伪造限速身份。
- 每个项目均校验成员角色；只读成员不能通过 HTTP 或协同协议写入。
- 文件路径限制、扩展名白名单、上传/ZIP 大小和文件数限制，拒绝路径穿越与隐藏控制文件。
- 默认管理员随机密码只写私有数据目录，不写日志或 Git。

## 编译层

实际 Mac 部署使用 `macos-sandbox`：

- `sandbox-exec` 默认拒绝；TeX 安装和必要系统库只读，当前项目构建目录可写；SyncTeX 额外只读访问当前产物。
- 没有网络授权，关闭 shell escape，不读取项目 latexmk 配置。
- 默认 120 秒超时并终止进程组；CPU 时间与文件输出大小有上限；默认一次一个构建。
- macOS 原生后端没有 Docker 级别的硬内存、PID 上限，也不应作为公开、不受信任租户的隔离承诺。
- `sandbox-exec` 是平台相关机制；升级 macOS 后应重新验证隔离和真实编译。

可选 Docker 后端使用 Linux ARM、禁网、只读根文件系统、非 root、移除 capabilities、2 GB 内存和 PID 限额。当前 Mac 的 Docker 外接盘挂载未通过验收，因此没有把它选为线上默认。Docker 替代方案仍需单独验证部署条件和编译结果。

Windows `native` 没有操作系统沙箱，只用于可信的本机项目。关闭 shell escape 并不能阻止 TeX 读取本机可访问的文件。

## 数据保护

外接盘快照只提供编辑恢复，不能防止整盘损坏。数据库、资源、快照应备份到另一块磁盘或远端位置。热拷贝 SQLite 时必须采用 SQLite backup API 或一并处理 WAL；最简单的完整冷备份方式是停止应用后复制整个 `data` 目录，随后恢复服务。

浏览器离线草稿仍留在原浏览器的 IndexedDB 中，退出登录不会自动删除。公共电脑使用结束后应清理站点数据。权限撤销能阻止继续访问服务器，但不能撤回成员此前已下载的文件。
