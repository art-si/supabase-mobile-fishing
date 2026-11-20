# 钓友集

面向钓鱼人的社区与出钓记录应用，目标同时支持 H5、微信小程序、Android 和 iOS。采用 Uni-app + Vue 3 + TypeScript + Pinia，直接复用 Pro 的 mobile-core；App 沿用 Capacitor。

**当前是可运行的开发预览，不是已经上线的三端成品。** 线上服务和平台验收尚未完成。

## 本地体验

需要 Node 22.13+、pnpm 11 和同级 `../supabase-mobile-pro`；也可通过 `MOBILE_PRO_ROOT` 指定共享仓路径。

```powershell
pnpm install
pnpm dev:demo
```

打开 `http://127.0.0.1:5178`。H5 启动默认监听 `0.0.0.0:5178`，同一局域网设备可使用 `http://电脑的局域网IPv4:5178` 访问；只在可信网络内使用，不要映射到公网。体验模式有明确横幅，使用独立本机数据和身份，不发送短信、不写线上数据库；示例钓位不可用于真实出行。体验照片为临时预览，重启后可能失效。

已构建的体验版可运行 `pnpm preview:demo`（先 `pnpm build:demo`）；正式版为 `pnpm preview:h5`。端口固定为 5178，预览时若已被占用会直接提示。手机须与电脑联网互通；如果访问不到，检查 Wi-Fi 客户端隔离或 Windows 防火墙的专用网络规则。普通局域网 HTTP 下浏览器可能禁用定位和相机等安全上下文能力，完整真机测试应使用 HTTPS。

正式模式：复制 `.env.example` 为忽略提交的 `.env.local`，填写公开配置后运行 `pnpm dev:h5`。未配置服务时明确报错，不自动退回演示。服务端密钥不能放进 `VITE_*`。

## 构建与验证

| 目标 | 命令 | 产物／说明 |
| --- | --- | --- |
| H5 线上／体验 | `pnpm build:h5` / `pnpm build:demo` | `dist/build/h5` / `dist/demo/h5` |
| 微信线上／体验 | `pnpm build:mp-weixin` / `pnpm build:mp-demo` | 开发者工具导入对应 `dist/build/mp-weixin` / `dist/demo/mp-weixin` |
| App 线上／体验资源 | `pnpm native:sync` / `pnpm native:sync:demo` | 同步 `android/` 与 `ios/` |
| Android | `pnpm android:open` | 需要 Android Studio、SDK、签名 |
| iOS | `pnpm ios:open` | 需要 Mac/Xcode、开发者账户、签名 |
| 类型／业务／数据库 | `pnpm check` | PostgreSQL 测试使用 PGlite，不替代托管集成测试 |
| Edge | `pnpm check:edge` | 类型及基础请求防护，不代表已部署 |
| H5 流程 | `pnpm test:h5` | 先构建体验包；自启临时服务器，默认使用本机 Chrome |
| 主题／逐页视觉 | `pnpm test:visual` | 体验包；截图覆盖核心页面、小屏、深色与主题状态 |
| 高德契约 | `pnpm test:map` | 隔离构建／会话，模拟地图接口；不模拟短信成功、不发送真实短信或地图请求 |
| 高德真实地图 | `node scripts/test-amap-live.mjs` | 需已启动正式 H5；公开地点搜索、选点、地址识别及布局检查，不登录或发送短信 |
| 密集钓位与缩放 | `node scripts/test-map-clusters.mjs` | 默认5178，可设 `FISHING_H5_URL`；真实高德底图／隔离钓位响应，数量合并、展开、重合列表、主题与键盘检查，不写远端或获取GPS |
| 地图天气契约 | `node scripts/test-weather.mjs` | 5179开发页；隔离天气／API样例，状态、竞态、皮肤、键盘及小程序传输契约，不是真机 |
| 高德真实天气 | `node scripts/test-weather-live.mjs` | 实际地点→区县→天气；`FISHING_AMAP_CLOUD=1` 使用线上代理，不采集GPS或写业务内容 |
| 高德代理安全 | `node tests/amap-js-quota.mjs` / `node scripts/check-amap-bundle.mjs` | 配额／权限与构建产物安全码检查；须先完成对应构建 |
| 会话契约 | `pnpm test:session` | 双标签页账号隔离、草稿恢复／清理、刷新竞态、断网退出；不发送真实短信 |
| App前后台契约 | `node scripts/test-app-activity.mjs` | 默认5179；可设 `FISHING_H5_URL=http://127.0.0.1:5181` 检查正式构建。Android／iOS桥接、HTTP和WebSocket均隔离，不是真机或远端聊天 |
| 作者编辑／撤回 | `pnpm test:author` | 原记录编辑、冲突恢复、失败幂等、私人撤回；隔离接口替身 |
| 共享修改稿契约 | `node scripts/test-comments.mjs --content-updates` | 默认5179，可用 `FISHING_H5_URL` 指向正式预览；本地PostgreSQL支持旧版保留、修改审核、隐私和作者／审核员界面，不写远端 |
| 共享修改真实 H5 | `pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-content-updates` | 仅确认项目的临时账号／好友内容；须核验本批次临时审核员，结束后精确清理并回读，先读 `docs/content-revisions.md` |
| 评论回复契约 | `node scripts/test-comments.mjs` | 默认5179，可设 `FISHING_H5_URL` 检查正式预览；HTTP拦截接本地PostgreSQL，回复／分页／删除／弱网／撤权与皮肤验收，不写远端 |
| 评论回复真实 H5 | `pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-comments` | 临时普通用户在确认项目创建私密动态和评论，验证普通RPC、直接表RLS和真实页面，再撤销会话并清理；不发送短信 |
| 评论举报契约 | `node scripts/test-comments.mjs --moderation` | 默认5179，可设 `FISHING_H5_URL` 为正式预览；本地PostgreSQL支撑举报／隐藏／恢复、权限回收和三套皮肤，不写远端 |
| 评论举报真实 H5 | `pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-comment-moderation` | 仅隔离临时账号和好友动态；需要维护者经项目MCP核验本批次临时审核员，结束后按精确ID清理审计并回读。先读 `docs/community-reports.md`，不授予真实用户权限 |
| 多条渔获契约 | `node scripts/test-trip-catches.mjs` | 默认5179，可设 `FISHING_H5_URL` 为正式预览；44项隔离请求／草稿／布局／皮肤／容量检查，不写远端 |
| 多条渔获真实 H5 | `pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-trip-catches` | 创建临时真实账号，在确认的项目写入私人日志、验证编辑／RLS／删除后清理；不发送短信、不公开鱼情 |
| 水域线索 | `pnpm test:water-report` | 照片延迟上传与重试、私密保存、属地渠道、取消拨号、删除与账号隔离；不联系政府 |
| 官方渠道查询 | `node scripts/test-report-channels.mjs` | 使用已启动的5178 H5；免登录属地筛选、官方别名、辖区隔离、三皮肤与拨号取消；外部请求全部拦截 |
| 社区举报 | `node scripts/test-content-reports-ui.mjs` | 先构建正式 H5 并启动预览；默认5181，可设 `FISHING_H5_URL`。Auth/API完全拦截，验证举报、处理、结果、照片、撤权与布局，不写线上 |
| 举报远端权限 | `pwsh -NoProfile -File tests/remote-readonly.ps1 -ReportsOnly` | 仅公开Key检查真实匿名接口/表拒绝，不创建举报或授予审核员 |
| 图片与卡片聊天 | `node scripts/test-chat-attachments-ui.mjs` | 正式H5预览默认5181，可设 `FISHING_H5_URL`；图片选择、失败重试、好友分享、撤权和布局，API完全隔离 |
| 聊天远端权限 | `pwsh -NoProfile -File tests/remote-readonly.ps1 -ChatOnly` | 真实匿名消息／附件拒绝检查，不创建账号、图片或消息；规则见 `docs/chat-attachments.md` |
| 聊天真实 H5 | `pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-chat-attachments` | 有线上写入：隔离账号、图片、仅测试好友可见的卡片样例；真实收发／撤回后清理，不验收短信或审核运营，先读 `docs/setup.md` |
| 远端只读 | `pnpm test:remote` | PowerShell 7；读取真实接口与鉴权检查，不写业务数据 |
| 缺配置的正式模式 | `pnpm test:h5:unconfigured` | 自动隔离构建无 Key 包，不覆盖 `.env.local`；验证无演示兜底 |
| 发布门槛 | `pnpm release:check` | 配置、功能和人工验收未完成时应失败 |

截图输出到 `artifacts/h5/`。可用 `PLAYWRIGHT_CHANNEL=bundled` 选择已安装的 Playwright Chromium。
`src/_mobile-core/` 是生成目录，禁止手改；通用控件归属 Pro，钓位／渔获／好友业务归属本仓。

## 产品与技术方案

- [产品规划](docs/product-plan.md)：首版范围、页面、用户流程、钓位隐私与社交规则。
- [架构与接入方案](docs/architecture-plan.md)：复用 mobile-pro、三端适配、Supabase、高德与实施顺序。
- [设计方向](docs/design-direction.md)：湖岸视觉、关键页面、GitHub 参考与验收。
- [实际实施状态](docs/implementation-status.md)：已做功能、验证边界、未完成项。
- [共享内容修改审核](docs/content-revisions.md)：旧版保留、修改稿对照、立即收紧隐私与远端验收。
- [禁钓提醒与范围预览](docs/zone-reports.md)：真实提交／撤回、三端地图边界与验收证据。
- [小程序包体与分包](docs/miniapp-package.md)：保留原路由、系统字体、构建预算及真实设备验收边界。
- [图文发布与照片顺序](docs/content-publishing.md)：最少输入、排序／预览、草稿恢复与远端权限验证。
- [配置与部署清单](docs/setup.md)：配置放哪里、线上接入顺序和发布门槛。

## 已确认的方向

| 项目 | 选择 |
| --- | --- |
| 平台 | H5、微信小程序、App 都纳入首版 |
| 架构 | 参照 supabase-mobile-pro，Uni-app、Vue 3、TypeScript、Pinia、共享 mobile-core，App 沿用 Capacitor |
| 设计 | Apple Design 与 UI UX Pro Max 原则，适配钓鱼场景 |
| 地图 | 高德，复用 supabase-mobile-pro 驾驶员项目配置，安全码留服务端 |
| 后端 | 新建 Supabase 项目 tlfmfokyhahlpzmpliad |
| 登录 | 手机号验证后自动注册或登录，各端适配入口 |

## 当前阶段

2026 年 11 月 19 日：已实现业务开发预览、SQL 权限基础与原生工程。H5 和微信线上／体验构建通过；Android/iOS 已资源同步，但未编译 APK／IPA、未真机验收。

Supabase 项目已接通；项目级 MCP 临时不可用时使用已认证且限定该项目的 CLI。已部署基础表／权限、地图配额、内部权限、内容审核、作者编辑和私密水域线索共六条迁移，以及 `amap`、`media-upload`、`account-delete` 三个函数。真实公开读取和匿名拒绝检查已通过；公开 Key 保存在忽略提交的 `.env.local`。没有写入线上示例数据。短信由另一个任务处理，原生号码认证仍缺配置和真实联调；高德状态见下述更新。

高德更新：已复用 Pro 的 JS Key，并把配对安全码接入 Supabase `amap-js` 代理（新增独立配额迁移）。H5 真实底图、搜索和选点已通过；安全码不进前端。用户新增的 Web 服务 Key 已接入 `AMAP_WEB_SERVICE_KEY`，搜索联想、静态地图／缩放与天气通过 27 项真实远端检查；微信／原生真机仍待验收。短信由另一个任务继续，本轮未修改。详见[高德配置](docs/setup.md#高德与个人小程序)。

水域线索入口在「找钓位」及「我的」：支持事发地点、时间、文字、最多6张现场照片、私密记录和删除。游客也能按事发省市县查询官方渠道；全国公共举报渠道作为兜底，当前共38条有官方来源的渠道（全国3条、地方35条），**不是全国地方／水库管理处的完整名录，也没有政府自动图片提交接口**。私密保存、打开拨号和官方受理严格区分，不能把“已保存”当成“已举报”。渠道核验和扩充规则见[配置与部署清单](docs/setup.md#水域线索与官方渠道)。

微信 AppID 已填写 `wx9f631f76bb1543e0`，主体为个人。已按确认方案实现短信入口与高德地点搜索／静态预览，不启用微信手机号授权或 `web-view`。H5/App 保留完整高德地图。三套皮肤在「我的 → 设置与隐私」切换，明暗随系统。

设计技能已安装在 `.agents/skills/apple-design` 和 `.agents/skills/ui-ux-pro-max`，固定来源与版本见 `skills-lock.json`。详细差异以实施状态文档为准。
