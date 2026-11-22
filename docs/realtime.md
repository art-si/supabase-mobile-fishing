# 实时聊天与已读回执

2026-11-21，站内聊天和好友申请已停止运行。底栏「举报」进入水域线索上报。以下为此前的聊天实现与验收记录。旧消息和关系数据留存，客户端入口与读写权限已关闭。

2026-11-20。已接入项目 `tlfmfokyhahlpzmpliad`，真实 H5 双账号验收通过。小程序与 App 的代码、构建检查不等同于真机验收；没有后台推送、在线状态或正在输入状态。

## 用户可见行为

- 前台消息列表、聊天页和钓友页订阅当前账号的更新通知；新消息仍通过原来的业务接口持久保存，失败重试和幂等规则不变。
- 收到通知后重新鉴权读取数据，不直接把广播当作消息。连接恢复或返回前台也补拉；保留原有轮询作为降级。
- 只有会话页面展示消息后，才提交已读游标。打开消息列表、收到广播或建立连接不代表已读。发送方的「已读」来自服务端投影，不由本地时间推测。
- 删除好友或拉黑后，停止向对方提供新的已读进度；仍按既有规则保留历史。数据库独立拒绝新消息，不依赖客户端断开频道来实现权限。
- 切换账号、令牌更新、离开订阅页面及退到后台时释放或重建连接；旧回调有身份与生命周期检查，不能把旧账号数据恢复到新页面。

## 共享架构与权限

`src/domain/live-updates.ts` 管理单账号连接和合并刷新，`src/services/live-updates.ts` 接入已有会话 API。短信、账号桥接及 Auth 配置没有改动。

H5 / Capacitor 使用浏览器 WebSocket；小程序通过 Pro 的 `packages/mobile-core/src/uni-websocket.ts` 适配 `uni.connectSocket` 的独立 SocketTask。共享层不依赖 Supabase，也不包含钓鱼业务。`src/_mobile-core` 只由同步脚本生成。小程序使用 URL polyfill 和 JSON 协议，避免依赖不存在的 DOM 事件、原生 URL 或文本编解码器。

数据库仅通知 `fishing:user:<当前用户 UUID>` 私有频道。载荷只有版本号，以及 Supabase 添加的随机事件 ID；没有正文、照片、位置、会话 ID 或好友资料。客户端只有本人频道的 Broadcast 接收权限，没有发送权限和 Presence 权限。每次业务读取仍执行最新关系与 RLS 检查。

触发器只处理消息、成员、已读和关系变化，通知函数位于不可由客户端调用的私有 schema。没有把全部业务表加入 Postgres Changes，也没有修改 Supabase 管理的表结构、索引或函数。

已部署迁移：

- `20261119164006_fishing_private_realtime.sql`
- `20261119171057_fishing_realtime_join_probe.sql`

第二份修正加入频道的授权探测：线上 `realtime.authorize()` 写入探测行时不传 `private`，默认值为 false。因此不能把探测行的 `private` 值作为 SELECT 许可前提。保留严格的本人 topic、Broadcast 类型及有效 profile 条件；客户端订阅与服务端发送仍显式 private，未增加 INSERT 或匿名授权。实际同名公开频道收不到私有通知。

[Supabase Realtime 权限文档](https://supabase.com/docs/guides/realtime/authorization)说明频道权限在加入和新 JWT 时重新计算，不是每条事件都查询关系表。因此不宣称撤销会话后旧 JWT 瞬时失效，也不把频道连接状态当业务权限。

## 验收证据

下方托管批次为此前真实 H5 验收；本次前后台增量的隔离检查见后面的独立小节，不把两类证据合并成原生真机成功。

真实批次：`artifacts/hosted-business/e04539f9-72f9-43d1-8a4a-fd451cd1fb18.json`，状态 `passed-cleaned`，27 项检查（5 项身份／前置与 22 项浏览器／真实服务断言）。

- 两个独立浏览器会话，用普通临时用户和公开 Key 实际发送消息、收广播、推进已读。测试关闭业务轮询，确认消息和回执确实由广播触发刷新。
- 本人私有频道可加入；其他账号、匿名用户以及错误后缀频道不可加入；客户端不能伪造服务端广播。同名公开频道没有收到实际私有通知。
- 后台关闭连接，期间新消息持久保存；返回前台重连补拉。实际拉黑后，服务端投影与写入均禁止继续发送或读取对方新回执。
- 浏览器未出现未捕获异常。已查看375px、440px及320px深色150%字号截图；大字验收不替代原生动态字体、键盘或读屏。
- 本批三个临时账号已撤销会话并删除，MCP 按精确 ID 回读账号、会话、profile 均为0。此前失败批次 `15378843-148e-48c2-ba4a-009c78da7097` 保留 `failed-cleaned`，不计为通过。没有删除真实用户内容或添加审核员。

本地数据库294项检查包含24项实时权限／回执检查；PGlite 的 Realtime 测试表是最小契约桩，不模拟托管授权、网络或 WAL，不能替代上述真实批次。

共享传输测试另覆盖同步 send/close 异常、迟到回调和敏感错误过滤；URL polyfill 在无浏览器 API 的独立 Node 子进程验证，真实固定版本 SDK 用 SocketTask 桩完成 JSON 加入／通知／心跳。这些仍是兼容性测试，不是微信设备网络测试。

最终类型检查、147项Node测试、H5与微信构建、Android/iOS网页资源同步通过。小程序兼容测试前两次失败分别来自测试工具自身依赖URL，以及Node懒加载Fetch依赖文本编码器；将缺少浏览器API的环境移到普通Node子进程、去掉Uni本来也没有的Fetch类后通过，没有为通过测试增加应用权限或移除有效断言。网页资源同步不是原生签名包构建。

安全 advisors 回读没有新增实时告警。仍有10项 INFO（刻意关闭客户端直接访问的内部／审计表）和既有 WARN：[未开启泄露密码保护](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)。账号配置归独立任务，不在此处擅自更改。

## App 前后台状态衔接（2026-11-20）

此前 App 只使用 Uni H5 的网页可见性事件。现增加已有 Capacitor App 插件的原生事件；这是代码衔接缺口修复，不是已经在真实 Android／iOS 复现过的故障。

- 通用控制器 `app-foreground.ts` 和页面门控 `page-activity.ts` 归属 Pro 的 `packages/mobile-core/src`；钓鱼项目只负责接线、页面业务和状态消费者，不手改生成目录。
- 权威状态分别来自原生 `appStateChange`／启动 `getState` 和 Uni `onShow`／`onHide`。两者均前台才允许页面工作；已知任意一端后台立即停止。原生启动先订阅再取快照，迟到快照不能覆盖事件；初始化失败或2秒未取得状态时回退网页信号，之后正常原生事件仍接管。该超时是应用策略，不是系统保证。
- 重复通知不重复补拉。页面卸载只清理自己的监听；延迟注册成功仍会移除，不调用全局 `removeAllListeners`。H5和个人微信继续用各自 Uni 生命周期，不在微信载入 Capacitor。
- 聊天、消息列表、好友页的定时刷新与实时连接共用这层状态。退后台拒收旧的聊天读取结果，不再新发已读请求；已经发出的请求不能追回。恢复只刷新当前页面，保留文本草稿，附件重新鉴权读取。用户主动发起的发送不因后台切换自动重发。
- 登录恢复仅在有效前台转换时调用既有 `resumeSession()`，未修改 Auth、短信、凭据存储实现或服务端配置。会话测试工具补上新依赖及真实的启动→显示→隐藏→显示顺序，原来的失效、暂时失败和账号隔离断言保留。

设计依据：`apple-design` 的 `multitasking.md › Best practices` 要求切换应用后能延续原任务；`ui-ux-pro-max` 的 Error Recovery 检索支持沿用现有重试入口。此处不增加常驻提示、弹窗、装饰或后台在线状态。共享控制器使用的原生事件语义见 [Capacitor App 文档](https://capacitorjs.com/docs/apis/app#addlistenerappstatechange-)；后台定时器会影响实时心跳，见 [Supabase 的后台断连说明](https://supabase.com/kb/troubleshooting/realtime-handling-silent-disconnections-in-backgrounded-applications-592794)。本应用选择后台关闭、前台重新加入并鉴权补拉，不采用后台保活。

新增12项共享状态／页面单元测试通过，并与既有3项实时生命周期检查一起验证。Chrome 的桥接契约在开发页和正式构建各8组通过，覆盖 Android、iOS 和普通网页：原生单独退后台、重复事件、晚到快照／HTTP、后台已读保护、草稿保留、隐藏期间换路由、恢复只刷新当前页、五类视口与实际大字输入框。它们使用明确的原生、HTTP、WebSocket 替身，不发送短信、不写真实账号或消息。截图和报告在 `artifacts/app-activity/contract`、`artifacts/app-activity/production-contract`；`failure-current.png` 是失败诊断，不是通过证据。

H5／微信构建和 Android／iOS 网页资源同步通过，不等同于 APK／IPA。当前缺 Android SDK，Gradle wrapper 下载超时；Windows 无法执行 Xcode。原生事件的真实投递、系统暂停时序、内存回收、锁屏恢复和系统键盘仍须设备验收。

## 复现与剩余门槛

```powershell
pnpm typecheck
pnpm test
pnpm test:db
# 有远端写入：创建仅本批次的临时账号并在 finally 中撤销、清理。
# 先运行真实 H5 开发服务；默认使用 http://127.0.0.1:5179。
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-realtime
```

若清理中断，按 [setup.md](setup.md) 的 `-CleanupRun` 恢复精确清理，不直接删整个用户表。管理凭据仅父进程内存使用，不能进入浏览器、日志、截图或 Git。

小程序发布还需配置当前 Supabase 项目的 WSS socket 合法域名并真机测试心跳、断网、后台恢复和令牌更新；不要用关闭合法域名校验代替上线配置。App 还需 Android/iOS 安装与后台测试。长期离线发件箱、系统推送、规模与并发压测仍未完成。
