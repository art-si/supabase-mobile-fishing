# 设置页设计验收

## 结论

评级 Good，通过本轮 H5 阶段评估。页面让钓友识别可进入的设置，区分退出与永久注销；沿用湖畔青、现有功能图标及鱼形品牌。小程序和原生设备仍待真机核验，不是 Apple 官方认证。

## 修改

- 设置和“我的”共用 56px 基准菜单行、16px 卡片横向内边距和 16px 右箭头，大字时行高可扩展。隐私说明和用户协议仍可从设置进入。
- “联系与反馈”展示微信群和个人微信的原始二维码。更换群码时同步更新 `src/pages/contact/static/wechat-group.png`、联系页中的有效期说明和截止时间。
- “我的”中编辑资料的文字入口补上箭头；账号安全的更换手机号、设置密码沿用导航箭头。复制、退出和主题选择保留各自明确的操作表达。
- 注销账号居中，使用 `--danger`。常规触区 48px，深色大字为 56px，文字行框实际中心与按钮中心相差不超过 0.01px。
- 在 320px / 200% 文字下，账号说明自然换行，主标题保持可读；箭头垂直对齐偏差不超过 0.5px。
- 保留注销的独立确认、不可逆说明和输入确认；验收只打开并取消，没有注销任何真实或测试账号。退出确认同样验收取消保留会话与草稿。

## 参考

已阅读本项目 apple-design 的 always-load、cross-platform，以及 lists-and-tables、settings、buttons、icons、managing-accounts。此次采用 `lists-and-tables.md › Platform considerations › Mobile` 的层级导航提示、`settings.md › Best practices` 的熟悉入口和精简设置、`buttons.md › Best practices` 的清楚动作含义。注销居中来自用户要求，不描述为 Apple 的强制布局。

UI UX Pro Max 采用 pro-rules 的统一图标、语义色、可见焦点、稳定触压和自适应布局；遵循既有设计方向，没有引入装饰、额外操作或开发诊断。

## 实际证据

`node scripts/test-user-copy.mjs`：4/4 通过，41 张截图。覆盖 320/375/440、844 横屏、1280 宽屏、深色、200% 字号、键盘焦点和弹层。所有外部请求均为本地契约，无短信、真实认证或远端写入。另在真实开发页实际查看完整设置页。

- `artifacts/user-copy-review/report.json`：导航箭头、触区、真实文字中心、错误／外部请求断言。
- `artifacts/user-copy-review/settings-actions-375.png`：常规设置页。
- `artifacts/user-copy-review/settings-actions-320-dark-200.png`：深色 200% 文字。
- `artifacts/user-copy-review/delete-confirmation-375.png`：确认弹层。

日间注销文字 `rgb(180,35,49)`；夜间 `rgb(255,173,181)`，均来自已有危险色。没有依赖红色作为唯一含义，入口保留明确的“注销账号”文字。
