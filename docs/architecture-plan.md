# 钓友集架构与接入方案

日期：2026 年 11 月 19 日。状态：原方案基线，已进入实施。实际交付与未完成项见 [实施状态](implementation-status.md)。

已确认约束：个人微信采用短信、高德地点搜索与静态预览，代码禁止 `getPhoneNumber` 和 `web-view`。H5/App 保留完整高德地图。实时推送、原生安全存储及身份桥接尚未完成，不以构建成功代替验收。

## 工程基础与归属

已检查本机 `D:/spa/supabase-mobile-pro`。主仓维护共享移动能力，各业务应用通过脚本同步到 `src/_mobile-core/` 后编译，钓友集作为独立业务仓接入。

| 层次 | 采用方式 |
| --- | --- |
| 页面与业务 | Uni-app、Vue 3、TypeScript、Pinia |
| 移动组件 | Pro 的 mobile-core 与 @wot-ui/ui |
| 共享行为 | 安全区、顶底栏、表单、弹层、焦点、图片预览、可见视口 |
| App | 沿用 Pro 的 Capacitor，提供 Android 与 iOS 工程 |
| 后端 | Supabase Auth、Postgres、Storage、Realtime、Edge Functions |
| 地图与位置 | 高德，参照 art-supabase-pro |

Uni 编译包保持参考项目的同一发行版本，采用 Vue 3.4.21、@wot-ui/ui 2.3.2、Capacitor 8。为满足 Vue 3.4 peer 约束，本仓固定 Pinia 2.1.7，并显式安装 vue-demi 0.14.10，避免 H5 产物留下未解析模块；参考仓依赖不作修改。

共享控件改动归属 Pro 主仓；钓位卡、渔获字段、好友规则、数据 API 和路由归属 fishing。字体子集和图标生成需纳入钓友集的用字与图标。独立检出支持同级 Pro 或 `MOBILE_PRO_ROOT`。

主仓分发和 Android 脚本目前只注册现有应用。钓友集先在本仓提供构建入口，纳入主仓统一命令时再增加消费者注册及回归验证。

### 具体可复用文件

- `packages/mobile-core/src/components/MobileWorkspace.vue`、`MobileTopBar.vue`、`MobileBottomNav.vue`：工作区与安全区。
- `MobileBottomSheet.vue`、`MobileField.vue`、`MobileSelect.vue`：编辑与选择。
- `MobileEmptyState.vue`、`MobileLoadError.vue`、`MobileListFooter.vue`：数据状态。
- `MobileImagePreview.vue`、`overlay-focus.ts`、`visible-viewport.ts`：预览、焦点与键盘。
- `latest-request.ts`、`coordinates.ts`、`wechat-phone-login.ts`：请求竞争、坐标边界与微信授权事件。
- `scripts/mobile-runtime.mjs`、业务仓 `scripts/mobile-pro.mjs`：同步共享源码与 Vite 配置。

## 目录建议

```text
src/
  api/                  认证、内容、钓位、日志、关系与消息
  components/fishing/   渔获卡、钓位卡、范围选择与日志摘要
  composables/          分页、草稿、聊天滚动与页面状态
  pages/                四个主入口及公开详情
  subpackages/          编辑、日志、设置与管理
  stores/               认证、资料、信息流与消息状态
  platforms/            H5、微信、Capacitor 适配
  types/                领域类型与生成的数据库类型
  styles/               钓鱼业务主题映射及专用样式
  static/               品牌资源与许可文件
  _mobile-core/         脚本生成并忽略
scripts/                共享同步、构建与必要检查
supabase/
  config.toml           本仓独立配置
  migrations/           增量迁移
  functions/            身份、短信、位置代理、媒体与账号服务
docs/                   产品、架构和设计决策
```

H5 与 App 使用浏览器构建，微信通过条件编译与原生能力适配。领域接口统一，平台差异留在适配层。

## Supabase 接入状态

目标为用户新建的 [tlfmfokyhahlpzmpliad](https://supabase.com/dashboard/project/tlfmfokyhahlpzmpliad)。项目级 MCP 已连通，基础权限表结构、地图配额和三个服务端函数已部署；公开 Key 已写入忽略提交的本地配置。公开读取与匿名鉴权通过，短信 provider 未启用，真实登录后流程仍需联调。

前端需要 Project URL 与 Publishable key；建表和部署需要工具连接的账号有项目管理权限。服务端凭据置于 Secret，访问令牌和数据库密码留在安全本地配置中。

本轮使用 CLI 3.2.0 创建迁移，按新版本的 local-default 规则固定工作目录；线上通过项目限定 MCP 操作。每次变更前核对项目标识与现有结构，迁移文件版本与实际远端记录对齐。

## 请求与会话

沿用参考项目的跨端请求思路，以 `uni.request` 适配 REST、Auth 与 Edge Function，统一超时、业务错误和请求标识。官方 SDK 在 H5 与 Capacitor 可按兼容性采用，微信需先验证请求、WebSocket 和存储依赖。

会话刷新使用共享的单次任务，并发请求等同一次刷新完成后恢复。失败时保留待发布草稿，登录后回原操作。App 刷新令牌优先使用系统安全存储，H5 落实 XSS 防护和存储策略，各端退出清理私人缓存和订阅。

## 手机号认证

| 路径 | 方案 |
| --- | --- |
| 短信 | Supabase Phone Auth 生成和验证 OTP，Send SMS Hook 对接国内发送服务 |
| 微信 | 一次性手机号授权 code 经服务端向微信核验，解析已验证号码，进入统一账号与会话流程 |
| App | 优先评估阿里云号码认证 Android/iOS SDK，Capacitor 原生桥接取得证明，服务端核验后进入同一流程 |

国内短信先评估阿里云短信服务，与号码认证便于统一管理。Hook 校验调用签名和重放，发送与验证限流由服务端负责，日志脱敏。配置签名、模板与测试号码，测试和生产隔离。[Supabase 手机号登录](https://supabase.com/docs/guides/auth/phone-login)、[Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)。

统一身份以 `auth.users.id` 为准，规范化且已验证的手机号解析到同一账号，微信身份与手机号分别唯一绑定，冲突在服务端处理。

**关键验证项是第三方手机号证明到 Supabase 原生 Session 的桥接。** 验收要求为可刷新、可撤销、RLS 可识别用户，并能在三端回到同一账号。已有 Pro 客户端存在调用 `mobile-wechat-auth` 的模式，但当前检查到的主仓没有完整服务端实现，需要在本项目补齐并验证。

Capacitor 加载 H5，号码认证需要原生插件；DCloud 原生 App 的 univerify 属于另一套运行时。按 [Capacitor 插件](https://capacitorjs.com/docs/plugins/creating-plugins) 与 [阿里云号码认证](https://help.aliyun.com/zh/pnvs/developer-reference/sdk-integration-overview/) 接入，分别配置 Android/iOS 包名、签名与 SDK 参数。

## 高德地图

### 参考实现

在 `D:/spa/art-supabase-pro/src` 已找到：

| 文件 | 提炼的能力 |
| --- | --- |
| `hooks/core/useAmapSdk.ts` | 单次 SDK 加载、补载插件、超时与重试 |
| `hooks/core/useAmapGeolocation.ts` | 定位超时、HTTPS 检查、权限错误与坐标正规化 |
| `hooks/core/useAmapInitialView.ts` | 重开和离开时取消旧定位，保护已操作视图 |
| `hooks/core/useAmapGeocoder.ts` | 地址解析与无结果处理 |
| `utils/amap.ts` | 校验 SDK 坐标和完整路线 |
| `components/core/forms/art-address-picker/` | 搜索、地图选点和确认的组织 |

这些文件包含浏览器和桌面依赖，移植其边界与生命周期处理，按移动环境改造。

### 三端方案

| 端 | 首选路径 | 配置与验证 |
| --- | --- | --- |
| H5 | 高德 JS API 2.0 | JS Key、服务代理、HTTPS、触控 |
| Capacitor | 同一高德 H5 地图页，原生定位桥接 | WebView 域名与 Key 配置、双平台真机 |
| 微信个人版 | 原生搜索页 + 高德 Web 服务 POI／静态图 | Edge Secret、微信合法域名、选点回填、静态图标识 |

个人小程序不启用 web-view。高德 POI 与静态图经受保护的 Edge Function 获取，不暴露服务 Key；不把微信原生 map 称作高德。静态图保持完整图商标识。[高德地点搜索](https://lbs.amap.com/api/webservice/guide/api-advanced/search)、[高德静态地图](https://lbs.amap.com/api/webservice/guide/api/staticmaps)。

搜索页承载搜索、预览和确认。选点写入单次 requestId 的短期结果，主页面返回后读取并删除；验证 GCJ-02、坐标范围和十分钟时效，确认只回填、不自动发布。服务请求使用当前用户 Supabase 会话。

旧 map/bridge 路由仅重定向到原生搜索页。H5 完整地图加载失败时也可切换到地点搜索与静态预览。

### 坐标 数据与密钥

地图、POI、选点和导航统一 GCJ-02，原始 GPS 标记 WGS-84，在边界转换并记录来源与精度。保存的坐标明确标记体系；PostGIS 精确测距要在标准坐标及转换方案验证后接入，坐标系标识与实际转换分别处理。

首版按索引网格、范围框和游标查钓位，服务端限制区域与数量。精确点和公开区域分开保存，地图、排序和距离使用获准精度的数据。用户当前位置只用于本次查询。

公开 JS Key 按用途配置，生产 JS 安全密钥和 Web Service Key 通过服务代理保护。地图失败保留城市搜索与列表，拒绝定位、无结果与读取失败分别显示。[高德安全密钥说明](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)。

## 领域模型草案

| 领域 | 实体 | 归属与约束 |
| --- | --- | --- |
| 身份 | `auth.users`、私有 `identity_links` | 跨端统一主键，手机号和平台身份唯一绑定 |
| 资料 | `profiles`、私密账号设置 | 昵称等由用户编辑，管理状态单独控制 |
| 内容 | `posts`、`post_revisions` | 作者、类型、正文、范围、审核和版本 |
| 媒体 | `media_assets` 与关联 | 所有者、对象路径、尺寸和状态，继承父实体权限 |
| 互动 | `post_likes`、`comments`、`comment_likes` | 点赞唯一，回复属于同一动态 |
| 收藏 | `post_bookmarks`、`spot_bookmarks` | 分别用外键，集合归收藏人 |
| 话题 | `topics`、`post_topics` | 词典与关联 |
| 钓位 | `fishing_spots`、`spot_locations`、`spot_reports` | 安全信息与精确坐标分开，纠错有状态 |
| 出钓 | `trips`、`catches` | 用户所有，一次日志可有多条渔获，默认私有 |
| 社交 | `follows`、`friend_requests`、`friendships`、`blocks` | 单双向分开，用户对唯一 |
| 聊天 | `conversations`、`conversation_members`、`messages` | 双人会话去重，消息幂等标识 |
| 已读 | 成员的 `last_read_sequence` | 只能向前推进，服务端算未读 |
| 通知 | `notifications`、设备订阅 | 收件人私有，事件标识去重 |
| 管理 | `content_reports`、`moderation_actions` | 角色和处置记录由服务端维护 |

精确表结构在读取线上现状后固定。按字段归属开放更新权限。时间使用带时区时间戳，出钓当地日期保留原含义；重量和长度统一单位，未知与零区分。

好友接受、建立关系与会话创建使用事务；点赞、收藏、好友对、会话与消息请求分别有唯一约束。网络重试读取同一结果。父实体状态决定收藏、通知和分享的后续可见性。

## 权限与媒体

暴露的业务表开启 RLS 并配套 GRANT。SELECT、INSERT、UPDATE、DELETE 分别校验，更新约束原数据与更新后数据。

游客读取已发布公开内容的安全字段；登录用户写自己的数据并读取获准范围；成员只能读取所参与会话，仍允许通信时才能写新消息。好友和拉黑规则贯穿普通查询、实时和媒体。管理权限来自服务端受控角色，个人资料接口只开放本人字段。

媒体采用私有桶和短期签名，权限继承父实体；确实公开的头像可单独提供公开派生版本。核验类型、大小和尺寸，图片去位置元数据。未关联上传用临时状态，删除与孤儿文件清理由可重试队列完成，范围收紧时新签名重新鉴权。

## 聊天与实时

实施更新（2026-11-20）：本人私有Broadcast通知、重新鉴权补拉及已读回执已完成真实H5双账号验证；小程序复用Pro SocketTask传输。下文保留原规划，实际行为、迁移和未完成门槛以[实时聊天与已读回执](realtime.md)为准。

数据库是持久消息的权威来源，会话内递增序号负责排序、翻页、补取和已读，客户端消息标识负责去重。实时先评估数据库变更广播与私有频道，持久写入单独执行关系检查。

Realtime Broadcast、Presence 和业务消息表的权限分别设置。成员或拉黑变化时停止后续敏感广播，使用最小事件载荷触发客户端重新拉取获准数据。微信 WebSocket 适配验证心跳、重新鉴权、后台恢复和重连。[Realtime 权限](https://supabase.com/docs/guides/realtime/authorization)。

后台推送单独对接原生或平台能力，投递用队列和去重；各端先具备站内通知和恢复前台补拉。

## 查询与性能

信息流按 `(published_at, id)` 游标，消息按会话序号。为作者、状态、城市、关系用户、成员和外键建立必要索引。中文搜索用实际数据验证匹配与索引方案。

缩略图、固定占位与懒加载控制图片开销，地图按需加载。刷新保留已有内容，并发筛选只接受最新响应。天气按区域与来源时间缓存，地图数据按服务条款使用。私人缓存按用户隔离，退出和权限变动失效。错误日志使用脱敏码与请求标识。

## 实施顺序与验收

| 阶段 | 交付 | 完成条件 |
| --- | --- | --- |
| 工程 | fishing 工程、共享核心、平台适配 | H5 启动、微信导入、Android/iOS 工程就绪，版本锁定 |
| 关键接入 | Supabase、短信与身份桥接、高德、实时 | 同一账号会话、地图选点返回、跨端消息可达 |
| 内容 | 资料、信息流、详情、发布、日志、上传与收藏 | 真实读写、草稿和失败恢复 |
| 钓位 | 搜索、选点、权限、纠错与导航 | 三端流程与坐标隐私通过 |
| 社交 | 好友、拉黑、私聊、卡片与通知 | 幂等、补拉、未读和权限变更通过 |
| 发行 | 审核、注销、真机、签名与平台配置 | 构建、真机、发行包与上线分别记录 |

三端推进同一业务里程碑。凭据未具备时先完成独立工程、页面、类型和本地可审阅状态；真实认证、地图与推送按配置逐项验证。

重点用多个测试用户验证 RLS、好友范围、坐标、Storage 和实时权限；并发事务和重试做有针对性的验证。迁移前检查线上现状，增量应用、保留文件、针对性读回，再运行可用 advisors。

## 后续配置

需要 Supabase 插件重新连接能访问目标项目的账号；取得 Project URL 与 Publishable key。微信配置包括 AppID、服务端凭据、主体能力与业务域名；高德配置按 JS、服务端和原生用途区分。短信需要发送服务、签名和模板；App 需要号码认证方案、应用标识和签名，后台通知需要相应推送配置。

按最终路径一次性收集配置，规划阶段无需提前开通全部服务。后端 Secret 与本地环境文件不进入公开客户端或版本控制。
