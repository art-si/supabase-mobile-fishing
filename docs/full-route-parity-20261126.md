# 钓友集 · 跨端验收（2026-11-26）

以 H5 的内容、操作次序和控件为基准，保留系统字体、安全区和地图供应商的差异。[打开本机截图对照](../artifacts/full-parity-20261126/map-compare.html)。截图和日志保存在 `artifacts/full-parity-20261126/`，未上传用户资料。

| 样本 | 验收结果 | 证据 |
| --- | --- | --- |
| H5 · Chromium、WebKit | 本轮开始时的体验版各检查 28 个注册路由、12 个附加状态、7 个视口；每个引擎 280 张截图、290 条检查。包含跳转目标和选点上下文，不只检查页面能否打开。 | `chromium/routes.json`、`webkit/routes.json` |
| H5 · 交互 | 110 条页面交互检查；深色、大字、键盘焦点、长文案和弹层均有覆盖。审核页面另有 10 条隔离接口检查。 | `interaction.log`、`live-contract.log` |
| H5 · 正式配置、本机运行 | 北太子湖道路、岸线、地名实绘；7 种视口/字体组合。平移、双指缩放、3D → 2D、禁钓列表、琵琶湖公告和公开钓位详情均通过。使用测试坐标，未写入业务数据。 | `native-final-h5-water/result.json`、`native-final-h5-water/map-375.png`、`native-final-h5-water/official-pipa-detail-375.png` |
| H5 · 普通地点选取 | 金鸡湖真实高德联想 8 项；选择地点保留名称与地址，随后手点另一个位置，卡片和图钉均更新成新地址。320px 深色 200% 与横屏下，搜索、确认和禁钓控件均能点到。控制真实地图完成事件的交付时机，验证超时提示可读、晚到后无需重试即可恢复；此项是故障时序实验。 | `selected-h5-final/result.json`、`selected-h5-final/manual-place-375.png`、`selected-h5-final/selected-place-dark-large.png` |
| 表单回填 | 14 条隔离契约通过。钓位草稿 → 水域地图 → 地点搜索降级 → 北太子湖 → 返回原草稿，验证水名、城市、草稿名及没有自动发布。 | `map-contract-last.log` |
| Android · 界面 | Android 15 / API 35 模拟器中的真实 Capacitor WebView，412 × 842 CSS px；体验版 40 个状态截图、原生输入法弹出及焦点不被遮挡通过。不是物理设备。 | `android-light/routes.json`、`android-light/native-keyboard.png` |
| Android · 在线地图 | 将同一份正式 H5 资产打入独立的 Capacitor 测试包。在 API 35 模拟器使用宿主现有网络出口，收到了 58 次成功的底图瓦片响应。实测北太子湖、单指平移、双指缩放、禁钓列表、琵琶湖公告和公开钓位详情；未写入业务数据。此 WebView 不支持 WebGL，保留二维而不显示无效的三维按钮。测试后恢复模拟器网络设置。 | `verified-android-device/result.json`、`verified-android-device/map-android.png`、`verified-android-device/official-pipa-detail-android.png` |
| Android · 无法联网时 | 早先的独立模拟器直连高德 SDK 被断开；重试后能切换到地点搜索并看到登录提示。与接通网络后的在线地图分开记录。 | `android-relay-final/diagnostic.json`、`android-relay-final/recovery.json`、`android-relay-final/static-fallback.png` |
| 微信 · 登录后的在线地图 | 在用户已登录的微信开发者工具中，原生腾讯底图实绘。高德搜索北太子湖、保留候选的预览、选择后收起候选及显示选点均通过；通过原生 `MapContext` 读到 15 级相机和 0° → 40° → 0° 的实际倾角。不是手机号或真机 GPS 的认证。 | `wechat-native-comparison/search-verified/result.json`、`wechat-native-comparison/map-wechat.png`、`wechat-native-comparison/map-3d.json`、`wechat-native-comparison/map-2d.json` |
| 三端 · 同一条禁钓公告 | H5、Android、微信均显示琵琶湖核心区的红色标记与对应官方公告。微信分别从区域列表、原生地图元素的 `markertap` 事件打开同一公告；关闭后选点和视野保留。为使标记可见，微信通过地图点选事件对准已知公开水面，未替换地图、边界或公告。没有投票。 | `wechat-native-comparison/h5/`、`wechat-native-comparison/android/`、`wechat-native-comparison/official-pipa-map-wechat.png`、`wechat-native-comparison/sdk-pin.log`、`wechat-native-comparison/official-sdk-pin-detail.png` |
| 微信 · 钓位回填 | 从空白钓位草稿打开水域地图，选择北太子湖并确认，返回同一份草稿，核对水名、武汉市和草稿身份。本次新建的本地测试草稿已清理，未保存钓位或发布。 | `wechat-native-comparison/water-pick.png`、`wechat-native-comparison/spot-return-check.log` |
| 微信 · 定位与安全区 | 选普通地点保留图商地址。点「回到当前位置」后，原生相机回到授权的大致位置（11 级），没有误选水域或出现确认卡。390 × 844 的模拟视口中，三个地图按钮各 48 × 48；公告内容区底边为 810，与系统报告的底部安全边界相同。 | `wechat-native-comparison/ordinary-poi.json`、`wechat-native-comparison/location-list.log` |

## 已整改

- 复用项目现有 Pro 组件，统一 H5、微信和 App 的地图搜索标签、地图按钮的操作名称与三维选中状态。微信保留原生腾讯底图，用高德做地点搜索和地址解析。两套底图不要求道路、标注或图商署名逐像素相同。
- 微信和 H5/Android 复用同一张禁钓标记。经核验的多边形使用相同的内点定位；没有边界的记录只显示点，不把旧半径画成禁钓范围。禁钓标记与可拖动水域选点分开，点标记不会覆盖选点；武汉补充公告仍须通过官方出处、有效期与实际水面范围校验。
- 三处选点入口合用同一回填规则。没有发起表单时不留下孤立选点；暂存或返回失败就地提示，不替换整张地图；确认不会发布内容。
- H5、微信和地点搜索降级页共用普通选点的字段约束；直接选中地点时保留图商地址，手选不会沿用上一次地点的地址。没有可读地名时卡片仍可显示坐标。
- H5 与 App 取消安卓固定的 24px 地图底边，只预留实际安全区；三维按钮跟随渲染能力和实际相机俯仰角。超时状态隔离底图，图商后续完成加载则自动恢复同一张地图，禁钓边界预览也会清除过期错误。
- 不将多级云函数地址交给高德 SDK。静态 H5 和支持 Service Worker 的 Capacitor WebView 从一级 `/_AMapService` 连接既有后端；自定义一级 HTTPS 代理与 Vite 代理不变。没有放宽来源限制，也不缓存位置或转发账号凭据。
- 首次打开地图复用已通过权限门槛的 GCJ-02 定位；点击定位按钮仍重新取点。手选或移动选点时更新标记的位置和可访问名称。
- 尺寸覆盖 320、375、440、844 × 390 横屏、1280 × 900 宽屏、320 深色 150% 和 200%。网页截图不等于设备安全区、定位精度或屏幕阅读器真机认证。

## 验收边界

- `dist/full-parity/map-login-handoff/mp-weixin` 保留用户人工登录的会话；本次仅同步联调编译文件，保留原入口和 IDE 配置。未读取账号密码、验证码或令牌。新构建通过 28 路由和主包预算检查；属于原始文件体积检查，不是微信上传包分析。
- 早期体验截图只对应当时的产物。登录后地图修订的全量测试 **453/453**、联调类型检查、H5 和微信构建通过（`wechat-native-comparison/full-tests.log`、`wechat-native-comparison/package-audit.json`）。`MOBILE_PRO_ROOT` 指向联调 Pro 工作树；不能据此认定独立检出可直接发布。
- 静态 H5 在后端已授权的本机来源及仓库子路径运行，不冒充已发布的 GitHub Pages。Android 和 H5 使用同一组模拟位置、访问真实地图和公开读接口；不等于真机 GPS 精度或全部网络环境验收。
- H5 与 Android App 模拟器已通过平移及双指缩放。微信开发者工具收到自动化触摸，但相机没有移动，双指前后均为 15 级，故微信手势**未签收**（`wechat-native-comparison/gesture/result.json`）。手机微信仍需验证连续平移、双指缩放、拖动水域图钉后不回跳，以及两种系统的物理安全区；不能把组件契约或开发者工具当真机。
