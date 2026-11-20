# 渔获计量实现与交接

2026-11-20。此文记录本轮计量改动，不代表发布页整体或三端真机验收完成。

## 数据规则

- 动态新增选填尾数 `posts.count`、鱼长 `posts.length_cm`。空值表示未知，尾数 0 表示空军；多尾时鱼长填写最长一尾。
- 输入可选公斤或斤，切换单位换算已填数值；所有 API 仍传公斤。单位只存在本机草稿，不成为数据库中的第二套重量。
- 私人日志的每条渔获可选自己的重量单位，合计以公斤计算；存在未知重量时不把部分和显示为总重。
- `posts`、`trips` 的公斤列保留范围约束，移除 `numeric(10,3)` 的强制三位小数，避免 0.001 斤换算后被静默取整。仅在旧日志合计曾被舍入时，由原始 `catch_records` 修复合计并增加版本号；部署前真实项目待修复数为 0。
- 新建、私有编辑、共享修改稿、作者回读、审核对照、审核通过、清空都使用同一字段。旧客户端省略新字段时保留现值；显式空字符串表示清空。既有权限、版本、幂等、媒体及审核流程不变。
- 不以 `count` 字段是否存在判断动态／日志，`postEditDraft` 以动态独有的 `kind` 判断，避免新增尾数后误带私人日志明细。

## 实现与设计

- `src/domain/catch-measurements.ts`：数字校验、公斤／斤换算。
- `src/components/CatchWeightField.vue`：组合 Pro 的 `MobileField` 和 `MobileSelect`；重量和单位同组，小屏或大字自动纵向排列。未修改生成的 `src/_mobile-core`。
- `TripCatchesEditor`、动态编辑页、`FishFacts`、`PostCard`、本机体验库已接入。
- 遵循项目 apple-design 的 Entering data、Text fields、Segmented controls 参考与 ui-ux-pro-max 的表单标签、反馈规则。计量字段留在选填详情内，不增加首页装饰或额外入口。

## 真实 Supabase

- 项目仅 `tlfmfokyhahlpzmpliad`，部署迁移 `20261120005601_fishing_catch_measurements.sql`。文件最初由 CLI 创建，按 MCP 实际迁移版本重命名对齐。
- 部署后回读：新增列、无强制三位小数的重量、日志合计触发器、审核字段及修改稿校验存在；`post_catch_fields` 对 authenticated 不可执行。
- `posts`、`trips` RLS 开启；anon、authenticated 均无 posts 的直接 INSERT／UPDATE／DELETE 权限。回读时线上动态及日志均为 0，本轮没有创建真实验收用户、业务内容或短信。
- 安全建议回读与改动前一致：14 项内部服务表无客户端 RLS policy 的 INFO，既有 Auth 泄漏密码防护 WARN。此轮未改 Auth 设置。

## 已有证据与尚未完成的部分

- 在另一个任务写入新发布规则前，12 项相关 Node 测试通过；全量 PGlite 641 项通过，其中新增 16 项覆盖计量新建、编辑、旧客户端遗漏、非法数字、权限、修改稿隔离、审核安装和清空。证据：`artifacts/catch-measurements-unit.log`、`artifacts/catch-measurements-db.log`。这是当时源码的本机测试，不能作为后续并行改动完成后的回归结论。
- 浏览器首次实际跑通了隔离 PostgreSQL 的新建／斤换算／重新编辑回填；发现小数尾数错误文案被通用错误覆盖，已修为本机校验文案。已查看失败截图进行修正。
- `scripts/catch-measurements-flow.mjs` 已集成到 `scripts/composition-flow.mjs`，包含 320／375／440／横屏／宽屏、三皮肤、深色 24／32px、键盘焦点、单位弹层、保存／清空。**当前完整浏览器验收未通过**：另一个任务新增必选位置后，旧 composition flow 未填位置，最新失败在 `artifacts/composition/contract/failed.png`；此前中间态还出现一次初始 library 400。不能将这些截图或中间态构建标成通过。
- 尚未运行本轮真实浏览器业务验收、小程序构建、App 资源同步或真机验收。当前 5181 正式预览仍是上一轮地图版本。

## 已授权的统一交接

用户已明确允许向“生成钓友集小程序Logo与图像”聊天发送协调消息，并由它完成发布页统一验收。已发送字段、迁移、测试与失败原因；本聊天停止写共享发布页／模型，避免覆盖该聊天正在实现的视频、必选位置、日期时间、预设／自定义选项。

接手时应保留计量改动，并将新位置必填规则纳入上述单元和浏览器测试。其待部署的位置／视频迁移必须基于已经在线的计量函数，避免用旧定义覆盖新增字段。整合后再执行本机数据库、正式 H5、真实 Supabase 临时用户、微信构建和 App 工程验证；依然不能用构建替代微信／原生真机验收。
