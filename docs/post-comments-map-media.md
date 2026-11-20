# 鱼情、评论与地图打开

2026-11-20。沿用现有公共交互，不新建第二套图片、视频或上传界面。

## 显示与评论

鱼情列表、详情和评论附件均使用紧凑等宽缩略图，单张也只占一个格。点击图片或视频才进入公共全屏预览，关闭入口和焦点返回一致。点赞使用同一图标库的拇指轮廓／填充状态，与成功勾选区分。

评论使用既有混合上传队列，最多6项图片或视频；允许文字、附件或两者组合。文字及Unicode表情仍在500字范围内。表情面板是Pro公共组件，选择后插入光标位置并回到输入框。上传失败、发表失败保留内容；重试相同内容与有序附件时复用同一个请求标识。原有回复、分页、删除、举报与隐藏流程保持。

## 点击地点

`FishingPlaceLink` 将已分享的地点交给Pro `MobileMapChooser`，提供高德／百度选择、复制地点及显式网页回退。不会读取或导出发布者未公开的原始坐标。

鱼情保存的是大致坐标，因此打开地图按地点名称查找，不把大致区域当精确导航终点。通用 `map-links.ts` 也支持被业务明确授权公开的精确地点；高德使用经度在前，百度纬度在前，并明确传GCJ-02。

H5手机按明确点按尝试打开地图应用；桌面使用官方网页。不用延时重定向把用户从已打开的应用拉回网页，也不探测或宣称手机已安装应用。没有打开时可主动选网页版或复制地点。微信个人主体端保留复制链接／地点后在地图应用访问的路径。

协议核对：[高德单点](https://lbs.amap.com/api/uri-api/guide/mobile-web/point)、[高德搜索](https://lbs.amap.com/api/uri-api/guide/search/search)、[百度Web](https://lbsyun.baidu.com/index.php?title=%E6%A8%A1%E6%9D%BF%3Auriapi%E7%9A%84web%E7%AB%AF)、[百度iOS调起](https://lbsyun.baidu.com/index.php?title=%E6%A8%A1%E6%9D%BF%3Auri%E7%9A%84iOS)。未用假链接代替已安装应用验收。

## 验收边界

`tests/map-links.test.ts` 验证URI参数编码、坐标类型／顺序、空坐标与大致地点；`scripts/test-post-map-actions.mjs` 验证点赞状态、列表／详情共用地图选择、六种布局、键盘关闭与焦点返回、显式回退。图片和视频测试使用真实本地文件解码，接口和外部应用调起使用隔离适配。设备应用安装、系统关联和真机跳转仍需设备验收。
## 评论框最终视觉复核（2026-11-20）

最终截图复核发现未聚焦输入仍有独立灰边：编译器将原规则的作用域属性加到了插槽内的 MobileField 控件上，而该控件实际拥有不同作用域，导致规则完全没有匹配。Pro 的 MobileCommentComposer 已将规则明确限制在自身输入区，使用 `:deep()` 作用于内部控件和原生 textarea；输入内部边框、圆角、背景、outline 与阴影清除，整体焦点框及工具按钮键盘焦点保留。

`scripts/test-comment-composer-frame.mjs` 的实际浏览器复核覆盖空态、带附件、回复、样式热更新后的回复各自聚焦／失焦8种状态，以及真实 Tab 焦点；逐层 computed style 断言通过。前后编译规则、量测和截图保留于 `artifacts/comment-composer-frame/`。最新视觉以该目录的 `attached-blurred-375.png` 和 `reply-focused-375.png` 为准；较早 `prepared-media-preview` 图片仅保留其媒体转换验证用途。修复后 H5 和微信构建再次通过。
