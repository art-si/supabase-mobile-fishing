# 动态所在位置

2026-11-20：新建尚未选过位置的动态，在 H5／Capacitor App 上获取一次本次位置，默认填入城市、区县。发布页可以继续输入，点击位置行进入地点列表；已有草稿位置、编辑旧动态和手动选点不会被自动定位覆盖。只有保存发布才提交位置，草稿坐标按既有规则降为 0.02 度网格。默认定位不自动回填家庭门牌，不以 IP 或默认地图中心冒充设备位置。选点页可查看定位地址、系统返回的误差和附近地点直线距离；主动选择详细地点后，该名称会回填草稿并在发布时展示。

地点列表复用 Pro 的 MobileSearch、MobileAction 和表单语义。搜索即时返回、支持中文输入法和键盘选择；当前选择与当前位置相同时合为一行。附近地点取真实高德 POI，点击直接回填，不额外弹出确认框。城市筛选按需展开，取消返回保留原位置。

H5／App 复用 `src/platforms/amap.ts` 的高德 JS Key、代理和原生定位适配；地点搜索不再误走需要会话的静态地图接口。个人微信主体继续按已确认能力使用服务端地点搜索，不调用未经开放的定位 API。微信搜索和静态地图依赖相应 Web Service 配置，H5 JS Key 不能代替该类型的 Key。

局域网 HTTP 不能取得浏览器定位。页面显示原因并保留搜索；支持的浏览器需要 HTTPS（本机 localhost 例外）及用户授予的位置权限。桌面截图和 SDK 模拟不能替代手机 GPS、微信或原生权限验收。

设计依据：Apple `entering-data.md › Best practices` 建议从系统预取可自动获取的信息；`privacy.md › Requesting permission` 要求在功能使用时说明用途；`maps.md › Best practices` 要求容易找到地点并清晰表达选择。本轮使用这些原则，不声称复刻微信的内部实现。UI UX Pro 的定向查询未找到专门的定位默认值条目，采用返回的表单标签／输入原则，定位状态和去重是本项目设计判断。

验证记录：

- `scripts/test-post-location.mjs`：六组隔离 SDK／会话流程覆盖自动回填、粗粒度存储、保留旧草稿、慢定位与手动选择竞争、拒绝权限、非安全 HTTP、即时联想和键盘点选。外部请求全部隔离，不等同真实登录或设备定位。
- `scripts/test-post-location-live.mjs`：真实高德 SDK／代理返回金鸡湖搜索结果、公开地标的逆地理名称和附近 POI；没有读取此电脑的位置，没有发送短信或发布内容。
- 实际查看 320／375／440px、横屏、宽屏、深色和 150%／200% 字号截图，检查焦点、自然换行和页面宽度。截图与结果在 `artifacts/post-location` 和 `artifacts/post-location-live`；截图发现的重复当前位置卡片和大字长占位已收敛。

涉及实现：`src/platforms/post-location.ts`、`src/components/PostLocationPicker.vue`、`src/pages/map/search.vue` 和发布页。平台服务及业务默认值留在钓鱼仓库，底层表单／搜索仍来自 Pro；没有手改生成目录。
