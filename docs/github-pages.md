# GitHub Pages 静态发布

目标地址：[钓友集](https://art-si.github.io/supabase-mobile-fishing/)。此文档记录配置和本机验证，不表示已经推送或上线。

## 打包与预览

```powershell
pnpm install --frozen-lockfile
pnpm build:docs
pnpm preview:docs
```

预览地址是 `http://localhost:5182/supabase-mobile-fishing/`，监听 `0.0.0.0`，局域网可用电脑 IPv4 替换 localhost。使用纯静态文件服务，无 Vite 地图代理、无 History 路由回退；可以暴露 Pages 子路径下的资源问题。端口占用会报错，可通过环境变量 `PORT` 修改。不要双击 `index.html` 以 `file://` 打开。

`build:docs` 使用独立 pages 环境执行生产构建，在 `dist/pages/h5/` 完成构建和密钥检查，再将生成文件同步到 `docs/`。依据 `docs/.pages-assets.json` 清理上一版的生成文件；已有 Markdown、`CNAME` 和其他非生成文件会保留。不要手动改生成清单或生成资源，也不要直接执行 `uni build --outDir docs`，以免清空项目文档。

继承 Pro 的相对资源路径 `base: './'` 和 `.nojekyll`，沿用 `src/manifest.json` 的 Hash 路由。详情链接格式为 `https://art-si.github.io/supabase-mobile-fishing/#/pages/settings/index`，刷新无需服务端重写，也不需要伪造 `404.html`。`build:h5`、`build:demo` 和原生同步继续使用原有 `dist` 目录。

## 环境配置

构建读取 `.env` → `.env.local` → `.env.pages` → `.env.pages.local`，后者覆盖前者；进程变量优先。`.env.pages` 固定真实模式和已确认 Supabase 项目，避免把本机高德代理带入静态包。公开 Key 继续从忽略提交的本机文件读取。首次配置可复制根目录 `.env.pages.example` 为 `.env.pages.local`；已有 `.env.local` 时，只需在 pages local 文件填写要覆盖的项。pages 模式不读取 `.env.production*`，也不影响普通 H5、体验版、小程序和原生构建。

| 变量 | 用途 |
| --- | --- |
| `VITE_SUPABASE_URL` | 固定 `https://jupuypvmgjpnpntfetqv.supabase.co` |
| `VITE_SUPABASE_KEY` | 真实 publishable／anon key；缺失时打包停止 |
| `VITE_AMAP_KEY` | 高德 Web JS 公开 Key |
| `VITE_AMAP_SERVICE_HOST` | 真实 `https://代理域名/_AMapService`，不能填 Pages 地址、本机路径或多级 Edge URL |
| `VITE_WATER_INDEX_BASE_URL` | 可留空，使用包内岸线资源；外置时需公开 HTTPS 和允许跨域读取 |
| `VITE_PHONE_AUTH_ENABLED` | 已验证真实短信服务后才能开启，打包不自动开启 |
| `VITE_OPERATOR_PHONE_ENABLED` / `VITE_AUTH_CAPTCHA_ENABLED` | 未完成真实能力适配时保持 false |

`VITE_*` 会进入公开静态包，不能放安全码、Web 服务 Key、service_role、secret key、数据库密码或短信凭证。构建拒绝危险的客户端变量，并扫描已知本机服务端凭证是否出现在产物中。公开 Key 是客户端配置，访问权限仍由 Supabase Auth/RLS 控制。[Supabase API Key 说明](https://supabase.com/docs/guides/api/api-keys)

## GitHub 设置

推荐直接发布已经打好的 `docs`：

1. 将源码和整个 `docs/`（含 `.nojekyll`、`.pages-assets.json`）提交到 GitHub 的 `art-si/supabase-mobile-fishing` 仓库。
2. Settings → Pages → Source 选择 **Deploy from a branch**，分支选择实际发布分支（当前本地为 `master`），目录选 **`/docs`**。
3. 保存后等待 GitHub Pages 部署完成，访问目标地址。以后重新打包并提交 `docs` 即可更新。

仓库也附带手动 Actions 工作流 `.github/workflows/pages.yml`。如采用此方式，Pages Source 改为 **GitHub Actions**，再手动运行 **Deploy prebuilt docs to GitHub Pages**。它上传已提交的 `docs`，不在 CI 重新构建，不需要复制 `.env.local` 或配置构建密钥。工作流使用完整 tar 保留 Uni 生成的 `assets/..-node_modules-*.js`；不要换成会排除点开头文件的上传方式。两种发布方式任选一种。[GitHub 发布源说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 高德地图所需的独立代理

GitHub Pages 只能托管静态文件，无法执行本机 `/_AMapService` 代理。高德 JS SDK 的代理要求一级路径 `/_AMapService`，不能直接使用 Supabase 的多级函数路径。[高德安全密钥与代理说明](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)

仓库提供 `deploy/amap-proxy.nginx.conf`，放入已有 HTTPS 代理域名的 Nginx server 块；它保留路径后缀、查询参数和真实来源头，转发到已确认项目的 `amap-js`。安全码仍只保存在 Supabase 服务端，浏览器、Nginx 配置和静态包均不需要安全码。

还需在 `amap-js` 的 `AMAP_JS_ALLOWED_ORIGINS` 中追加精确来源 **`https://art-si.github.io`**，保留现有本机、局域网和 Capacitor 来源；来源不含仓库路径，也不能写 `*`。高德控制台若启用了域名限制，也需允许实际站点域名。

当前尚未提供代理域名，因此 pages 默认留空；打包会明确提示「交互地图尚不可用」。这不阻止静态页面和其他已配置后端功能访问，也不使用假地图兜底。拿到真实代理后，在 `.env.pages.local` 设置 `VITE_AMAP_SERVICE_HOST`、完成服务器来源配置，再重新打包并真实验证地图。`configure-amap-cloud.mjs` 已补充自动加入 Pages 精确来源，但它会重新设置三个地图 Secret；执行前需在 `.env.local` 完整核对 `AMAP_JS_ALLOWED_ORIGINS`，不能只填新域名而丢失已有来源。本次仅补齐脚本，没有执行远端 Secret 更新。

## 验证

```powershell
pnpm test:docs
```

从 `docs` 启动普通静态服务，同时验证根路径与 `/supabase-mobile-fishing/`；检查所有生成资源、懒加载页面、Hash 深链刷新、真实模式入口、焦点和弹层。截图覆盖 320/375/440px、横屏、宽屏、深色及 150%/200% 文字，输出到忽略提交的 `artifacts/github-pages/`。

该脚本使用固定浏览器测试坐标通过现有位置门槛，拦截外部网络，只验证静态交付和页面交互；没有模拟登录成功、短信、地图或远端业务数据。它不能替代真实 GPS、GitHub 线上访问、高德代理、真实短信、小程序或原生真机验收。

2026-11-24 本机验收：218 个生成文件约 5.04 MiB，根路径及仓库子路径均通过；懒加载、深链刷新、217 个公开资源、焦点归还及上述视口截图通过，没有资源 404 或未捕获浏览器异常。已回看实际截图，布局与现有主题保持一致；检查依据为 Apple `layout.md` 的适配、`accessibility.md` 的大字、`sheets.md` 的关闭规则，以及 UI UX Pro Max 的视口和溢出规则。TypeScript 和独立目录微信构建通过，微信鱼形资源继续使用 `/static` 路径。

独立真实只读探测：以 `https://art-si.github.io` 来源请求已确认项目的公开鱼情接口，返回 HTTP 200 和条目结构；地图代理来源探测返回 HTTP 403 `MAP_ORIGIN_DENIED`（使用无效测试 Key，未调用高德上游）。因此后端公开读取已验证，Pages 地图来源白名单仍待实际配置；没有发送短信、创建账号或写入业务数据。GitHub 线上部署尚未执行。
