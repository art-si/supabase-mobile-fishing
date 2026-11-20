# 评论拍照平台边界

2026-11-20。评论拍照入口仅在微信小程序和 Capacitor App 显示，普通 H5 网页隐藏。`canUseCamera()` 判断编译平台和真实 Capacitor 原生环境；`chooseCommentCamera()` 在普通网页中也会直接拒绝，既不加载 Camera 插件，也不使用文件选择器冒充拍照。

小程序委托共用的 `chooseMediaFiles(1, ['image'], 'camera')`，实际调用 `uni.chooseMedia`。App 使用固定版本 `@capacitor/camera@8.2.6` 的 `Camera.getPhoto`，来源明确为 `CameraSource.Camera`、后置相机、URI 结果，不自动保存到相册。此 API 在插件 8.x 仍可用，官方自 8.1 起提供新 `takePhoto` API 并将旧入口标为 deprecated；当前按既定接口使用仍受支持的真实相机入口。见 [Camera 官方文档](https://capacitorjs.com/docs/apis/camera)。

返回的本地 `webPath` 经读取后确认 JPEG/PNG 字节，使用真实文件大小并在进入队列前执行 8MB 限制。对象 URL 的释放交给共用上传器，删除、取消当前页面或账号切换的既有生命周期会释放它；release 本身幂等。上传仍经过既有图片预处理和服务端校验，不直接上传相机返回的原始定位元数据。取消拍照返回空数组；权限拒绝和读取失败显示就近错误，评论正文和已有附件不被清空，用户可以在系统设置中恢复权限后重试，或改从相册选择。

Uni H5 的当前源码会把 `document.visibilitychange` 转发为当前页 `onHide/onShow`，所以系统相机临时使 WebView 进入后台不能一概按离页处理。适配器从调用原生相机直到读取完成维护 handoff，且绑定发起页实例及 route；评论仅在原生 handoff 有效且 document 为 hidden 时保留待选照片。真正可见页面切换、组件销毁和账号变化仍执行既有失效／释放逻辑；原生照片返回和读取完成也复查发起页，阻止向其他页回填。

小程序相机请求期间临时监听官方支持的 `uni.onAppHide/onAppShow`。只有当前拍照请求、同一页实例及 route，并且已收到应用后台事件时，页面隐藏才视为系统相机切换；普通路由隐藏不放行。回前台复位状态，请求完成或失败解除监听；换页后的文件丢弃。来源：[应用级事件官方文档](https://uniapp.dcloud.net.cn/api/application.html)、[chooseMedia 官方接口](https://uniapp.dcloud.net.cn/api/media/video.html#choosemedia)。

原生工程已有 Android FileProvider 和 iOS 相机／相册用途描述。已补充当前评论拍照用途与插件要求的相册写入用途描述；当前调用 `saveToGallery: false` 不申请相册写入权限。Android 使用外部系统相机 Activity，无需为此添加相机或外部存储权限。依照 [Capacitor update 命令](https://capacitorjs.com/docs/cli/commands/update) 仅执行 `cap update android` 和 `cap update ios`，生成 Camera 的 Android 插件注册／Gradle 依赖及 iOS SPM／类注册，不执行 `sync` 或替换构建资源；两端现有入口 HTML 的 SHA256 保持相同。

设计参考为 Apple `privacy.md › Requesting permission`（用户使用时才申请）和 `feedback.md › Best practices`（就近提供可恢复信息）；UI UX 查询 `permission denial recovery` 命中 Error Recovery，采用明确下一步。

`tests/comment-camera.test.ts` 和 `tests/media-choose.test.ts` 共 15 项通过，验证普通网页零相机调用、真实插件调用参数、读取文件大小、对象 URL 单次释放、取消、拒绝、不可用插件、无效及超限数据、小程序来源限制，以及 handoff 清理、AppHide/Show 监听解除和换页后丢弃迟到照片。`scripts/test-comment-camera-handoff.mjs` 的 4 项实际 Uni 生命周期集成检查通过：系统相机临时后台返回接纳一张照片，普通后台正常失效，实际离页再返回丢弃迟到照片，退出账号后丢弃并释放。这些使用延迟相机桥和隔离本地图片，未使用硬件拍摄或真实上传。

当前 Windows 环境有 Java 21，但未配置 Android SDK（无 local.properties／SDK 环境变量／默认 SDK 目录），也没有 Xcode，未构建安装原生二进制；真机仍需验证权限首次授予／拒绝后恢复、取消拍照、实际图像上传，以及操作系统回收 App 进程的恢复表现。H5 截图由评论界面任务记录。
