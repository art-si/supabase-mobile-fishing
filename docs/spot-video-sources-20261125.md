# 视频来源与评论焦点验收 · 2026-11-25

本轮使用项目 Apple Design、UI UX Pro Max、Ponytail、工程质量与 Supabase 技能；野钓入库规则按用户明确要求调整。只操作已确认的 `jupuypvmgjpnpntfetqv`。

## 已完成的改动

评论输入面板的外侧 1px 焦点线被自身滚动容器裁切，四边测得留白均为 0。业务容器添加 `box-sizing: border-box; padding: 2px`，给焦点线留出空间。修改在 `src/components/SpotCommentsSheet.vue`，复用同一份 H5、小程序、App 业务组件，没有修改生成的 `_mobile-core`。

野钓不再被“只能是钓场”的提取提示、地点核验和数据库发布条件拦下。有原文有名定位、实际垂钓证据、有效日期，且坐标同城并未命中当前禁钓范围的自然水域、水库可以发布。原文没有明确坐标时仍不能借湖库中心点发布。

原文坐标提取只接受匹配当前原帖身份的 `contentLocation.geo`，或明确地点、坐标系和经纬顺序的正文片段。原始坐标与证据一同保留。WGS84 经高德转换为 GCJ-02，再逆地理编码核对城市与区县。坐标不传给模型，也不采用模型生成的坐标。作者住址、发布者位置及推荐内容不参与定位。

原文定位使用自己的坐标身份，不制造高德 POI 编号。相同地点保留旧互动键，同名不同位置进入待核验；禁钓守卫、服务端权限、任务租约和 14 天有效期继续生效。搜索适配器的查询与结果过滤已支持野钓和平台视频链接，但远端未配置全网搜索，当前仍以公开频道、人工找到的原文和公开分享收件箱提供线索。

## 自行寻找与真实远端结果

通过公开网页搜索自行寻找抖音、B 站、头条、小红书及快手线索。成功找到可定位到原文 URL 的视频包含 [B 站武昌江滩视频](https://www.bilibili.com/video/BV1ds5f6cEFQ/)、[抖音武汉视频](https://www.douyin.com/video/7709852151624229219)、[武汉钓位投稿视频](https://www.douyin.com/video/7686899050062351679)和[张之洞钓场视频](https://www.douyin.com/video/7709583031078856787)。这是候选来源，不是已经发布的地点；征集类资料也不能替代实际垂钓证据。

`data/spot-video-candidates-20261125.json` 保存四条规范候选链接，一条已在库，新增入队三条。同时重新排队九条曾被旧版本标为 `unsupported_source` 的平台原文。12 条全部完成远端核验，队列没有遗留本轮任务：

| 实际结果 | 条数 | 含义 |
| --- | ---: | --- |
| `content_identity_unconfirmed` | 8 | 抖音、头条返回内容无法确认是目标原帖，不能把脚本页当作视频资料 |
| `unreadable_article` | 2 | B 站页面没有可核验的正文 |
| `robots_disallowed` | 1 | 抖音精选禁止该采集器读取 |
| `event_only` | 1 | 可读材料仅证明赛事，不足以证明日常对外开放 |

这批自动核验新增公开地点 **0**，当时没有取得可用的视频鱼获帧。该批核验后的公开目录有四处，武汉三处、岳阳一处。定时任务 `fishing-spot-source-sync` 处于启用状态，每五分钟执行，当时的搜索结果为 `search_unconfigured`。

本机按同一采集器读取四条候选，也得到不可读或原帖身份未确认；结果在 `artifacts/spot-focus-20261125/original-probe.json`。另外尝试普通浏览器查看 B 站视频，创建页后读取持续超时，未取得可核验画面。没有用封面、测试图片或生成图片代替视频中的鱼获。

### 武昌江滩原片人工复核

钓鱼侠土豆张在 2026 年 5 月 18 日发布的《路亚飘虾武昌江滩》中，00:06 字幕写着“直接导航武昌江滩1号门”，01:21 在临水台阶举鱼。两张截图均来自 BV1ds5f6cEFQ。[B 站原片](https://www.bilibili.com/video/BV1ds5f6cEFQ/) · [入口字幕](../data/spot-source-evidence/BV1ds5f6cEFQ/BV1ds5f6cEFQ-00m06s-gate1.jpg) · [鱼获截图](../data/spot-source-evidence/BV1ds5f6cEFQ/BV1ds5f6cEFQ-01m21s.jpg)

高德的 1 号门位于武昌区积玉桥街道临江大道 604 号，GCJ-02 经度 114.315744、纬度 30.577536。高德逆地理编码返回同名门点，距离为 0 米。已在远端钓位线索表保存该入口、原片时间点和截图文件引用，目录状态为 `review`。具体下竿位置仍待核实。[高德门点](https://www.amap.com/place/B001B16FIF)

官方[抖音视频搜索说明](https://developer.open-douyin.com/docs/resource/zh-CN/dop/ability/search-management/item-search)当前将该能力标为未对外开放，且限制通过该服务缓存、下载内容；不能把它描述成只差一个 Key 即可全站采集。坐标处理依据 [Schema.org contentLocation](https://schema.org/contentLocation)、[longitude 的 WGS84 定义](https://schema.org/longitude)、[高德坐标转换](https://lbs.amap.com/api/webservice/guide/api/convert)及[逆地理编码](https://lbs.amap.com/api/webservice/guide/api/georegeo)。

## 部署回读与验证

- 迁移 `20261125094531_fishing_wild_spot_coordinates.sql` 已部署，版本已回读并与本地文件名一致。
- `spot-source-sync` 已从 v13 更新到 **v14 ACTIVE**，保留函数内部专用令牌认证。
- 完成接口的 anon/authenticated 执行权限为 false、service_role 为 true；坐标身份助手未开放给 anon。
- 部署前后安全建议数量一致，没有新增建议；既有私有表拒绝访问策略和账号配置建议未改动。
- 31 项来源、导入、分享收件箱、禁钓及 PGlite 生命周期测试通过；完整数据库测试、TypeScript 检查及相关 Deno 检查通过。
- H5 评论交互与截图检查通过，包含 320、375、440、横屏、宽屏、深色大字、320px 深色 200% 字号；焦点线四边均有容纳空间，保留回复、附件、重试和翻页检查。H5、小程序构建通过。
- 已实际查看常规、320px、横屏和深色 200% 截图。截图与日志位于 `artifacts/spot-focus-20261125/`。本轮未重新进行微信/Android/iOS 真机验收；接口拦截测试不表示真实发送或上传。

![修复后的评论焦点边框](../artifacts/spot-focus-20261125/after/discussion/375.png)
