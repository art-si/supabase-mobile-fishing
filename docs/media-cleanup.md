# 已删除附件的存储清理

2026-11-20 已部署到 `tlfmfokyhahlpzmpliad`。只对**已提交删除的 media_assets 记录**排队，不按文件年龄扫描，不删除未提交草稿，不回填历史孤儿对象。删除线索／动态等业务仍以原用户权限执行；数据库事务回滚不会留下清理任务。

私有队列记录不可复用的对象路径摘要，任务由服务角色领取，带 5 分钟租约、指数退避和最多 12 次尝试；超限或异常路径保留为失败供处理。对象使用 Storage API 删除，不通过 SQL 删除 storage.objects。完成后抹去队列中的原路径和作者 ID，只保留最小执行状态及防复用摘要。

Edge Function `media-cleanup` 每次最多领取 8 项，至多 4 个并发删除。请求不能提供对象路径或桶名。Cron 每 5 分钟运行，仅存在到期任务才请求函数。函数验证有效期 90 秒的 HMAC；长效签名密钥只放 Vault 和 Edge 环境中，未放进 pg_net 请求头。匿名请求实测返回 401。定时任务初始部署为停用，真实验证后启用并回读。

迁移：`20261120013958_fishing_media_cleanup_queue`、`20261120014001_fishing_media_cleanup_schedule`；媒体归属级联的后续兼容迁移由统一发布工作补充。内部删除触发器只能使用被删除的 OLD 记录，固定 search_path，普通用户没有私有队列和领取 RPC 权限；Auth 删除级联同样能够排队。

配置 `scripts/configure-media-cleanup.ps1` 只读取项目专用 Vault 条目，在子进程环境中交给 CLI 写入 Edge Secret，并核对摘要。脚本不打印密钥、不写密钥文件、不自动启用定时任务。新项目部署应先验证 worker，再通过运维操作启用准确名称的 Cron；不能仅凭构建通过启用。

验收证据：

- 独立 PGlite 队列 22 项与 Deno Handler 7 项；完整数据库迁移回归亦通过当时 665 项检查。它们是本地契约验证。
- Edge v1 部署后逐项回读文件一致；Vault／Edge 密钥摘要核对一致；匿名 POST 被拒绝。
- `scripts/test-media-cleanup-live.ps1` 使用一个临时账号和两张合成照片，证明普通用户删除私密线索后，索引撤回但对象仍在；真实 worker 删除该对象并完成任务，另一张未提交照片的索引和对象保持存在。随后撤销临时会话、删除确切测试对象及账号，回读全部为零。
- 真实通过批次 `699eabef-99a5-4f57-a97c-fa5eb6b31b54` 保留 `passed-cleaned`。此前两次验收脚本的请求编码失败发生在创建身份阶段，远端确认没有创建账号；失败记录仍保留，不冒充通过。
- 开启 Cron 后回读 `*/5 * * * *`、active=true；当时 6 项队列均 done，无残留路径／作者，anon 和 authenticated 不可领取。另从 cron.job_run_details 观察到 `2026-11-20 02:35:00 UTC` 的时钟调度成功；当次没有到期任务，直接返回，未无谓请求 Edge。

这不是对所有存储孤儿的回收器。上传中断但未建立索引的对象、历史遗留对象、备份和他人已下载副本不在本功能范围内。当前客户端对照片请求 60 秒、视频请求 300 秒的签名；这是客户端请求期限，不能当作 Storage 对所有调用者强制的签名上限，也不承诺已下载文件可追回。

参考：[Supabase Storage 删除对象](https://supabase.com/docs/guides/storage/management/delete-objects)、[Edge 定时调用](https://supabase.com/docs/guides/functions/schedule-functions)、[pg_net 请求头的可见性](https://supabase.com/kb/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357)。
