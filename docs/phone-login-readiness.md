# 手机号登录接入清单

## 当前结论

### 账号能力更新（2026-11-19）

已接入手机号／钓友号密码登录、短信验证设置／找回密码、原手机号验证后换绑新手机号，以及原生安全会话保存与启动恢复。接口、状态、设备测试边界见[账号登录与安全](account-security.md)。服务端密码规则已写入并回读。用户授权向尾号 4090 的白名单号码发送 1 条验证码，已亲自收码登录、设置密码；远端手机号验证／密码状态核对通过。发送后已关闭真实发送开关，后续回归没有追加短信。以下较早记录保留过程背景，以本节为准。

### 接入过程记录（早于上面的真实收码联调）

后续用户提供截图，确认 `DiaoyoujiSmsSend` 已绑定到 `diaoyouji-sms`。再次执行不含接收号码或验证码的同一权限诊断，返回 HTTP 400 / `MissingPhoneNumber`，不再返回权限拒绝，说明已通过该次请求的权限检查并进入必填参数校验。仍未调用真实收码；不将缺参诊断当作实际短信到达验收。SMS发送保持关闭。

用户表示完成授权后，再次使用同一凭证检查：STS 确认所属 RAM 用户为 `diaoyouji-sms`，但不带接收号码的发送权限诊断仍返回 `Forbidden.NoPermission` / `ImplicitDeny`，拒绝项为 `dypns:SendSmsVerifyCode`、账号级身份策略。不能将“用户已操作授权”记作权限已验证通过。配置回读确认验证码6位、300秒有效、60秒间隔、允许注册、自动确认关闭、签名/模板摘要符合预期、SMS发送关闭。测试白名单仍未写入，未发送短信。

用户提供的 RAM ID/Secret 已通过安全输入写入服务端，并回读摘要核对；签名 `恒创联众`、模板 `100001`、有效期 300 秒、最小间隔 60 秒已配置。Auth Phone 与 Send SMS Hook 均已启用，自动确认仍关闭，验证码长度 6 位。前端本地环境已开启手机号登录，实际 `localhost:5179` 页面已显示表单并通过 320/375/440px 无溢出及空手机号校验；未调用真实 OTP。

用户明确要求先配置、不发送，故 Edge `SMS_DELIVERY_ENABLED=false`，测试手机号白名单尚未填写。一次不含手机号、签名、模板或验证码的供应商权限诊断返回 HTTP 403 / `Forbidden.NoPermission`：新 RAM 用户尚需授予 `dypns:SendSmsVerifyCode`。当前为表单与认证路由就绪、真实发送待授权状态，不能称作已完成真实收码或登录验收。累计本轮短信发送 0 条。

本地登录流程验收 `node scripts/test-login.mjs --profile=active`：11/11 通过，包含校验、发送/验证限流、离开页面竞态、断网保留输入、正确验证后的真实响应形状/会话保存、协议往返不丢表单。所有供应商请求均被本地 fixture 拦截；这不是远端真实收码或真机验收。实际开发页截图见 `artifacts/login-ready/login-375.png`。

### 用户界面调整不等于接入完成

2026-11-19 按用户明确要求，从用户设置移除整组接入诊断，并从隐私页删除“服务提供方与境外存储”和供应商链接整块，不保留二级入口。这只改变展示；没有改变实际服务提供方、主要存储区域或个人信息流向，也不表示隐私合规已审核通过。正式公开上线前仍需重新确认适用的告知、单独同意及其他数据处理要求，当前删减后的文本不能作为上线合规完成的证据。

内部核验资料：

- https://supabase.com/legal/customer-resources/data-processing-addendum
- https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq
- https://lbs.amap.com/pages/privacy/
- https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm （第十条）

真实短信的下一项依赖仍是独立 RAM 凭证；开通服务和添加测试号码不等于已授权项目调用。现有配置助手只安全写入并核对服务端密钥，保持发送关闭，不发送短信。后续仍需绑定 Auth Hook、限制测试号码并完成一次明确授权的真实收码验证。

同日已通过 `scripts/prepare-sms-hook.ps1 -Prepare` 预配置并回读：Auth 的 Send SMS Hook URI 匹配已部署函数、Auth/Edge 共用签名密钥摘要匹配、独立幂等摘要密钥已写入。`external_phone_enabled`、`sms_autoconfirm`、`hook_send_sms_enabled`、Edge `SMS_DELIVERY_ENABLED` 均为 false。没有修改其他 Auth 设置，没有发送短信。阿里云 RAM ID/Secret 及测试手机号白名单仍缺失；不能把本次安全预绑定视为真实短信登录完成。

截至 2026-11-19，微信小程序保持个人主体，继续走短信验证码；App 一键登录仍是前端安全准备，不是已上线功能。用户已亲自开通阿里云服务，控制台回读显示短信认证、融合认证、号码认证已开启，图形认证未开启。开通云产品不等于原生 SDK、服务端登录或真实收码已经验收。

- `src/config.ts` 的个人主体与微信手机号开关保持原值；未打开任何手机号能力开关。
- Android/iOS 当前是 Capacitor 8 容器；仓库没有阿里云号码认证原生 SDK，也没有 `FishingPhoneAuth` 原生实现。JavaScript 的 `registerPlugin` 只是代理声明，不等于 SDK 已接入或已通过取号检测。
- `supabase/functions` 当前没有 `phone-login`；已有前端请求路径不是已部署功能。本轮不部署假桥接、不签发自造 JWT、不伪造 Supabase session，也不发短信或调用运营商取号。
- 微信服务端 Secrets 已由配置流程写入并回读核对；本清单不读取或记录值。配置 AppID/AppSecret 不会赋予个人小程序手机号能力，也不能代替 App 运营商 SDK。
- 原生会话已改为 Keychain/Keystore 安全保存；启动、轮换、退出和切号的本地模型测试已补齐。尚未完成原生真机重启和锁屏验收，不再使用旧版仅内存策略。

## 认证的权威来源与状态

手机号的真实性必须由微信或运营商服务端证明；账号归属与可刷新会话必须由真正的认证系统确认。前端只能收集一次性证明并调用受控服务端，不能信任客户端提交的手机号、用户 ID、`user_metadata` 或任意 Token 来创建账号会话。

| 状态               | 判定与行为                                                                             |
| ------------------ | -------------------------------------------------------------------------------------- |
| 不可用             | 体验模式、错误平台、开关关闭、缺少后端公开配置或原生插件时，不调用 SDK、不发送认证请求 |
| 可尝试             | 原生 Android/iOS、发布开关与插件均满足时，只显示用户可主动点击的入口；不宣称已可取号   |
| 已同意并检测       | 用户主动同意后，才调用原生环境检测；检测失败不提交授权，短信可用时可切换               |
| 授权中             | 原生页展示运营商、掩码号码及完整协议；取消、拒绝、无 Token 都不能提交认证              |
| 交换并验证         | 服务端验证一次性证明后返回真实会话，前端检查完整性与未过期，再保存                     |
| 已取消或账号已变化 | 页面失活、登出或切换账号后，异步成功和失败均不得改写新账号状态                         |

这些状态由 `src/services/phone-login.ts` 编排，纯能力规则在 `src/domain/phone-login-capability.ts`。页面负责展示入口、协议与错误，不负责证明手机号真实性。

## 本轮前端接口

- `operatorEntryAvailable()`：纯本地平台、配置与插件注册检查，不调用供应商方法；结果只表示可以让用户主动尝试。
- `operatorAvailable()`：兼容旧导出，仅在显式 SDK 检测成功后为真；不用于代替点击时的再次检测。
- `checkOperatorAvailability({ consent: true, isActive })`：用户同意后才检测 SDK；不支持、异常或错误形状的结果均视为不可用，不暴露供应商诊断。
- `operatorPhoneLogin({ consent: true, isActive })`：内部先检测再授权；调用者不用在加载页面时预先检测。`isActive` 应关联本次页面/操作，离开页面即返回 `false`。
- 微信兼容方法仍保留，但个人主体和非微信小程序平台一律拒绝；本轮不增加微信一键登录 UI。
- `AUTH_CANCELLED` 表示用户取消，页面可静默返回；`CONSENT_REQUIRED` 表示尚未同意；重复授权返回 `AUTH_IN_PROGRESS`。SDK 原生适配应把供应商取消/切换其他登录方式的回调规范为 `AUTH_CANCELLED`，不要把多次 UI 回调误当最终成功。
- 两条登录路径均使用 `authSessionFromResponse` 验证 `access_token`、`refresh_token`、用户 UUID 和有效期；每个异步阶段核对 `sessionScope` 与页面活动状态，只有全部有效才能 `saveSession`。

## App 阿里云开通前置项

以下项目必须拿到真实配置并完成验证后，才能评估启用发布开关：

1. 用户在阿里云确认开通号码认证的一键登录产品、费用及额度，创建 Android/iOS 对应认证方案；这不等于已开通短信认证或普通短信服务。
2. Android 包名目前为 `com.diaoyouji.fishing`（`android/app/build.gradle`）。提供实际发布证书对应包签名，与认证方案一致；调试签名、正式签名和应用市场重新签名不能混用。不得将私钥或 keystore 密码提交到仓库。
3. iOS Bundle ID 目前为 `com.diaoyouji.fishing`（`ios/App/App.xcodeproj/project.pbxproj`）。确认真实 Apple 开发者团队、签名与方案绑定，准备可进行蜂窝取号的真机。
4. 从阿里云控制台获取对应平台 SDK 和认证方案所需信息，核对版本、授权与平台要求。方案 SDK 配置应按供应商文档管理；云 API 的 RAM/STS 服务端凭据不能混入 `VITE_*`、WebView、客户端源码或日志。
5. 原生实现 `FishingPhoneAuth.checkAvailability()` 与 `authorize()`：懒初始化，用户同意前不初始化、预取号或采集；注册插件时不得自动运行 SDK。检测结果规范为 `{ available: boolean }`；授权成功仅返回临时 `{ token }`，取消返回规范错误，不回传不必要的完整手机号。
6. 原生授权页保留运营商与产品协议、未预勾选的同意选项、取消和短信备用方式。处理超时、多次 SDK 回调、前后台切换与销毁，确保最终 Promise 只结算一次。补齐 SDK 隐私清单及真实运营者资料。

阿里云官方说明一键登录需要客户端 SDK 与服务端 API 两部分；Android 提供环境检测，iOS 需要集成相应 Framework。具体实施以正式选用版本为准：[Android 接入](https://help.aliyun.com/zh/pnvs/developer-reference/the-android-client-access)、[iOS 接入](https://help.aliyun.com/zh/pnvs/developer-reference/the-ios-client-access)、[认证方案字段](https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-createverifyscheme)。

## 服务端与 Supabase 会话仍待实现

- 只在已确认的 Supabase 项目中实施正式服务。原生临时 Token 必须由服务端调用阿里云 `GetMobile` 核验取号；校验实际方案、有效性、重放、频控与错误分支，不信任客户端手机号。服务端凭据使用最小权限，日志不记录手机号、Token 或 Secret。[官方服务端流程](https://help.aliyun.com/zh/pnvs/use-cases/best-practices-for-user-authentication)
- 另行设计并确认受支持的 Supabase 账号映射及会话签发链路：号码认证成功本身不是 Supabase 登录，不能用 `createUser` 的用户对象或手工签名 JWT 伪装成可刷新 session。需要可验证的访问令牌、刷新令牌，以及登出、撤销和账号归属策略；`setSession` 只是接受已有合法令牌，不负责把运营商 Token 变成 Supabase 会话。[Supabase 会话要求](https://supabase.com/docs/reference/javascript/auth-setsession)
- 现有请求形状 `{ provider: 'operator', token }` / `{ provider: 'wechat', phone_code, login_code }` 只是前端保留契约；正式后端应审核是否需要挑战值和幂等字段，再端到端更新。不可因为此路径已有调用方就宣称服务端完成。
- 未完成服务端认证、签名方案匹配、隐私协议和真机验证前，不打开 `VITE_OPERATOR_PHONE_ENABLED`。

## 个人微信小程序与短信的独立事项

微信官方手机号能力针对非个人且完成认证的小程序，个人主体不能因已配置 AppSecret 而绕过。用户已选择继续短信登录，不在本轮变更主体或新增微信取号能力。[微信官方说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)

普通短信服务与阿里云 PNVS「短信认证」是不同产品。用户已选择并亲自开通 PNVS 短信认证及融合认证；本账户控制台实际列出已通过的赠送签名 `恒创联众` 和登录/注册模板 `100001`。其额度独立，不能把普通短信试用额度当作可共用资源；赠送签名和模板不等于赠送短信。未购买套餐，未发送测试短信。[个人开发者短信认证指南](https://help.aliyun.com/zh/pnvs/use-cases/sms-verify-for-individual-developers)

短信服务端使用 `send-sms-hook` 发送 Supabase 生成的 OTP，最终仍由 Supabase `/auth/v1/verify` 裁决，不新增另一套验证码验证或会话签发。阿里云自定义验证码放在 `TemplateParam.code`，不调用 `CheckSmsVerifyCode`。HTTP Hook 验证原始请求的 Standard Webhooks 签名，并使用持久化账本阻止同一事件重复发送；账本不存手机号或验证码。[SendSmsVerifyCode 参数](https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode)、[Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)

### 短信启用门槛（服务端，禁止写入 VITE\_\*）

- `SEND_SMS_HOOK_SECRET`：与 Supabase Auth 中 Send SMS Hook 相同的 `v1,whsec_...` 签名密钥。
- `SMS_IDEMPOTENCY_SECRET`：独立随机 32 字节 Base64，用于持久账本的 HMAC 摘要；已有账本期间不要随意轮转。
- `ALIYUN_PNVS_ACCESS_KEY_ID` / `ALIYUN_PNVS_ACCESS_KEY_SECRET`：独立 RAM 用户的调用凭据，仅授予 `supabase/aliyun-pnvs-ram-policy.json` 中的 `dypns:SendSmsVerifyCode`。不使用主账号全权限密钥；微信 AppSecret 不能代替。
- `ALIYUN_PNVS_SIGN_NAME=恒创联众`、`ALIYUN_PNVS_TEMPLATE_CODE=100001`、`ALIYUN_PNVS_SCHEME_NAME=钓友集登录`：已核对的发送参数，仍须与实际控制台保持一致。
- `SMS_OTP_EXPIRY_SECONDS=300`、`SMS_MIN_INTERVAL_SECONDS=60`：待与远端 Auth 的 6 位验证码、300 秒有效期和频控配置统一后启用。
- `SMS_DELIVERY_ENABLED` 默认关闭；`SMS_ALLOWED_TEST_PHONES` 默认空。受控实发必须显式启用并配置用户确认的 `+86` 测试号码，空值或号码不匹配拒发。
- 必须先应用短信账本迁移并验证 RLS/权限，再部署函数。`verify_jwt=false` 仅对这个使用 Webhooks 签名认证的 Hook 生效，不影响其他函数。
- 当前不自动打开 Auth Phone / Send SMS Hook 或前端短信开关。先完成配置及零网络测试；取得用户对具体号码和费用的确认后，才做最少量真实收码。测试白名单不是公开上线模式，不能把本机契约测试称为真实短信验证成功。

2026-11-19 服务端准备回读：`send-sms-hook` 已部署至确认项目，版本 1、ACTIVE；`20261119083229_sms_hook_deliveries.sql` 已应用。远端账本为空，RLS/强制 RLS 均开启，anon/authenticated 无读取权限，service_role 仅能插入、读取及更新状态。该服务器内部表故意没有客户端 RLS policy，安全建议中的对应 INFO 不表示客户端可以访问。阿里云调用凭据、Hook secret、Auth Hook 配置、测试白名单仍待配置；未启用真实发送或宣称登录可用。

专用 RAM 凭据创建后，用户可在本机 PowerShell 7 运行 `pwsh -NoProfile -File scripts/configure-pnvs-secrets.ps1`，以隐藏输入填写 AccessKey ID/Secret；脚本仅写入已确认项目的 Edge Secrets 并校验摘要，不把密钥写入文件、命令参数或聊天。它固定保持发送关闭，不创建 RAM 用户、不扩大权限、不启用 Auth、不发送短信。运行前先按 `supabase/aliyun-pnvs-ram-policy.json` 为独立 RAM 用户授予最小发送权限；不要使用主账号 AccessKey。该脚本仅完成供应商凭据准备，不能代替 Hook 配置和真实验收。

## 验证边界与上线前验收

- `tests/phone-login.test.ts` 用内存替身执行实际服务模块及 H5/微信条件分支，覆盖未同意零调用、关闭/缺失能力零调用、插件注册不等于可用、检测异常、取消、空证明、畸形或过期 session、账号变化和页面失活。测试数据不是实际号码、运营商凭证或生产会话。
- 契约测试通过只说明前端安全规则符合预期；不代表阿里云 SDK 已集成、Supabase 桥接存在、短信已送达或真机已登录。
- 后续须在正式签名的 Android/iOS 真机覆盖：移动/联通/电信、双卡与数据卡选择、仅 Wi-Fi/关闭蜂窝/弱网、拒绝与取消、超时、切后台再回来、重复点击、切换账号、无效/过期/重放 Token、服务端限流、短信备用及登出后旧响应。模拟器与浏览器预览不能替代蜂窝取号验收。[阿里云设备与网络限制](https://help.aliyun.com/zh/pnvs/support/number-certification-related-faq/)
- 单独验收 Supabase 会话刷新、撤销、RLS 用户隔离；在完成 Keychain/Keystore 适配前，明确 App 重启需重新登录，不做持久登录承诺。
