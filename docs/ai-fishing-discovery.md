# AI 找钓位与水域围栏

「找钓位」在取得位置后直接加载社区钓位和同城的 `fishing_spot_leads`。公开库保存已核对的地点、地址、原文链接、发布日期、核验日期和推荐证据。后台读取免费公开源并逐条核对原文与地点，Art 可辅助提取证据。鱼情好、人少、环境好、停车方便和适合亲子作为有原文支持的卡片标签。经营场所需有实际垂钓服务依据；野钓视频和图文有明确原文坐标及垂钓证据，经城市与当前禁钓范围核验后也可发布。单独的赛事记录、缺少准确位置或命中禁钓范围的资料不发布；多个已核验来源可以链接到同一张卡片。2026-11-25 的部署及实际来源获取结果见[本轮验收](spot-video-sources-20261125.md)。

城市依次取搜索的市名、入口定位识别的城市、已选同城或社区列表中唯一的城市。作者公开了坐标时，按原坐标落点并以 GCJ-02 展示；原坐标和证据保留供核对。经营场所只有地点名称时，由高德按区县或城市核对 POI，唯一匹配后在列表中按距离展示；野钓缺少原文定位则保留待核验，不能使用整片河流或湖库的中心点。点击钓位名称可查看来源和原文，点击地址可查看定位来源和经纬度。小程序提供复制原文链接。

公开库已接入[全国来源核验流程](spot-source-pipeline.md)。此前的 24 条资料重新进入原文与地点核验，未通过的内容保留待核验。客户端不再回退到旧内置目录。定时任务读取官方 RSS、核对媒体与地方官方原文；前台仅读取已发布的同城结果。

## 导入平台分享

创作者可在「新增钓位 → 补充钓位信息」把自己的观察和有权分享的抖音、今日头条或 B 站作品链接一起保存。列表显示分享平台和有依据的鱼情标签，详情可打开原文并查看作者选定的水域。普通发布沿用钓位的分享范围。

项目服务端可以把抖音短视频、今日头条微头条和 B 站视频或动态的公开分享材料交给 `POST /functions/v1/spot-source-import`。请求使用钓友集的服务端凭证。每批传入一个完整城市名和最多 6 条分享，每条包含原文链接和短摘录。可带原标题、发布日、已核对的地址和 `poiName` 钓点名称。作品单独挂载的地点可以填入 `poiName`。作者公开了经纬度和坐标系时，可填写 `sourcePosition`（`longitude`、`latitude`、`crs`，支持 `GCJ-02` 和 `WGS84`）供预览核对。Art 从原文提取垂钓经历和标签。`preview: true` 只返回预览；默认把原文提交后台核验队列，不能直接写成已发布钓位。

一条分享列出多个钓位时，按地点提供对应的摘录和定位信息。作者使用简称时，可用 `poiQuery` 提供已核对的高德地点名供查询。公开库接收经核对的作者供稿和许可留存的材料。需要定期检索并导入平台作品时，应取得平台对检索和留存用途的许可。打开找钓位时读取已发布的同城钓位。

```json
{
  "city": "武汉市",
  "preview": true,
  "posts": [
    {
      "url": "https://www.douyin.com/video/7709583031078856787",
      "excerpt": "琴台大道张之洞遛鱼城市钓场。6小时练杆票。",
      "publishedOn": "2026-11-19",
      "location": "武汉市汉阳区琴台大道"
    }
  ]
}
```

Art 提取地点和可核对的标签证据。禁钓信息和证据不足的条目会被跳过。导入接口返回 `queued` 待核验数量，`published` 为 0；后台读取原文、核对日期和高德地点后才公开，同地点合并原文链接。尚无读取与留存许可的平台作品不会因为已绑定账号就自动入库。服务端凭证只在钓友集的后台使用。

抖音视频搜索的 OpenAPI 和 MCP 都需要获批的移动或网站应用权限。搜索规范限定用户发起搜索，限制结果留存。个人小程序的搜索能力用于发现小程序。 [抖音搜索规范](https://developer.open-douyin.com/docs/resource/zh-CN/dop/ability/search-management/item-search) · [抖音 MCP 接入](https://developer.open-douyin.com/docs/resource/zh-CN/dop/ability/mcp-service/mcp-service-desc) · [个人小程序能力](https://developer.open-douyin.com/forum/bulletin/post/6a54a7c57517f6158f590c87)

今日头条旧的投稿、视频数据接口已下线。火山方舟提供按量收费的头条图文搜索，抖音资源在当前价目表中对应抖音百科。B 站稿件读取需要创作者授权。批量导入使用现有 Art 服务。 [头条下线公告](https://developer.open-douyin.com/forum/bulletin/post/65437c6341dcfdfb21a9d9ce) · [火山方舟联网内容计费](https://console.volcengine.com/ark/region:cn-beijing/docs/online-content-plugin-pricing) · [B 站开放平台](https://open.bilibili.com/doc/)

火山引擎的联网问答 Agent 是独立产品，抖音视频信源也需要抖音开放平台授权和售前对接。 [联网问答 Agent 产品简介](https://docs.volcengine.com/docs/networked-qa-agent/product-overview-1?lang=zh)

## 入口定位

正式模式在应用入口检查位置，成功取得一次前台位置后开始读取业务数据。拒绝或撤回后显示重新授权提示，隐私说明可以打开。H5 使用浏览器定位，非本机的网页访问需要 HTTPS。Capacitor App 使用系统前台定位。微信小程序使用经微信开通的模糊定位接口，高德地点搜索和静态预览继续提供地点查询。微信包已声明对应权限，公众平台接口开通和真机授权需另行验证。 [微信位置接口](https://github.com/TencentLBS/tencentmap-miniprogram-skill/blob/main/references/wx_location_api/wx.getFuzzyLocation.md)

入口位置用于当次附近查询和排序。小程序或系统提供大致位置时，平台返回的距离显示为估算。App Store 的审核条款限制将系统定位设为整个 App 的使用条件，iOS 发布前需核对此产品设定。 [Apple App Review 5.1.2](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing)

「账号与安全 → 第三方账号」列出绑定状态。网站 OAuth 回调在原浏览器标签页完成，授权码与当前登录用户、平台和十分钟有效的状态匹配。每个平台账号只能绑定一个钓友集账号。数据库保存平台标识的摘要，绑定用于关联账号。平台密码、访问令牌和刷新令牌不写入数据库。

## 水域定位与围栏

- 水域地图的设备定位、点按和地点搜索共用水域匹配。点在水面时保留原坐标，点在岸上时选取最近的已收录水面或河道。手动点击的范围随缩放变化，限制为屏幕上的 160 个 CSS 像素，近景最多 2 公里，概览最多 60 公里。设备定位和地点搜索查找 2 公里内的水域。选中的名称同时用于搜索框、图钉和确认回填。
- 全国在线识别按位置读取水面、河道中心线和水域名称图层。河道可以用沿线名称标注，湖泊和水库的名称可以位于同一水体的其他图块。系统也在选中的水面或河线上核对高德的自然水域地名，以匹配底图上的当地称呼。点中已绘制水域且各来源都没有名称时显示「未命名水域」，名称服务暂时不可用时显示「水域名称待确认」。无几何数据时可选用查询范围内高德收录的水域地名坐标。[OpenMapTiles 图层定义](https://openmaptiles.org/docs/schema/) · [OpenFreeMap](https://openfreemap.org/)
- H5 按需读取矢量图块。微信小程序通过已登录的 `amap` 函数查询当前点的岸线和地名，沿用高德静态地图。两端均可复用已有的岸线索引，高德底图使用 GCJ-02，开放地图原始数据使用 WGS84。仓库的武汉局部分片含墨水湖及凤凰湖，保留来源和 ODbL 署名。[Overture 水域数据](https://docs.overturemaps.org/examples/overture-tiles/) · [墨水湖](https://www.openstreetmap.org/relation/6358285) · [凤凰湖](https://www.openstreetmap.org/way/879986063) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- 地图随视口自动加载已核实的政府禁钓边界。联网检索已配置时，登录后的武汉覆盖范围会自动查当地政府公告。只有公告明确全水域禁钓、起止日期均可核实且当前有效，才会按已收录的岸线绘制「公告线索」。部分水域需有可核实的官方边界。
- 将已公开且共享精确位置的钓位设为禁钓后，地图自动在上报点附近生成约 120 米提醒范围。匹配到已收录的岸线时按水面裁切，否则标记为范围待核实。详情可回到原钓位。可钓、私密、好友、隐藏和模糊位置不生成公开围栏。状态修改和删除会随地图下次读取更新。

### 刷新岸线数据

可选的自建全国岸线索引使用 Geofabrik 的中国区和台湾提取。导入器只保留面状水体及名称，并报告分片总大小和最大分片。当前仓库附有武汉样本，全国在线识别可直接使用矢量图块和水域地名服务。[中国区提取](https://download.geofabrik.de/asia/china/) · [台湾提取](https://download.geofabrik.de/asia/taiwan/)

```powershell
python -m pip install osmium shapely
python scripts/build-water-index.py artifacts/china-latest.osm.pbf artifacts/taiwan-latest.osm.pbf `
  --source-url https://download.geofabrik.de/asia/china-latest.osm.pbf `
  --source-url https://download.geofabrik.de/asia/taiwan-latest.osm.pbf
```

全国分片输出到 `artifacts/water-index/`。通过公开 HTTPS 静态域名发布，先上传完整版本目录，再替换 `manifest.json`。清单用短缓存，版本化分片用长缓存，开启 JSON 压缩。小程序在微信公众平台配置该 HTTPS 主机为 `request` 合法域名，H5 跨源部署需允许应用源读取 JSON。构建时将目录 URL 写入 `VITE_WATER_INDEX_BASE_URL`。发布新版清单和分片即可刷新岸线。正式上线前从各地选点回读，并在微信真机验证该域名可用。

客户端首次查找读取清单和当前约 0.25° 的一片岸线，同一区域复用缓存。个人主体小程序使用高德地点搜索和静态预览，选中地点后点击「查找附近水域」，可切换回原地点，发帖等选点回填仍用原地点坐标。全国文件保留在包外，微信包体检查会拒绝误打入的 `water-index/` 或原始 `.osm.pbf`。H5 开发可读取 `src/static/web/water-index/` 的武汉样本。生成器也接受 WGS84 水域 GeoJSON，属性为 `id` 和可选的 `name`，通过 `--snapshot` 记录源日期。

## 服务配置

钓友集的 `spot-discovery` 和 `water-fence-draft` 先校验登录和业务限制，再调用 Art 的 `ai-service`。所有模型任务跟随 Art 平台租户「业务助手」的供应商、模型、备用模型和生成配置。钓友集负责原文依据、可见性和围栏范围校验。

- 钓友集项目 `jupuypvmgjpnpntfetqv` 的 Vault 保存 `art-ai/fishing-client-token`，由服务端读取。Art 项目 `ckbftoopuyophiebamwy` 的 Vault 在 `art-ai-caller/fishing` 中登记该凭证的 SHA-256 指纹。
- 公开钓位采集由 `spot-source-sync` 定时读取免费官方 RSS 与地方栏目。`spot-discovery` 的公开目录读取不会触发媒体搜索或模型调用。保留的 Brave 适配器仅供以后取得服务端搜索凭证与留存权限后启用，本轮保持关闭。 [Brave Search API](https://api-dashboard.search.brave.com/api-reference/web/search/get)
- 在各平台审核通过的网站应用中登记同一个正式 HTTPS 回调 `<H5部署地址>/static/social-callback.html`，并将它写入 Edge Secret `SOCIAL_H5_CALLBACK`。平台密钥分别使用 `SOCIAL_DOUYIN_CLIENT_ID`、`SOCIAL_TOUTIAO_CLIENT_ID`、`SOCIAL_BILIBILI_CLIENT_ID` 及相应的 `_CLIENT_SECRET`。应用需开通基本账号信息的权限。当前从 H5 发起绑定。
- 抖音检索需要单独的内容搜索能力，其使用规则限制爬取、存储和下载。相关公开文档见 [抖音 OAuth](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/web-app/web/permission/)、[今日头条 OAuth](https://open.douyin.com/platform/resource/docs/develop/permission/toutiao-or-xigua/OAuth2.0/)、[B 站开放平台](https://openhome.bilibili.com/doc) 和 [抖音搜索能力](https://developer.open-douyin.com/docs/resource/zh-CN/dop/ability/search-management/item-search)。

H5 截图通过 `node scripts/test-discovery-ui.mjs` 生成。浏览器位置为测试注入，底图和岸线为真实数据。自动检索、模型和授权回调用例使用隔离接口的数据。
