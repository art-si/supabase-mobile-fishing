# 上传格式兼容

本轮扩展发生在本机准备阶段。所有图片仍经服务端重新编码，视频仍经既有 H.264/AAC MP4 校验和隐私元数据清理；没有通过修改扩展名或放开服务端原片写入来冒充支持。

## 图片

头像裁剪、动态、评论、线索材料复用 Pro 图片准备器。JPEG、PNG 沿用既有路径；WebP、GIF、BMP、AVIF 在解码能力允许时转换为 JPEG 副本。动图保存静态首帧，透明像素使用白色背景。原片不改动。

H5/Capacitor 的 HEIC、HEIF 由业务注入的本机解码器处理，使用固定版本 libheif-js 1.23.5，在用到这种格式时才启动独立 Worker。先核验真实容器、文件大小和主图尺寸，再生成限定尺寸的 JPEG；拒绝 SVG 和伪造 MIME。不请求第三方转换服务，也不把照片传给公共转换站。队列一次只运行一个 HEIF Worker，完成、失败、取消和超时均终止 Worker。相册中的多帧图片只使用主图。

微信端优先使用设备自带图像处理，输出必须再次确认是 JPEG/PNG；手机系统不支持的格式会保留原片并给出可恢复提示。没有把浏览器 WASM 解码器打进小程序包。

HEIF 对接依据：[libheif-js 官方用法与尺寸/显示接口](https://github.com/catdad-experiments/libheif-js)。浏览器实际解码证据为 `artifacts/heif-image/result.json`；测试 HEIC 使用项目自有品牌图生成，非网络照片。该检查不代表所有手机和所有相机编码组合。

## 视频

统一视频准备器先检查真实容器和音视频轨道。已经兼容的 MP4 不重复转码；其他可读取来源由 H5/Capacitor 按需加载 Mediabunny，重封装或转换为通用 MP4，再经过服务端原有验证。不能静默丢弃音轨，不以改后缀替代转码。小程序仅调用实际系统压缩能力，转换后重新检查格式和音轨；设备不能完成时明确提示。

输入和生成结果继续遵守图片每项 8MB、视频每项 20MB 的限制。处理和上传分别显示进度，取消或会话变化使迟到结果失效，临时副本释放。支持的容器不等于该容器中每一种编码都能在每台设备解码；最终可用范围以转换结果验证为准。

实现依据：[Mediabunny 转换接口](https://mediabunny.dev/guide/converting-media-files)、[格式与编解码能力边界](https://mediabunny.dev/guide/supported-formats-and-codecs)。真实 Chrome 已验证 MP4/M4V 直通、MOV/MKV/MPEG-TS 重封装，以及 VP8/Opus WebM 转码；输出均通过现有服务端视频校验函数，音轨保留。包含转码中取消、输出超限及编码器不可用的明确失败，共8组，见 `artifacts/video-preparation/result.json`；未向远端写入测试媒体，不把本机接口契约替代小程序／原生真机验收。

共享上传组件保留原始文件供重试，另行持有转换后的预览副本：HEIC 转换后使用真实 JPEG 缩略图／全屏预览，MKV 使用转换后的 MP4 播放。移除、退出和账号变化释放原始与生成的临时地址，见 `artifacts/prepared-media-preview/result.json`。

## 依赖

- libheif-js 1.23.5：LGPL-3.0，原始源码、构建脚本及许可证见上述维护者仓库和 npm 包；使用其原版 WASM bundle，未修改解码器。
- Mediabunny 1.66.2：MPL-2.0，原始源码与许可证见 [官方仓库](https://github.com/Vanilagy/mediabunny)。按需载入，业务只使用本地文件来源。

运行时不下载未固定版本的远端脚本。包管理器锁文件记录确切依赖和完整性校验。

原始许可证随发行资源保留于 `src/static/licenses/`，依赖版本和来源见 `media-codecs-NOTICE.txt`。

## 最终集成验证

2026-11-20：全套270项单测、最终类型检查、H5及微信构建通过。首次全套并发检查有一个既有子进程启动超时；该文件单独6项和全套串行270项均通过，没有放宽超时或改动产品逻辑。

真实 Chrome 的头像流程使用 HEIC 经过裁剪／旋转生成 JPEG，再验证保存失败与重试；评论上传验证真实 HEIC 缩略图及全屏、MKV 转换视频实际播放推进，以及移除和账号退出释放全部临时副本。共享媒体的最终验收索引见 `artifacts/fishing-report-alignment-20261120/media-formats-final.md`。

H5发行产物也已直接运行其打包后的 HEIC Worker：真实图片生成128×128 JPEG，像素内容已查看，无开发源码或第三方请求，见 `artifacts/built-heif-worker/result.json`。微信包体审计通过且不含浏览器 HEIF/Mediabunny 解码代码，见 `artifacts/final-miniapp-audit-20261120.json`。Pro 的三个其他使用项目同步、严格类型检查和隔离H5构建全部通过，文档发布目录未变。
