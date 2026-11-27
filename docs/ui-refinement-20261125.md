# 钓友集界面打磨 · 2026-11-25

## 结果

以 H5 为视觉基准，延续简单、实用、内容优先的方向。根据用户设置页截图反馈，将深海蓝、岩石灰替换为日出橙、莓果红，保留湖畔青；同时修复窄屏大字、禁钓卡片和微信组件留白问题。评估为 Good；实体设备的字体、输入法、权限与原生能力另行验收。

## 第二轮：详情、主页与长文本

继续沿用 H5 视觉基准及既有三套皮肤。本轮没有新增功能、颜色或导航，重点处理实际复现的长文本、空状态和微信排版差异。

- **High，已修复：320px / 200% 文字溢出。** 钓位详情的英文长地区名使页面达到 361px 宽，钓友主页的长标识与钓法使页面达到 465px。钓位元信息现在按可用空间换行，水域类型保持完整；主页文字列使用剩余空间，并允许长词换行。两页复测均保持 320px，无裁切或横向滚动。
- **Medium，已修复：长昵称使头像悬在中间。** 首页内容卡片和钓友主页的头像贴齐身份信息起始位置，昵称变长时不再跟随整段信息垂直居中。
- **Medium，已修复：详情作者触区偏小。** 整行作者入口沿用共同的 48px 最小触区，头像本身保持原尺寸。
- **Medium，已修复：空资料的孤立分隔符。** 城市、钓法均未填写时不渲染额外一行；只有一个字段时不显示多余「·」。以本机体验完整数据结构验证空字段状态，未写远端。
- **Medium，已修复：微信隐藏组件多占间距。** 同尺寸基线中，钓位主体为 H5 372.16px / 微信 388.18px，操作区为 64px / 72px。空来源组件和非本人操作组件的宿主分别多占了 16px、8px 间距。修复落在 `SpotSourceActions` 和 `ContentOwnerActions` 的组件定义，适用于各调用处，没有修改生成文件。
- **Medium，已修复：禁钓印章的明暗切换。** 印章增强可见性的滤镜跟随应用主题状态，避免 CSS 媒体查询尚未同步时，深色仍使用浅色处理、浅色反而被提亮。既有六组相反媒体查询的主题测试已补充印章断言。

设计依据仍为已读取的 Apple `layout.md › Adaptability`、`typography.md › Ensuring legibility`、`color.md › Best practices` 及跨平台参考。UI UX Pro Max 的 `text reflow narrow layout` 查询命中 Text Reflow and Spacing、Chip Collection Reflow，用于完整保留文本和按空间重排；本轮没有引入组件库或新的布局框架。

| 本轮检查 | 结果 | 证据 |
| --- | --- | --- |
| H5 页面与状态 | 120 项通过；320 / 375 / 440px、横屏、宽屏、深色、大字、焦点与弹层 | `artifacts/ui-depth-20261125-visual.log`、`artifacts/ui-depth-20261125/visual/` |
| H5 实际交互 | 37 项通过；包含主题持久化、取消、Escape 回焦和本机记录操作 | `artifacts/ui-depth-20261125-h5.log` |
| 长文本与主题压力检查 | 85 项通过；新增详情 / 主页 / 首页的七种视口与文字组合，以及印章主题同步检查 | `artifacts/ui-depth-20261125-stress.log`、`artifacts/ui-depth-20261125/stress/` |
| 空资料与溢出复验 | 三页常规 / 200% 长文本均不溢出；空资料无多余行 | `artifacts/ui-depth-20261125-after-layout.log`、`artifacts/ui-depth-20261125/after/` |
| H5 / 微信同尺寸 | 最终源码的首页、钓位详情、主页共 15 处宽高，0 差异、0 异常；保留真实安全区，允许 1px 舍入 | `artifacts/ui-depth-20261125-paired-current.log`、`artifacts/ui-depth-20261125/paired-current/measurements.json` |
| Android WebView | 三套皮肤 × 明暗 × 设置 / 首页 / 钓位 / 主页 / 发布，共 30 项；另有两页 200% 长文本，共 32 项通过，0 页面异常、0 远端业务请求 | `artifacts/ui-depth-20261125/android/acceptance.json`、`artifacts/ui-depth-20261125/android/` |
| 类型与资源检查 | 类型检查通过，颜色与品牌资源 4 项单测通过；H5、微信正式构建通过 | `artifacts/ui-depth-20261125-typecheck.log`、`artifacts/ui-depth-20261125-unit.log`、`artifacts/ui-depth-20261125-release-*.log` |
| 微信原始产物审计 | 28 路由、600 文件，主包原始字节 1,806,155，低于仓库 1,843,200 预算；这不是微信上传后的包体积 | `artifacts/ui-depth-20261125/miniapp-package.json` |

微信自动化曾在页面切换或截图时超时；全场景补跑中断在发布页，未将未完成场景当作通过。恢复窗口、结束 Android 模拟器后，针对本轮三个页面重新完成 15 项测量和实际截图，脚本正常退出。早期失败记录保留。配对脚本移除了页面准备好之前无必要的预热截图，保留每个实际场景的截图和重试检查。

本轮 Android 使用独立本机体验包 `com.diaoyouji.fishing.uiqa`。WebView 的 32 项检查通过，但操作系统截图仍发现模拟器「系统界面没有响应」弹窗，点「等待」后恢复，复验截图为 `android/native-window-rechecked.png`。这项结果仅证明 WebView 页面渲染与隔离检查，不代表模拟器系统稳定性或实体机验收；大字为 CSS 文字缩放，系统字体与键盘另验。完成后已恢复 Android 生成资源为正式 H5 构建，并关闭此次独立模拟器。H5 长页固定底栏、Android 截图与实体设备的边界继续按本文后续说明区分。

对照截图：[钓位修复前](../artifacts/ui-depth-20261125/before/spot-320-32.png) / [修复后](../artifacts/ui-depth-20261125/after/spot-320-32.png)，[主页修复前](../artifacts/ui-depth-20261125/before/person-320-32.png) / [修复后](../artifacts/ui-depth-20261125/after/person-320-32.png)。

## 第一轮配色

| 皮肤 | 浅色强调色 | 深色强调色 | 表现 |
| --- | --- | --- | --- |
| 湖畔青 | `#0F6B5B` | `#79CEB8` | 保留现有默认 |
| 日出橙 | `#C14B13` | `#FFAB70` | 温暖、鲜明，浅色阅读面与白色内容卡片 |
| 莓果红 | `#C62959` | `#FF97B5` | 饱和莓红，深色下使用柔和粉红强调色 |

配色唯一来源仍为 `src/domain/appearance.ts`。保留旧的 `ocean` / `stone` 存储标识，使已有选择直接映射到新配色；不增加迁移分支。交互文字、按钮、选中边框、预览、弹层和鱼形均同步。16 张相关鱼形分层 PNG 由既有 SVG 生成器重新导出，默认图标和品牌轮廓不变。

三套皮肤 × 明暗两种模式 × 14 组语义色对，共 84 组均满足 4.5:1。日出橙强调字与浅色选中底为 4.59:1，与白色为 4.90:1；莓果红强调字与浅色选中底为 4.71:1。既有颜色单测与资源哈希测试均通过。

## 修复

- 附件标题复用 `section-head`，数量整体保持一行；320px / 200% 文字下不再拆成「0 /」和「6」。
- 举报渠道标题占剩余宽度，地区摘要保留自己的空间；短地区名「全国」不再被挤成两行。
- 互动按钮允许内容重排，七位计数保留完整内容，不挤出自己的触区；评论正文与其他正文共用至少 16px 的字号 token。
- 禁钓卡片直接继承应用主题文字色，消除媒体查询尚未同步时出现深色字的问题。灰度内容透明度由 0.62 调整为 0.72，互动动作不再整体降低透明度。三皮肤明暗的正文合成对比度均达到 4.5:1；保留独立红色禁钓印章。
- 删除、举报等条件动作组件使用虚拟宿主。微信不再因不可见的组件宿主在卡片内多留一个间距；业务权限和操作行为保持既有逻辑。

公共 Pro 组件未手改，`src/_mobile-core` 未直接编辑。此次修改的是钓鱼业务组件、主题和验证脚本。没有修改数据库、RLS、Edge Function 或远端业务数据。

## 设计依据

已读取本项目 Apple Design 的 accessibility、layout、typography、color、dark-mode、buttons、sheets、tab-bars、designing-for-ios 和 cross-platform 等相关参考。

- `accessibility.md › Vision`：“Support larger text sizes.” 用于 150% / 200% 文字及完整计数。
- `layout.md › Adaptability`：“Be prepared for text-size changes.” 用于标题、数量及地区摘要的自然重排。
- `typography.md › Ensuring legibility`：“Use font sizes that most people can read easily.” 用于正文 16px 下限。
- `color.md › Best practices`：使用有角色的明暗颜色与可见的选中标记，不仅依赖颜色表达状态。

UI UX Pro Max 查询 `text reflow compact labels`，命中 Chip Collection Reflow、Text Reflow and Spacing、Form Labels；色彩查询命中社区玫红参考，结合本项目方向调整。Vue accessibility 查询没有数据库匹配，因此实现依据现有 Vue / Uni 源码及通用规则，没有引入新的组件库。H5 同时参考了 [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md) 的内容重排、焦点和语义控件要求。

## 项目 skills

从 `supabase-mobile-note` 的 `858be04d9eac4d3d73abc76995a4197547d5608b` 复制以下 7 个 skills，来源文件 SHA256、路径与导入日期已写入 `skills-lock.json`：

- `ponytail`、`ponytail-review`、`ponytail-audit`：复用与简化，以及按需的复杂度审查。
- `project-code-quality`、`professional-ui-quality`、`web-design-guidelines`：已改为钓友集的模块归属、系统字体、48px 触区和 H5 基准。
- `wot-ui-v2`：优先复用 Pro 的 `Mobile*`，按已安装版本查询组件，不另建主题体系。

复制内容中的司机端默认提示、颜色与字体要求已调整；保留相关参考文件。7 个 `SKILL.md` 均通过 skill-creator 校验。已有 Apple Design / UI UX Pro Max 保留原版本。没有引入与本项目无关的迁移、脚手架或工作流 skills。

## 验证证据

下表中的界面数据均为明确标注的本机体验或隔离接口样例，不代表真实账号、短信、GPS、上传、地图或发布验收。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| H5 页面与状态 | 120 项通过；320 / 375 / 440px、横屏、宽屏、深色、150% / 200% 文字、焦点及弹层 | `artifacts/ui-refinement-20261125-visual.log`、`artifacts/ui-refinement-20261125/visual/` |
| H5 交互与主题 | 37 项通过；保存与重载、存储失败重试、弹层主题、取消优先、Escape 回焦、日志删除 | `artifacts/ui-refinement-20261125-h5.log`、`artifacts/ui-refinement-20261125/h5/` |
| 长文本、计数和对比度 | 43 项通过；长昵称、七位互动数、附件数量、独立于媒体查询的主题及禁钓印章 | `artifacts/ui-refinement-20261125-stress.log`、`artifacts/ui-refinement-20261125/stress/` |
| H5 / 微信同尺寸测量 | 390×844，27 处宽高，0 差异、0 运行时异常；允许 1px 舍入，底部安全区单独扣除 | `artifacts/ui-refinement-20261125/paired/measurements.json` |
| 微信新配色 | 日出橙、莓果红的浅色 / 深色，共 4 张实际渲染截图；0 异常 | `artifacts/ui-refinement-20261125/native-colors.json` |
| Android WebView | 独立包 `com.diaoyouji.fishing.uiqa`，三皮肤明暗的设置 / 首页 / 发布，共 18 项页面检查；无横向溢出或远端业务请求 | `artifacts/ui-refinement-20261125/android/acceptance.json` |
| 类型与相关单测 | 类型检查通过；主题与删除相关 14 项通过，品牌资源与主题 4 项通过（其中主题 2 项重复） | `artifacts/ui-refinement-20261125-typecheck.log`、`ui-refinement-20261125-unit.log`、`ui-refinement-20261125-brand-unit.log` |
| 正式构建 | H5、微信构建通过；产物独立于既有发布目录 | `dist/ui-refinement-20261125/release/` |
| 微信包体 | 28 路由；本地原始主包 1,805,938 字节，预算检查通过；不是微信上传分析值 | `artifacts/ui-refinement-20261125/miniapp-package.json` |

微信开发者工具曾保留旧编译缓存；清理本轮体验项目的编译缓存并重新打开后，已以实际截图确认新名称和配色，再进行最终 27 处测量。没有清理账号、会话或用户存储。

全页截图中的固定底栏可能出现在截图时的视口位置；Android WebView 的长页拼接还可能重复固定区域，因此布局判断以节点测量及视口截图为准。Android 验收使用只读模拟器和独立体验包；CSS 明暗样例不等同于 Android 系统主题事件或实体设备验收。

Android 模拟器冷启动曾出现「系统界面没有响应」，WebView 的 18 项检查不能证明系统界面正常。选择「等待」后已恢复并重新截图；初始情况保留在 `android/native-window.png`，恢复后的实际系统窗口见 `android/native-after-wait.png`。此记录不作为启动性能、输入法或原生系统组件验收。测试完成后，工程内的 Android Web 资源已恢复为本轮正式 H5 构建；独立体验包没有覆盖已有正式测试应用。

实体 Android / iOS、手机微信、读屏、真实相册与键盘、系统字号和原生权限仍需设备验收。当前 Windows 环境没有完成 iOS 原生构建或真机运行。

## 截图

- [H5 新主题选择](../artifacts/ui-refinement-20261125/h5/skin-ocean-light-440.png)
- [H5 莓果红深色](../artifacts/ui-refinement-20261125/h5/skin-stone-dark-440.png)
- [微信日出橙](../artifacts/ui-refinement-20261125/native-ocean-light.png)
- [微信莓果红深色](../artifacts/ui-refinement-20261125/native-stone-dark.png)
- [Android 莓果红深色](../artifacts/ui-refinement-20261125/android/莓果红-dark-settings.png)
- [大字附件数量和地区摘要](../artifacts/ui-refinement-20261125/stress/polish-media-report-200.png)
