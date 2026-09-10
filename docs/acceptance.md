# 验收记录

验证日期：2026-09-10。下面的编译时间来自本次环境，不能作为所有论文的性能承诺。

| 项目 | 结果 |
| --- | --- |
| TypeScript / Vite / 服务端构建 | 通过 |
| 9 项服务端集成测试 | 全部通过 |
| 同时编辑、断线合并、持久化、改名保持文档 ID | 通过 |
| 只读 HTTP/WS、撤销权限、ZIP 路径攻击拒绝 | 通过 |
| 快照恢复、ZIP 导出/导入 | 通过 |
| 浏览器登录、编辑重载、快照、设置、窄屏 | 通过 |
| 中文 PDF 显示、搜索、SyncTeX 正反向 | SSH 转发及公网 HTTPS 两轮均通过 |
| npm audit | 0 项已知漏洞（当日锁定依赖） |
| Windows MiKTeX 英文 / 中文完整编译 | 9.905 秒 / 11.485 秒 |
| Mac M4 TeX Live 英文 / 中文完整编译 | 1.196 秒 / 1.910 秒 |
| BibTeX / 交叉引用 | 两端示例通过 |
| Mac 编译沙箱读取外部私有标记文件 | 拒绝 |
| Mac 编译沙箱写入外部数据目录 | 拒绝 |
| Mac 编译沙箱 TCP 连接 | 拒绝；同目标非沙箱对照连接成功 |
| Mac 主目录及系统卷别名路径读取 | 均拒绝 |
| Windows 服务器内部 FRP 健康接口 | 通过 |
| HTTPS/WSS 子路径登录、编辑保存、搜索、PDF、快照、窄屏 | fblerp.com/papereditor/ 两项浏览器测试通过，9.9 秒 |
| HTTPS 公网中英文编译、SyncTeX | 通过；未修改源码的缓存检查约 0.1–0.2 秒 |
| 公网当前状态 | fblerp.com/papereditor/ 正常，ERP 首页仍为“珠宝ERP入库系统” |
| Mac LaunchAgent 自动拉起 | FRPC 正常；App 配置已保存、自动作业暂时停用，待 bash 权限生效 |

Mac 环境：M4、16 GB、macOS 26.5、Node 24.21.0、TeX Live 2026、外接 APFS SSD。Windows 使用已安装的 MiKTeX 26.2 和项目独立 Strawberry Perl 5.42.3.1。

中文示例使用 Fandol 字体；PDF.js 的 CMap、字体及解码资源随构建本地发布。构建日志中 Monaco 大文件提示属于体积警告：编辑器按需加载，首次编辑仍需要下载编辑器模块。未进行跨浏览器矩阵、持续十人负载、断电或整机重启测试。

最终采用现有 fblerp.com 的 HTTPS 证书与独立 /papereditor/ 路由，完整 Nginx 配置校验及平滑重载成功，浏览器协同、PDF、搜索和编译验收均走该子路径。wh1234567.com 因未备案不再作为当前访问入口。

Mac App 正由独立 SSH 后台进程运行，断开 SSH 不会终止它。系统仍拒绝 LaunchAgent 的 `/bin/bash` 访问外接盘，需授权真正生效后才能验收自动拉起；不能承诺进程崩溃或 Mac 重启后的自动恢复。安全边界见 `security.md`。

## 快捷键版本验收（2026-09-11）

- 构建通过；9 项后端集成测试及 2 项快捷键／文本辅助单元测试通过。
- Windows Chrome 与 Edge 各通过 8 项浏览器测试：包含原有 PDF／工作区测试和 6 项快捷键测试。
- 覆盖命令面板、快捷键冲突、区域搜索、焦点恢复、中文输入法组合事件、长按保护、重复编译请求合并、PDF 搜索与 SyncTeX、跨文件诊断导航及过期诊断禁用。
- 两个浏览器用户同时编辑：面板打开期间的选区跟踪、光标同步、仅撤销本人修改、只读权限、离线辅助插入及恢复同步均通过；多选区插入一步撤销和 CRLF 文件字符位置也通过。
- 公网 `/papereditor/` 的 4 项写作／快捷键测试通过。Mac Chrome 152.0.7977.83 直接经过公网 HTTPS/WSS，验证命令面板、F1、快速打开、源码搜索、SyncTeX、焦点切换、PDF 搜索、输出面板和速查入口；独立验收项目的中文完整编译成功，耗时 1.637 秒。
- 修复测试暴露的基础问题：显式加载 Monaco 的查找、注释、多光标及行操作；客户端只发送自己的 awareness；统一 LF 字符位置；处理网络离线／上线；重复选择当前项目保持工作区就绪。

本机正在运行 IDM。已安装的 Chrome／Edge 获取 PDF 时收到空的 HTTP 204，而相同请求通过认证 HTTP 客户端可获得完整的 HTTP 200 PDF，测试用 Chromium 正常。因此 Windows Chrome／Edge 验收显式启用 `TEST_ISOLATE_PDF_TRANSPORT=true`，由 Playwright HTTP 客户端取得真实响应后原样转交页面，隔离下载拦截；没有更改 IDM 配置。Mac Chrome 公网验收没有使用这一隔离。应用对空 PDF 响应提供了下载工具忽略站点的提示。

新测试仍可用默认 Chromium 运行；`TEST_BROWSER_CHANNEL=chrome` 或 `msedge` 选择系统浏览器。`deploy/check-shortcuts.mjs` 是目标系统浏览器的只读冒烟脚本，支持 `TEST_BASE_URL`、`TEST_CREDENTIALS_FILE`、`TEST_PROJECT_TITLE`、`TEST_SCREENSHOT`；需要已有可编译的中文示例及有效账号。

此次发布只替换前端资源和入口，保留旧资源以兼容已打开的页面，未重启服务或迁移数据库。Mac 自动启动限制保持上述状态。

公网验收使用独立临时账号；结束后已删除该账号及其 5 个项目、编译产物，原有用户账号与论文保持原样。
