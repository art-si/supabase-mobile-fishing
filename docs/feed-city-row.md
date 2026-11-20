# 首页同城行

2026-11-20。仅调整 `FeedView.vue` 的同城行模板和局部样式：定位图标、城市名和下拉箭头成为无底色的紧凑动作，说明移至右侧；保留 48px 点击区、键盘焦点和原有公共城市弹层。窄屏、大字和长城市名允许自然换行，没有修改默认定位、城市存储或 Feed 查询逻辑，也没有修改共享组件。

采用 Apple `layout.md › Visual hierarchy / Adaptability` 的对齐、相关信息分组和大字重排，`buttons.md › Best practices` 的可识别操作及完整触区，`accessibility.md › Vision` 的 200% 文字；颜色沿用已有语义色。UI UX `compact inline control wrap` 查询中的 Compact Control Semantics 用于保留按钮语义、可访问名称、键盘操作和明显焦点。

`scripts/test-feed-city-row.mjs` 的 4 组检查通过：六种布局无色底／边框且无横向溢出；键盘打开原有 CityPicker 并继续改变同城查询；点击定位图标区域同样打开选择器；200% 字号下长城市名保持在完整动作内。实际截图覆盖 320、375、440、横屏、宽屏、深色 200%，另有键盘焦点、原有弹层和长城市名，共 9 张，均已查看。结果位于 `artifacts/feed-city-row/`，使用隔离 Feed 和定位回调，没有真实 GPS 或远端写入。
