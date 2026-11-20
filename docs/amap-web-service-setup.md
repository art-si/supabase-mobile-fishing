# 高德 Web 服务 Key 接入

2026-11-20。目标 Supabase 项目仅为 `tlfmfokyhahlpzmpliad`。

用户提供的“钓友集服务端”Web 服务 Key 已写入 `AMAP_WEB_SERVICE_KEY`，远端摘要回读一致；真实地点搜索、静态图、缩放和天气已通过 H5 联调。微信／原生设备验收另行进行。

## 用户申请

1. 打开[高德控制台应用管理](https://console.amap.com/dev/key/app)，登录，按页面要求完成开发者注册。
2. 选择已有应用（此次使用已有的 `web` 应用），或创建应用“钓友集”。同一应用可以添加不同平台类型的 Key。
3. 添加 Key，名称可填“钓友集服务端”，服务平台选择 **Web 服务**。流程依据[高德官方说明](https://lbs.amap.com/api/webservice/create-project-and-key)。
4. 将 Key 填入项目根目录 `.env.amap-web-service.local` 的 `AMAP_WEB_SERVICE_KEY=` 后保存。该文件已被 Git 忽略；不要使用 `VITE_` 前缀或把 Key 发到聊天。

## 维护操作

`scripts/configure-amap-web-service.ps1` 默认仅检查上述文件，输出是否已填写，不访问远端。用户提供有效 Key 后，维护任务执行：

```powershell
pwsh -NoProfile -File scripts/configure-amap-web-service.ps1 -Apply
```

脚本检查项目绑定，只接受一个 `AMAP_WEB_SERVICE_KEY`，通过临时 env 文件写入；不把 Key 放入进程参数或输出。它沿用项目私有 CLI 包装器，写入后比较 Supabase 返回的摘要，最后删除本次临时文件。不会写入其他高德、短信或认证配置。CLI 参数已在本机 Supabase CLI 2.93.0 的帮助中核实。

摘要一致仅代表配置已写入。随后仍须用实际认证请求验证 `amap` Edge Function 的地点搜索和静态地图，确认 Key 平台、配额、接口权限及实际图像响应；小程序真机另行验收。

## 当前证据

- 已执行 `scripts/configure-amap-web-service.ps1 -Apply`，固定目标项目写入成功，`digestVerified=true`；Key 不进入前端、日志或 Git。原 H5／App 的 JS Key 与安全代理配置保持。
- 真实联调发现高德 V3 地点查询使用 `extensions=base` 时没有返回区县编码，导致已选地点无法查天气。已改为 `extensions=all`，仍只向客户端返回原有必要字段，不返回上游照片、电话或配置；依据[高德地点搜索说明](https://lbs.amap.com/api/webservice/guide/api-advanced/search)。`amap` Edge Function v16 已部署并回读，JWT 校验保持开启。
- Deno 类型检查与 `tests/amap_edge_test.ts` **16 项**通过；测试中的图商响应按请求模式决定是否返回区县编码，能复现本次问题。
- `h5-amap` **27 项真实远端检查**通过，批次 `7ffdc427-c6fb-45cd-8f6b-0f70a46855cb`。临时普通用户经真实 Supabase 会话调用真实高德服务；覆盖匿名拒绝、输入联想、公开地点与坐标、区县编码、静态图片实际解码、缩放、天气与观测时间。浏览器无未捕获异常；检查 320／375／440px、横屏、宽屏及 320px 深色大字，截图保存在该批次目录。
- 当前和两次定位问题的失败批次共 9 个临时用户已清理。MCP 按精确用户 ID 回读用户、会话、刷新令牌、资料、限流记录及媒体对象，六项计数均为 0；没有写入公开帖子、采集真实用户位置或发送短信。
- `node scripts/check-amap-bundle.mjs` 检查当前 789 个构建文件，两种服务端凭据均未进入产物。脚本同时检查 JS 安全码和本机已提供的 Web 服务 Key，不打印其值。
- `scripts/test-amap-secret-setup.ps1` 的 11 项离线检查通过，包含空输入、项目约束、单一配置、摘要不匹配、临时文件清理，以及进程参数和输出不含 Key。它在 `artifacts/amap-secret-setup/` 的独立目录使用假 Key 和替身 CLI，不读取用户 Key、不接触远端。

真实联调命令（使用既有临时账号与清理机制）：

```powershell
$env:FISHING_H5_URL='http://127.0.0.1:5178'
pwsh -NoProfile -File scripts/test-hosted-business.ps1 -Suite h5-amap
```

这验证了真实云端服务及 H5 中的静态地图页面，不代表微信请求域名、微信真机或原生签名包已通过验收。本轮未修改数据库结构、短信或 Auth 配置。
