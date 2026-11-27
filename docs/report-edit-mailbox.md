# 私密线索编辑与邮箱资料

2026-11-20。本文件记录上报记录编辑及邮箱资料的实现边界；官方渠道目录和邮件编辑入口另由对应组件维护。

## 上报编辑

`update_water_report` 接收原记录 `id`、`expected_revision`、`request_id` 和完整的 `waterReportPayload`。它只允许记录本人编辑 `saved` 状态，更新后仍是私密保存，不表示已投递或官方受理。首次保存的时间和记录 ID 保持不变，`revision` 递增，`updated_at` 更新。

同一请求重试不重复修改；内容改变必须换请求 ID；旧版本修改返回 `EDIT_CONFLICT`，前端保留输入供用户处理。记录删除后，迟到编辑和重试不能恢复它。已保存的附件可保留、调序或替换；新附件必须属于本人且未挂到其他内容或头像，移除附件通过已有媒体清理队列撤销后续读取并清理对象。修改收据只保存请求摘要和记录关系，不另存私密文字或媒体链接；删除记录也删除收据。

数据库迁移：`20261120102700_fishing_water_report_edit.sql`。CLI 生成文件时间早于仓库已排定的迁移，所以调整到现有最新版本之后；执行部署与远端回读由主任务记录。此文不以本机测试冒充远端部署。

## 邮箱资料

设置与官方渠道共用 `ReportEmailContactSheet`，仅保存称呼和联系邮箱。数据按当前真实账号隔离，退出和注销时使用既有私密草稿清理流程移除。它不进入公开个人资料，不收取邮箱密码或 SMTP 授权码，也不假称邮箱已经验证。

联系邮箱用于提交文字中的回信资料，实际发件账号由用户在设备邮件应用中登录和选择。保存资料本身不会发送邮件；应用外的发送成功不能由本机资料设置推断。已填内容在保存失败时保留，错误显示在表单内，取消不改变已有资料。

## 设计和验收

复用 Apple `entering-data.md › Best practices` 的明确字段与就近验证、`sheets.md › Best practices` 的单一任务和取消入口、`buttons.md › Role` 的操作层级；使用 UI UX `quick-reference.md` 中 Inline Validation、Touch Target、Focus Not Obscured 和语义色规则，以及主任务查询命中的 Touch Target / Font Size Scale。没有增加新的色彩、装饰或导航体系。

H5 邮箱弹层实际截图覆盖 320/375/440、横屏、宽屏、深色与 150% 字号。横屏检查发现操作按钮可能被滚动区边缘遮挡，已改用共用底部操作槽，并断言两枚按钮完整可见。六种截图均已回看。

- `tests/water-report.mjs`：完整数据库检查 801 项通过，包含所有权、同请求重试、版本冲突、原记录保持、混合附件排序／替换、删除与迟到请求；这是 PGlite 本机 PostgreSQL 检查。
- `tests/report-edit-demo.test.ts`、`tests/report-email.test.ts`、`tests/private-storage.test.ts`：5 项通过，运行真实本机实现，覆盖同 ID 编辑、幂等／删除、邮箱格式／账号隔离及存储失败。
- `scripts/test-report-email-settings.mjs`：4 组 H5 交互通过，结果及六种实际截图位于 `artifacts/report-email-settings/`，使用隔离登录资料和请求适配，没有真实发送邮件。
- 类型检查通过。邮箱客户端配置、真实发送、微信／原生设备行为仍需在相应设备验收。
