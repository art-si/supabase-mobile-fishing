# 「我的」与编辑资料：以 H5 为准的跨端验收 · 2026-11-25

## 改了什么

- 「我的」里头像和昵称保持一组，长昵称完整换行。简介在卡片上最多显示两行；点整张卡片能看到、编辑完整介绍。常规宽度保留右侧的「编辑钓友资料」，大字或空间不足时只有这个操作换行。没有照片时，两处都取昵称首字作为头像。
- 保留 H5 原有的输入面积。原先只设 `min-height`，H5 的 textarea 包装层和微信原生控件对内边距的计算不同。现在普通多行字段在钓友集皮肤中指定外框高度，并随文本行高增大；发布正文只覆盖所需高度。评论框仍用已有的紧凑布局，不改 Pro 生成目录。
- 从链接直接进编辑页，保存后也回到「我的」；按通常入口进入则沿用页面栈返回。后台读资料时已经开始输入，晚到的响应不覆盖草稿。昵称为空时错误就近提示并聚焦，取消放弃修改不会丢字。

按项目 Apple Design 的布局、文字和表单输入准则，以及 UI UX Pro Max 的文字重排和错误恢复规则验收。沿用现有头像、输入、按钮和确认框；没有新增组件、依赖或主题。

## 实测

默认字号，单位为 CSS px；H5 与微信对照宽 390px，Android 模拟器 WebView 宽 412px。原生状态栏、微信胶囊和底部安全区不拿 H5 的尺寸覆盖。

| 输入框外高 | H5 改前 → 改后 | 微信开发者工具 改前 → 改后 | Android WebView 改后 |
| --- | --- | --- | --- |
| 个人简介 | 102 → 102 | 80 → 102 | 102 |
| 发布鱼情正文 | 202 → 202 | 180 → 202 | 202 |

- **H5：**本机体验共 110 项检查。资料链路包含 320 / 375 / 440px、844px 横屏、1280px 宽屏、320px 深色 150% / 200% 文字；包括键盘进入、错误焦点、放弃修改弹层及继续编辑。另有 9 项隔离接口检查，含慢响应不覆盖新输入、头像裁切和保存失败重试。
- **微信：**H5 / 微信同宽测量覆盖钓友圈、我的、编辑资料、设置、发布、举报、钓位详情、钓友主页、鱼情详情。9 个页面共 45 处关键元素的宽高均在 1px 容差内（保留底部实际安全区），其中本轮三页占 16 处；[逐项尺寸](../artifacts/profile-parity/paired-site/measurements.json)。独立从编辑页进入，通过实际渲染的保存按钮返回「我的」，再开编辑页核对了长昵称和 112 字简介；测试后已恢复本机体验资料。
- **Android：**独立体验 APK 在 API 35 模拟器实际 WebView 运行；常规与深色 200% 文字下复查资料卡、完整编辑、错误焦点和弹层，两个输入框实测见表。没有覆盖正式安装包。这里的大字是受控页面字号，不是系统级字体测试。
- **构建边界：**类型检查、446 项单测、正式 H5 / 微信构建和小程序分包预算通过。数据是本机体验或隔离接口，不代表线上资料更新或上传已验证。iOS、微信和 Android 实体设备的输入法、系统字号及读屏尚待实机验收。

## 截图与复验

- 长简介：[原 H5](../artifacts/profile-parity/before/mine-long-375.png) → [改后 H5](../artifacts/profile-parity/h5/profile-summary-375.png)；[微信资料卡](../artifacts/profile-parity/paired-after/mine-long-weixin.png)、[微信完整编辑](../artifacts/profile-parity/paired-after/profile-long-weixin.png)。
- 大字号：[H5 卡片](../artifacts/profile-parity/h5/profile-summary-dark-200.png)、[Android WebView 卡片](../artifacts/profile-parity/android/profile-summary-device-dark-200.png)；另见[带原生系统栏的 Android 编辑页](../artifacts/profile-parity/android/native-editor.png)和[H5 放弃修改弹层](../artifacts/profile-parity/h5/profile-discard.png)。
- `node scripts/smoke-h5.mjs --ui-polish-contract` 使用本机体验 H5 的 `H5_BUILD_DIR`；`node scripts/test-ui-parity.mjs --only=mine,profile,compose` 使用同一版本的 H5、`MINIAPP_UI_BUILD_DIR` 和已开启自动化的微信 `MINIAPP_ENDPOINT`；正式构建的接口隔离检查用 `node scripts/test-profile-build.mjs scripts/test-profile-avatar.mjs` 并设置 `PROFILE_BUILD_DIR`。
