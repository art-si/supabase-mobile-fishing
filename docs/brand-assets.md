# 钓友集品牌图像

生成日期：2026 年 11 月 19 日。

## 设计

以用户最后确认的图形为准：圆润鱼身、内凹且尾尖收圆的尾巴、下方收圆的聊天小尖角、三颗聊天点和一只眼睛。保留鱼与交流气泡的双重识别，不增加写实鱼鳍、鳃线，也不改成抽象环形。主色为湖水绿；头像采用反白鱼形，缩小后保留轮廓与圆点识别。

## 文件与用途

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `assets/brand/fish-symbol.svg` | viewBox 160 × 96 | 唯一鱼形几何源，含鱼身与尾部两个分层 |
| `assets/brand/fish-symbol.png` | 1600 × 960 | 同源透明底鱼形 PNG |
| `assets/brand/logo-horizontal.png` | 1728 × 576 | 带「钓友集」字样的高清透明底 PNG |
| `assets/brand/miniapp-avatar.png` | 1024 × 1024 | 小程序头像、App 图标素材，实色方形 PNG |
| `assets/brand/miniapp-avatar-master.png` | 2048 × 2048 | 同源高清头像导出，不是 imagegen 原始稿 |
| `src/static/brand/fish-{skin}-{mode}-{tone}-{layer}.png` | 640 × 384 | 三种皮肤 × 明暗 × brand/muted × body/tail，共 24 张主题分层 PNG |
| `src/static/web/brand/logo-horizontal.png` | 864 × 288 | 备用透明底横版 Logo，等比例导出 |
| `src/static/brand/apple-touch-icon.png` | 180 × 180 | H5 添加到主屏幕时的图标 |
| `src/static/brand/favicon.png` | 64 × 64 | H5 标签页图标 |
| `android/app/src/main/res/mipmap-*/ic_launcher*.png` | 图标 48 / 72 / 96 / 144 / 192；前景 108 / 162 / 216 / 324 / 432 | 对应五档密度的方形、圆形及自适应前景图标 |
| `android/app/src/main/res/drawable*/splash.png` | 保留各现有画布尺寸 | 同源静态原生启动资源，含 night 明暗变体 |
| `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | 1024 × 1024 | iOS 安装图标 |
| `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png` | 2732 × 2732，共 6 张 | 同源静态原生启动资源，含 3 张 dark 变体 |

表中尺寸以 `scripts/generate-brand.mjs` 的导出配置为准。源码静态访问路径为 `/static/brand/文件名`，H5 网页图标在 `index.html` 引用。`FishMark` 使用同源主题 PNG 分层，覆盖首页、登录、加载、空状态、鱼情字段、默认头像、钓友圈底栏和设置版本区；H5 启动直接内联同一 SVG，均跟随皮肤与系统外观，详见 [鱼形视觉系统](fish-visual-system.md)。横版 PNG 供项目介绍和其他品牌展示使用。

修改源图或主题色后运行 `pnpm brand:generate`。脚本会重导全部品牌资源并更新 `assets/brand/generated-manifest.json`；`pnpm test` 核对源图、配色、每张资源的尺寸与哈希，防止某个平台停留在旧版。运行时分层 PNG 采用 640px 宽高分辨率输出，小尺寸仍保持清晰；眼睛和聊天点是真实透明留白，不是棋盘格背景。

高清原图和上传头像保存在项目根目录的 `assets/brand`，不放入页面静态资源目录，避免重复进入小程序包。

小程序头像文件可在微信小程序管理后台手动上传。仓库内保存图片不会自动修改微信后台头像。Android / iOS 品牌资源由同一脚本写入现有原生工程，仍需重新打包并在真机检查，文件导出不代表安装或发布已完成。

头像保留了圆形显示所需的边缘留白，不要再把鱼形放大到图片边缘。横版 Logo 适合浅色底；深色页面使用浅色承载面。所有生产图形从 SVG 源导出，不单独重画某个平台的鱼形。

## 生成与导出记录

初始横版 Logo 和头像由内置 `image_gen` 生成；原始稿保留在 `assets/brand/archive-v1`，后续概念及精修预览作为设计历史保留，不作为另一套运行时图形。最终轮廓按用户最后确认图统一到 `assets/brand/fish-symbol.svg`，由 `scripts/generate-brand.mjs` 同源导出主题分层、Logo、头像、H5 与原生品牌资源。

初始完整提示词保存在同目录 [brand-prompts.md](brand-prompts.md)，本轮内置 imagegen 精修探索提示保存在 `assets/brand/refinement-prompts.txt`。最终以用户提供的 `assets/brand/reference-round-tail.png` 为形状参考；该参考图含棋盘格，仅供对照，不作为运行时素材。实际截图、构建和真机验收结论见 [鱼形视觉系统](fish-visual-system.md)，不沿用历史结果。
