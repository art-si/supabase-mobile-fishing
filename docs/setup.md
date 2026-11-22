# 配置与部署清单

## 已确认

- Supabase：`jupuypvmgjpnpntfetqv`，URL `https://jupuypvmgjpnpntfetqv.supabase.co`。
- 微信：`wx9f631f76bb1543e0`，个人主体。
- App 标识暂定 `com.diaoyouji.fishing`，开通认证、签名前确认最终值。

## 客户端与服务端

复制 `.env.example` 到忽略提交的 `.env.local`。客户端仅放 publishable/anon key、高德 Web JS 公开 Key、安全代理 URL 和非敏感开关。Vite 会拒绝 Supabase service_role／secret key。

`VITE_PHONE_AUTH_ENABLED` 控制短信验证码、注册和短信找回密码。已有账号的密码入口使用正式认证服务，可独立使用。`VITE_AUTH_CAPTCHA_ENABLED` 当前仅失败保护，CAPTCHA 平台适配尚未实现。`VITE_OPERATOR_PHONE_ENABLED` 需真实原生插件与身份桥接后启用。

个人小程序不使用 `VITE_MAP_WEB_ORIGIN` 或 web-view。高德 Web 服务 Key 仅放 Edge Secret `AMAP_WEB_SERVICE_KEY`。微信手机号授权在代码中禁用，不是通过环境开关即可开启。

不要在聊天、前端环境、日志或 Git 放 AppSecret、service_role、数据库密码、短信凭证、高德安全码、运营商密钥。**目前不需要你发送 AppSecret**。未来微信身份功能由服务端交换 code，session_key 不能作为应用令牌或发给客户端。

用户数据相关 Edge 使用 Supabase 自带服务端环境变量，同时保留网关 JWT 与函数内 Auth 用户验证。公开地图 SDK 代理的独立防护见高德章节。上传必须经服务端重编码进入私有 bucket；客户端没有 Storage 写入策略。`fishing_private` 不能加入 Data API 的 exposed schemas。

## Supabase 部署

2026-11-21 已将 52 条数据库迁移、10 个 Edge Function、私有媒体和 Auth 迁入当前项目。以下第 2、3 步记录最初建库时的状态。

1. 已使用本机 Supabase CLI 核对目标项目 `jupuypvmgjpnpntfetqv`。使用项目级 MCP 时先核对它连接的项目。
2. 部署前确认项目无业务表、迁移、函数或 Auth 用户，Postgres 17.12；不存在业务 Auth trigger 冲突。
3. 已执行 foundation、amap_quota、internal_privileges、moderation_workflow、author_content、water_reports 六条迁移。CLI 创建文件，版本依次为 `20261119043740`、`20261119043745`、`20261119045623`、`20261119054049`、`20261119065526`、`20261119072928`，与远端回读一致。已应用文件不要改写，需要修改时新建迁移。CLI db 命令串行执行，避免临时 login role 凭证轮换冲突。未灌入示例数据，未创建收费分支。
4. 生成类型并复核安全建议；配置短信 provider 或 Send SMS Hook、频控和测试号码，验收注册／登录／刷新／退出／防刷。
5. `amap`、`media-upload`、`account-delete` 已部署且保留 `verify_jwt=true`，缺失／无效用户令牌均被拒绝；仍需真实测试账号验收上传、配额、图片方向、运行限制与注销重试。
6. 公开 Key 已放入忽略提交的 `.env.local`；不是服务端密钥。审核员由管理员安全授予，用户不可自行选角色。

安全 advisors 当前无 WARN/ERROR；private 表无直接访问 policy 是默认拒绝的设计。性能建议的未使用索引来自空项目，不据此删除。`pnpm test:remote` 验证公开读取、私有表及作者编辑／线索读取拒绝、写 RPC 和函数鉴权，不创建用户、不发送短信、不删除账号。

### 登录、退出与本机草稿

游客可浏览；鱼情、私人日志与钓位草稿只在登录后编辑，按真实／体验环境和账号分别存储，不把访客草稿自动归入新账号。会话过期时隐藏私人内容、保留原账号草稿，登录同一账号后恢复。换账号立即清空页面旧内容并读取新账号数据；旧网络回包、上传、私信发送、地图选点不能回填新账号页面。

主动退出需确认清除本机当前账号的未提交草稿（包括遗留访客草稿和临时选点），不会删除远端已保存内容、另一账号草稿或皮肤设置。本机退出先完成，再请求 Supabase `logout?scope=local`；断网或存储失败有明确提示。另一个 H5 标签页同步登录变化；再次登录同一账号不能恢复已明确清除的内存草稿。

访问 JWT 在退出后仍可能有效到过期，并不等于所有已签发令牌立即失效；见 [Supabase 退出语义](https://supabase.com/docs/guides/auth/signout)。H5／小程序仍使用平台本机存储，应使用受信任设备；原生已有 SecureStorage 代码接入，Keychain／Keystore 的真实读写、锁屏、重启和重装仍待真机验收。跨标签页或桥接替身测试不等同于跨设备或真机测试。

`pnpm test:session` 会隔离构建并拦截所有外部请求，用两个浏览器页面覆盖账号切换、过期、刷新竞态、私信延迟、退出取消／失败、清理边界与资料恢复；测试号码和令牌是 fixture，不发送真实短信，不创建线上账号。

### 最小内容审核入口

仅被授权人员在「我的 → 设置」看到「内容审核」。权限由 `fishing_private.moderators.user_id` 实时查询，不读取用户可编辑的 metadata。**目前线上没有用户或审核员，不会自动把首个注册者设为管理员。** 真实账号建立后，由项目管理员核对 Auth UUID 再安全授予，不能让客户端写这张表，也不能把 private schema 暴露给 Data API。

待审队列包含共享动态和钓位，不含私人日志、私人内容、原始精确坐标或到达说明。操作需要当前内容 revision、明确结果、原因和一次请求 ID；发生编辑／撤回／其他人已处理时必须重新读取。照片失败时不能通过审核；通过、退回、隐藏均记录操作。作者可以查看自己的退回原因。

这是内容审核工作流，不是完整举报／账号封禁后台。真实上线前需用普通作者和另一位审核员验收：待审内容不可公开读取 → 审核通过后按范围可见 → 下架立即拒绝新读取 → 作者看到原因；角色收回应立即失败。短时图片签名已签发后的 60 秒有效期仍适用。

### 作者编辑与撤回

作者从动态／钓位详情进入原记录编辑，私人日志从资料库进入。服务端检查 owner、当前 revision、白名单字段和照片归属，不接收客户端权限或审核结果；旧 `save_spot` 不能绕过版本规则 upsert 覆盖。共享内容编辑后回到待审；撤回变成私人，保留 ID、原内容、精确位置和自己的互动历史。

每次更新带稳定请求 ID；重复相同请求返回先前结果，不重复修改。请求 ID 不得换内容复用；过期 revision 要重新读取，不能自动覆盖。私有回执不开放客户端读写，删除后的内容不能靠旧请求复活。已签发照片 URL 的短时有效期及下载副本边界仍适用。

### 水域线索与官方渠道

入口在「找钓位」和「我的」。线索是独立的作者私密数据，不发社区、不进普通审核员队列。类型使用“疑似电鱼／违规网捕／毒鱼炸鱼／其他”，不把所有网捕判为违法。先确保安全，不接近或阻拦；事实与是否违法交由主管部门核实。

现场材料包括省市县、文字地点、时间、可选 GCJ-02 坐标、描述和最多6张照片。H5/App 复用高德定位选点；个人微信使用高德地点搜索和静态预览，缺 Key 时仍可手填地点。拍照／选图先留本机，只有用户同意私密云端保存后才上传；上传经服务端重编码去除定位元数据，请用户自行保留原片，应用不是取证鉴定或原片保全服务。普通局域网 HTTP 不能保证相机／定位权限可用。

照片与坐标默认仅作者可访问；删除会清除应用描述、地点和坐标，删除媒体索引并收回新签名权限。已删除索引对应的对象进入[私有清理队列](media-cleanup.md)，由每5分钟的任务通过 Storage API 清理并重试；未提交草稿不被扫描删除。未建立索引的上传孤儿、历史遗留对象、备份及已下载副本不在此清理范围内；已签发 URL 最长60秒。云端主要存储于爱尔兰，界面单独告知；正式公开使用前需要评估数据跨境、敏感个人信息和保留策略，不能只勾选同意就视为合规完成。

**目录共38条：全国公共3条，地方35条。不是全国地方或每个水库的完整名录。** 游客可直接选择事发省市县，按区县、城市、省优先，再回退全国公共渠道。切换省或城市会清空下级筛选；游客筛选只在页面内存中，不恢复账号的私密草稿。仅使用明确核验的别名（例如湘西州／湘西自治州），不模糊匹配邻近城市，不把“长沙县”作为城市字段里的“长沙市”，也不根据高德附近 POI 猜测主管机构。港澳台暂无已核验条目，不自动匹配内地部门。

渠道逐条记录官方来源及核对日：原23条为2026-11-19，本次新增15条为2026-11-20；没有替旧条目更新核对日。未拨号实测，不能保证接通／受理。各自核对日180天后需复核；明确的2026年度渠道于2027-01-01停用；目前没有自动更新任务。

| 范围 | 已核验来源与使用边界 |
| --- | --- |
| 全国公共 | [农业农村部2026年通知](https://www.agri.cn/zx/hxgg/202605/t20260506_8833435.htm)列出的渔政举报平台010-59191110；[苏州官方文件](https://www.suzhou.gov.cn/szsrmzf/bmwj/202412/6c9adeb3cee443e2808f538ab61b654a.shtml)公布的“中国渔政”公众号；[12345与110协调文件](https://www.mee.gov.cn/zcwj/gwywj/202205/t20220516_982293.shtml)用于区分非紧急转办。12345通常按拨号所在地接入，不能按所选坐标自动转事发地 |
| 湖北黄石／大冶／阳新 | [黄石市农业农村局2026-04-23公告](https://nyj.huangshi.gov.cn/nyzx/xzgw/202604/t20260423_1323191.html)，使用机构固话及公告时段，不采集工作人员私人手机号 |
| 江苏 | 同一[苏州官方文件](https://www.suzhou.gov.cn/szsrmzf/bmwj/202412/6c9adeb3cee443e2808f538ab61b654a.shtml)公布“江苏长江禁渔随手拍”；按官方适用水域使用，不作为江苏所有水库的统一管理处 |
| 黑龙江省及12个地市 | [省政府2026年禁渔期通告](https://www.hlj.gov.cn/hlj/c116012qem/202605/c00_31945151.shtml)列出的省级及地市固话；哈尔滨公布的12345复用公共入口。伊春、绥化采用2026号码，不沿用不同的2025旧号 |
| 江西于都 | [县政府2026年专项行动公告](https://www.yudu.gov.cn/ydxxxgk/c145193cpg/202602/f5358363a4b7446b91af5c929fffbc94.shtml)，工作日县农业执法固定电话；专项期限至2026年底 |
| 安徽宣州 | [宣州区农业农村局2026-07-22发布](https://www.xuanzhou.gov.cn/Jczwgk/show/3799962.html)，仅匹配该区，不扩大到全省 |
| 湖南14个市州 | [湖南省农业农村厅农业违法案件线索投诉举报电话](https://agri.hunan.gov.cn/agri/ztzl/jbdh/agrtsjb/202110/t20211014_22497962.html)，逐一匹配城市／自治州。网页显示2026-06-29，正文落款2024-03-13，保留这个区别，不称作2026年新公告。这些是农业违法案件渠道，并非全部为渔政专线；使用公告中的机构名，告知用户确认具体水域和受理范围 |
| 安徽郎溪 | [县农业农村局2026-05-06通告](https://www.ahlx.gov.cn/Jczwgk/show/3722392.html)公布的0563-7026787，仅匹配宣城市郎溪县天然水域；不混用宣州区电话 |
| 广东云浮 | [市农业农村局2026-04-22公告](https://www.yunfu.gov.cn/nyncj/zwgk/gggs/content/post_2005247.html)，工作日涉渔举报电话；不使用同页的政策咨询号码冒充举报电话 |

没有发现可核验、允许本应用直接提交照片和精确位置的全国统一政府 API，**不实现抓表单、自动邮件或向搜索出的联系人批量转发**。目前按钮是“私密保存，选择官方渠道”“复制文字材料”“打开拨号”；复制坐标和拨号均有独立确认。保存成功明确显示“尚未发送”，不能记录伪造的 sent/accepted 状态。

本机体验版在上报及历史页单独标注本机存储，并禁用联系官方按钮；试用不会拨打真实举报电话。正式版游客也能查看公共渠道，但保存私密材料需要真实账号。

本批没有收录重庆2025年旧表中受行政区划变更影响的号码：[市政府2025年公告](https://www.cq.gov.cn/ywdt/jrcq/202511/t20251107_15146356.html)说明撤销江北区／渝北区、调整两江新区与北碚区，须重新核实辖区。咨询电话、执法监督投诉电话、已结束的征求意见电话均不能直接当作非法捕捞举报渠道。

未来直达提交须先核验官方主体、辖区、水域、接口文档及接入授权，用户确认实际接收单位后再发送最少必要材料；服务端需签名鉴权、幂等 outbox、有限重试、真实回执及人工失败处理。电话号码或公开邮箱本身不代表已有接口授权。测试只能用机构允许的测试环境，不向真实政府渠道发送虚构线索。

## 高德与个人小程序

2026-11-20：出钓天气复用上述高德配置，详见[实际实施状态](implementation-status.md)。JS代理只新增固定的 `/v3/weather/weatherInfo` 路由，限制单个六位行政区编码；客户端只使用实况天气。个人微信通过原 `amap` 鉴权函数的 `{action:'weather',adcode}` 查询，缺少 `AMAP_WEB_SERVICE_KEY` 时返回真实不可用，不替换成JS平台Key或演示天气。图商字段依据[高德JS天气文档](https://lbs.amap.com/api/javascript-api-v2/guide/services/weather)及[Web服务天气文档](https://lbs.amap.com/api/webservice/guide/api/weatherinfo)，结果按图商发布时间展示，不以请求时间伪造更新。

- `node scripts/test-weather.mjs`：已启动5179开发页；隔离SDK、Auth和API，检查天气状态、竞态、皮肤、字体、键盘及个人微信传输契约，不是微信设备验收。
- `node scripts/test-weather-live.mjs`：真实高德查询，默认5179；`FISHING_AMAP_CLOUD=1` 用真实托管代理，`FISHING_H5_URL` 可指向5181生产预览。只搜索公开地点，自动化明确拒绝GPS，不发短信或写业务数据。
- `pnpm exec tsx --test tests/weather.test.ts tests/amap-js.test.ts` 与 `pnpm dlx deno@2.9.6 test --config supabase/functions/deno.json tests/amap_edge_test.ts`：纯契约与服务端防护。`scripts/test-amap-cloud.ps1` 补充真实远端天气参数拒绝及小程序匿名401，并回归真实地点联想。

H5/Capacitor 使用高德 JS API 与 `_AMapService` 服务器代理。代理限制上游路径、请求大小、频率，不能任意转发 URL；安全码不放客户端。

2026-11-19 已复用相邻 `supabase-mobile-pro/modules/supabase-mobile-tms-driver/.env.local` 的 JS Key 和配对安全码。`node scripts/reuse-amap.mjs` 只迁移高德字段，不修改短信或登录配置，不回写 Pro。公开 Key 在 `VITE_AMAP_KEY`；安全码改名为**非 VITE** 的 `AMAP_SECURITY_JS_CODE`，仅供开发服务器读取。`.env.local` 忽略提交且禁止通过 Vite HTTP 读取。

云端 `amap-js` 已部署，服务器转发目标为 `https://jupuypvmgjpnpntfetqv.supabase.co/functions/v1/amap-js/_AMapService`。高德 JS API 只接受一级路径 `/_AMapService`。部署时将站点的 `/_AMapService/*` 反向代理到上述目标并保留后缀与查询参数，然后将 `VITE_AMAP_SERVICE_HOST` 设为 `https://地图代理域名/_AMapService`。`node scripts/configure-amap-cloud.mjs` 上传高德服务端环境配置并清理临时文件。

这是游客可用的 JS SDK 代理（JSONP 无法携带 Supabase 用户 JWT），**不查询帖子、钓位或私密数据**；原 `amap`、`media-upload`、`account-delete` 的 JWT 校验没有关闭。允许列表限定到本机／当前局域网的 5178、5179、5181 端口，以及 Capacitor 的 `https://localhost`、`capacitor://localhost`。来源头不能代替身份认证，非浏览器可伪造；因此另有固定高德接口／Key 校验、8秒上游超时、1MiB响应限制和数据库原子总限额（每分钟60、UTC每日1000次）。`fishing_js_map_ticket` 仅服务端可执行，计数器不保存 IP、地点或查询词；平台及高德的访问日志仍可能含 URL 参数，应纳入隐私及保留策略。上线正式域名或电脑 IP 改变后，需更新**精确来源列表**，不能改成 `*`。

Vite 开发服务器固定使用同源 `/_AMapService`，预览可用相同路径。正式发行检查要求配置绝对 HTTPS 地址和一级路由。地图测试命令 `node scripts/test-amap-live.mjs` 可通过 `FISHING_H5_URL` 指定已启动服务，使用测试坐标和真实公开地点搜索。`node tests/amap-js-quota.mjs` 验证服务端额度权限，`node scripts/check-amap-bundle.mjs` 扫描构建产物。

`pwsh -NoProfile -File scripts/test-amap-cloud.ps1` 检查云端入口拒绝非法来源、Key、接口和方法及匿名访问权限。正式上线前需在目标网络核对端到端转发、商用授权和共用配额。

**Web 服务 Key 已接入（2026-11-20）。** 用户在已有高德应用中新增“钓友集服务端”Key，已安全写入目标项目的 `AMAP_WEB_SERVICE_KEY` 并核对摘要。真实登录后的搜索联想、静态地图解码／缩放及天气查询通过 27 项检查；`amap` v16 同时修复地点查询缺少区县编码的问题。JS 平台 Key 与 Web 服务 Key 继续按各自用途使用，不能互换。申请、部署和证据见[高德 Web 服务接入](amap-web-service-setup.md)；微信／原生真机仍需验收。

个人方案已确认并实现：原生页面搜索高德地点、静态地图预览、选点回填 GCJ-02；不可拖动，不用微信原生地图冒充高德。服务端只允许固定高德接口，隐藏上游 Key，按用户与项目限额。大致水域重取授权数据、再次降精度，不绘制精确标记；隐藏位置不请求地图。

当前应用配额：每人每分钟 20 次、每日 120 次，全项目每分钟 60 次、每日 1000 次，持久化配额在数据库内原子保留；上游控制台限额和商业授权仍需单独确认。不要关闭域名校验规避平台要求。

待提供的配置（不要直接贴密钥到聊天）：

- 短信服务：供应商、签名、模板；凭证放 Supabase 服务端配置，再启用 Auth provider/Send SMS Hook。当前远端 `external.phone=false`。
- 高德：JS Key、HTTPS 代理和 Web 服务 Key 已接入并完成真实接口联调；尚需正式站点来源白名单、微信请求域名及各平台真机验收。
- App 本机号认证：建议先按阿里云号码认证规划，需要最终 Android 包名与签名 SHA、iOS Bundle ID、SDK 认证方案及服务端凭证。原生插件和 Supabase 会话交换仍待实现，不能只打开开关。

微信后台仍需确认业务类目、UGC／社交能力、request/upload/download 域名及隐私指引。编译和 H5 预览不代表能通过平台审核。

## 隔离的真实远端业务验收

Windows PowerShell 7、本机已登录 Supabase CLI 且可访问指定项目时，运行以下命令。它们会创建独立临时测试账号、写入少量测试内容／图片，最后清理；不是只读检查，不要放进普通构建或持续部署。仅允许已确认的 `jupuypvmgjpnpntfetqv`，不调用短信、邮件或举报接收单位。

```powershell
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite core
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite social
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite report
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite orientation
```

`-Suite all` 一次运行上述四组 API 场景，不含以下 H5 场景。分组便于定位线路中断，未通过的批次不会因后续重跑变为通过。管理员凭证只通过CLI读取到本机进程内存，业务调用使用临时用户JWT；PowerShell请求不跨用户复用身份头。只读GET最多重试一次，写请求不自动重放。

真实 H5 验收需要本机 Chrome、项目 Playwright，以及 `http://127.0.0.1:5179` 的真实模式开发服务。先确认端口所运行的是本项目，已有服务时不要重复启动。上报组会通过已有高德配置搜索公开地点“苏州金鸡湖”，不会获取本机真实位置或联系接收单位。

```powershell
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-media
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-social
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-chat-attachments
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-report
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-report-manual
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-large-photo
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-zones
```

H5 子进程只接收临时普通用户会话和合成测试图片，不接收管理员凭证。测试会主动断网检查恢复行为；截图仅含合成内容，网络记录省略请求头、请求体和签名URL参数。浏览器异常只输出失败阶段，避免错误堆栈泄露令牌。浏览器结束后父脚本撤销会话并清理，故障时仍按下方规则处理。不要将此流程当成手机号登录验收或正式用户数据操作入口。

`h5-chat-attachments` 验证两个独立浏览器上下文之间的图片上传／下载、断网后原位重试、幂等、陌生人拒绝、鱼情／钓位卡片分享、作者撤回后旧标题消失及拉黑后的历史图片规则。为测试已发布卡片，父进程会创建两条 `friends` 范围的待审样例，先验证待审不能分享，再以管理员权限**只修改这两条精确记录的状态**；执行前回读作者的本次运行标记与邮箱，并限制记录ID、作者、原状态与可见范围，之后回读。没有新增审核员，不公开内容，这段只是测试前置，不能证明真实审核流程通过。样例随临时作者删除级联清理；业务调用、卡片撤回、Storage签名全部使用普通临时用户权限。线上结果与限制见[图片与内容卡片聊天](chat-attachments.md)。

`h5-report-manual` 单独验证不使用地图的手填地点流程，明确要求空坐标，不替代 `h5-report` 的真实高德选点检查。测试已在取消删除后等待确认框关闭，避免关闭动画期间同名按钮造成假失败。旧fixture业务测试仍有短信UI入口，短信任务改变交互时需另行对齐，不能通过忽略协议或关闭风控让业务测试通过。

忽略提交的 `artifacts/hosted-business/<run-uuid>.json` 只记录项目、测试账号ID／预定邮箱、已通过项和清理状态，不记录密钥、令牌、密码或私密正文。看到 `cleanup-required` 时先处理遗留测试数据，不再建新一批：

1. 通过项目级管理工具核对该日志中每个账号的精确ID、邮箱以及服务端 `app_metadata.fishing_acceptance_run`；三者必须一致，不能根据昵称或通用邮箱前缀批量删用户。
2. 管理员只撤销这些账号的 `auth.refresh_tokens` 和 `auth.sessions`，再回读确认均为0。删除账号本身不能替代撤销会话；不要关闭RLS或改登录设置。
3. 确认完成后运行 `pwsh -NoProfile -File scripts/test-hosted-business.ps1 -CleanupRun <该次UUID> -SessionsRevoked`。该开关是管理员已完成撤销的确认，并不会自行撤销遗失的会话。脚本会重新核验账号归属，只删该账号前缀下的测试JPEG，再删除这些临时账号。若归属或文件格式不符合预期会停止，不能扩大删除范围。

恢复清理成功仍将原验收标为失败／已清理，不冒充业务测试通过。测试照片均为程序生成的色块或确定性随机纹理，不使用用户照片。方向测试会下载真实存储结果检查尺寸、像素旋转和EXIF移除。

`h5-zones` 使用真实高德公开地点、普通临时账号验证圈选待审、本人预览、权限隔离与撤回；不添加审核员、不发布到公共地图。最终结果、旧字号截图限制与独立地图检查见[禁钓提醒与范围预览](zone-reports.md)。

### 大图上传与资源边界

上传前复用 Pro 的 `packages/mobile-core/src/image-prepare.ts`：支持 JPG／PNG，原始文件不超过8MiB、2400万像素；大图保持比例缩到长边2048px，小图不放大、不裁切。H5／Capacitor WebView 使用浏览器解码与 Canvas，微信使用 `getImageInfo`／`compressImage` 并核对实际输出尺寸。微信低版本没有正确缩图时会阻止上传，不能当成成功。共用模块只处理本机文件，不抓取外部图片；生成副本在上传结束／失败后释放，原片和相册文件不改动。线索照片仍须用户明确同意后才进入上传处理。

不改动原片不等于替用户永久备份：H5选择器返回的是本次会话的临时文件，原始现场材料仍需用户自行保存到手机；云端仅保存处理后的副本。

服务端继续独立验证与重编码，去除元数据，写入私有 bucket；客户端处理不替代服务端安全检查。保留8MiB输入、1000万像素和JPEG解码100MB保护。文件字节小也可能超过解码内存：此时返回413 `IMAGE_DIMENSIONS_TOO_LARGE`，不再混为通用422；不通过调高内存限制规避问题。已完成1200万像素合成图的真实H5上传，尚不能替代Android／iOS／小程序相机真机验收或覆盖所有手机型号。

```powershell
# 本机浏览器直接验证真实共用模块，38项，无账号或外部网络请求
node scripts/test-image-prepare.mjs
# 有远端写入的独立功能边界检查，不包含在 -Suite all 中
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite photo-capacity
# 单独验证解码保护；使用紧凑10MP JPEG，不能代替大文件传输或压测
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite photo-guard
```

`photo-capacity` 直接向服务端发送少量1.92MP／6MP／10MP合成JPEG，前两者应成功，10MP应明确触发解码保护；这不是压测或对任意10MP图片都能接受的承诺。`h5-large-photo` 则走真实选择照片→本机缩图→上传→私密保存→签名下载／展示，确认1200万像素原片保留、竖拍像素方向和陌生人隔离。网络中断或任一环节未完成时，整组保持失败记录。

## 原生与发布（设备验收）

实时消息已接入本人私有频道；实现、托管验收、隔离账号清理和小程序WSS配置要求见[实时聊天与已读回执](realtime.md)。真实双账号脚本为 `pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-realtime`，不是短信登录或真机验收。

Android 需要 SDK／Android Studio／签名，iOS 需要 Mac/Xcode／开发者账户／签名。Android 禁用全量应用备份，避免私人草稿进入不受控备份；声明的定位和照片用途仅对应用户主动操作。

2026-11-20 本机检查：JDK 21 已有，常用路径及环境变量未找到 Android SDK／Android Studio；现有 Gradle 8.14.3 wrapper 获取发行包时连接超时，尚未到 APK 编译阶段。没有自动接受 SDK 许可、生成签名或修改系统代理。请安装或提供实际 SDK 路径后再进行设备验收。

App 已把 Capacitor `appStateChange` 与 Uni 前后台状态合并，聊天、消息列表和好友页据此暂停实时连接／轮询，返回时补拉；没有后台保活、系统推送或新增界面元素。行为规则和证据边界见 [Realtime 的前后台状态节](realtime.md#app-前后台状态衔接2026-11-20)。复现隔离测试：

```powershell
# 需已有 H5 开发服务，默认5179。所有服务请求和原生桥接均使用隔离替身。
node scripts/test-app-activity.mjs
# 也可对已构建、启动预览的正式网页产物运行。
$env:FISHING_H5_URL = 'http://127.0.0.1:5181'
node scripts/test-app-activity.mjs
```

安全登录存储、运营商认证、图片方向、地图、系统返回、键盘、安全区、断网恢复和账号切换须真机验收。`pnpm release:check` 应在未完成时失败；人工验收标记不能为了通过脚本而随意设为 1。

## 参考

- [Supabase Phone Auth](https://supabase.com/docs/guides/auth/phone-login)
- [Edge 鉴权](https://supabase.com/docs/guides/functions/auth)、[运行限制](https://supabase.com/docs/guides/functions/limits)
- [高德安全密钥与代理](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)
- [uni-app web-view](https://uniapp.dcloud.net.cn/component/web-view.html)
- [Taro WebView 平台限制](https://nervjs.github.io/taro/docs/next/components/open/web-view/)
- [微信手机号能力](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)
