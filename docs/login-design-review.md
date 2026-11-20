# 登录相关页面设计评估

## Summary

**评级：Good。修正后通过本轮 H5 网页设计与交互评估；已完成用户授权的单次真实短信注册和密码设置。**

评估对象为短信登录、密码登录、找回密码，并回归设置密码、手机号换绑及账号安全入口。设计目标是让钓友用最少输入进入原账号，遇到错误能继续；湖畔青与一次鱼形品牌构成识别，不增加装饰。

使用本仓 `apple-design` 与 `ui-ux-pro-max`，结合源代码、实际运行截图、布局数值和真实点按检查。这里是项目阶段验收结论，不是 Apple 官方认证，也不代替微信／Android／iOS 真机验收。

## 本次发现与修正

### Medium · 设置导航提示与注销入口（已修复）

账号与安全、审核（有权限时）、隐私、协议、联系统一提供右侧 chevron，整行保留点击和焦点。账户注销为居中危险色，使用已有语义主题色；保留独立确认，取消不清理会话和草稿。200% 字号时账号行说明自然换到下一行。实际注销文字中心偏差不超过 0.01px，触区至少 48px；导航箭头垂直中心偏差不超过 0.5px。详见[设置页验收](settings-design-review.md)。

依据 `lists-and-tables.md › Platform considerations › Mobile` 的导航 disclosure indicator 和 `buttons.md › Best practices` 的明确操作；注销居中属于用户指定的项目视觉决策。

### Medium · 登录方式切换的文字没有真正居中（已修复）

- 原实现只将 160×48px 的按钮区域放在表单中间，文字仍为 `text-align:start`，实际文字中心向左偏 **30px**。先前只看容器尺寸的检查不足，用户指出的问题成立。
- 修改为业务页的明确布局：`display:flex; align-items:center; justify-content:center; text-align:center`，并保持点击区域大小。
- 运行中页面复测：按钮中心、文字实际行框中心、表单中心均为 **325px**，偏差 **0px**。新增回归检查分别量文字 Range、按钮、表单的中心；允许误差不超过 1px，覆盖正常字号与 200% 字号。
- 依据：`layout.md › Visual hierarchy`："Align elements to make them easier to scan"；将切换入口居中属于本项目的视觉判断，不声称 Apple 强制所有文字链接居中。

### Low · 协议相邻操作间距（已修复）

协议说明与独立协议链接的水平间距统一为 8px；保留点文字和点图标均可切换、点法律链接独立导航的行为。依据 `accessibility.md › Mobility` 对控件间距的要求，以及 UI UX Pro Max `Touch Spacing`。

## What works

| 维度       | 结果与证据                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 信息层级   | 一个任务标题、外置字段标签、单一主要操作；找回密码的“1/2”对应真实两步流程                           |
| 输入与操作 | 常规输入与主要按钮 56px；密码显隐、协议等触区至少 48px；键盘可达且焦点可见                          |
| 对比度     | 湖畔青明／暗模式，正文/页面为 13.51 / 15.31:1，辅助文字为 5.68 / 8.21:1，主按钮文字为 6.41 / 8.95:1 |
| 适配       | 320、375、440、横屏、宽屏、深色、大字和 200% 文字检查；验证码按钮按空间换行，不让功能消失           |
| 系统输入   | 手机号、当前／新密码和验证码分别提供正确的输入提示与 autocomplete；支持粘贴、密码管理器和前导零     |
| 错误恢复   | 字段旁说明错误，输入保留；发送／验证各有限流状态，操作中防重复提交，供应商诊断不直接展示            |
| 账号一致性 | 密码与短信进入同一个账号；换绑保留原 UUID；切号后清理旧页面验证内容，迟到结果不能覆盖新账号         |
| 精简与品牌 | 统一 Wot 控件与眼睛图标，鱼形只在品牌处出现；客服按需展开，允许先浏览                               |

引用的相关参考：

- `text-fields.md › Best practices`：独立标签、密码遮蔽、字段间距与逻辑 Tab 顺序。
- `entering-data.md › Best practices`：支持系统输入和粘贴，避免预填密码，及时提供校验反馈。
- `accessibility.md › Vision / Mobility`：文字缩放、对比度、可访问名称及触区。
- `layout.md › Adaptability`：根据可用空间和文字大小调整布局。
- `managing-accounts.md › Best practices`：延后强制登录，只呈现当前可用的认证方式。
- `icons.md › Best practices`、`toggles.md › Best practices`：统一图形语言、清楚呈现选中状态。
- UI UX Pro Max：`Form Labels`、`Error Placement`、`Autofill Support`、`Loading Buttons`、`Touch Spacing` 和 `Accessible Authentication`。

## Platform notes

- 以上数值为运行中 H5 的 CSS 像素和实际主题色；不能把 CSS px 当作所有原生平台的 pt / dp。原生导航、键盘遮挡、VoiceOver / TalkBack、微信胶囊仍需设备验证。
- 验证码输入支持系统建议与完整粘贴；200% 测试模拟网页文字放大，不宣称已验证原生 Dynamic Type 或真实短信自动识别。
- 协议默认勾选来自用户的明确要求，不是 Apple HIG 的推荐结论，也不代表隐私或法律审核通过。
- 本次页面没有引入新弹层。原有协议／隐私往返、错误、忙碌、帮助页往返与切号行为均按真实页面操作回归。

## Evidence

- 原短信登录本地契约：`artifacts/login-review/redesign/active/results.json`。
- 账号页面、文字中心与 200% 检查：`artifacts/account-security/results.json`。
- 本地契约统一拦截外部请求，不产生真实短信。真实短信的发送、接收和最终登录另记，不能合并当成已通过。
- 最新本地结果：原短信页面 11/11、账号相关页面 14/14、设置相关 4/4；钓友号输入、切换回短信时清理非手机号、复制钓友号、新登录复用验证及资料读取中切换账号已实际回归。
- 真实结果另见 `docs/account-security.md`：累计单次发送，用户确认登录、设置密码成功。系统短信建议／原生自动填充仍待设备验证。
