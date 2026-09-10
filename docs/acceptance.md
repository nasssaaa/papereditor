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
