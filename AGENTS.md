# 钓友集项目约定

- 产品方向：简单、实用、大气，内容优先。首页不放装饰性口号、营销横幅或重复状态；技术配置收进设置。不要为了“惊艳”添加无用功能、渐变、图表或动效。
- UI 设计和审查必须使用本项目 `.agents/skills/apple-design/SKILL.md` 和 `.agents/skills/ui-ux-pro-max/SKILL.md`，先读相关参考，再改实现并用实际截图验收。主题、布局约定见 `docs/design-direction.md`。
- 架构复用相邻 `supabase-mobile-pro`。`src/_mobile-core` 是生成产物，禁止直接修改；通用组件或行为修复应归属 Pro 的 `packages/mobile-core/src`，钓鱼业务和皮肤配置留在本仓库。
- 必须区分真实远端、接口契约测试和本机体验。不得用假短信、假运营商认证或地图示意图冒充上线功能。个人微信主体使用短信、高德地点搜索和静态预览。
- Supabase 只操作已确认项目 `tlfmfokyhahlpzmpliad`；优先项目级 MCP。数据库迁移、RLS、Edge Function 变更遵循 Supabase 技能，部署后回读验证。服务端密钥不进入前端、日志或 Git。
- H5 监听 `0.0.0.0` 以供局域网访问。至少检查 320px、375px、440px、横屏、宽屏、深色、大字、焦点和弹层；构建通过不能替代小程序/原生真机验收。
