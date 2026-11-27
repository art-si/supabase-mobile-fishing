# 安卓模拟器验收（2026-11-24）

用户最初要求先在安卓模拟器验证再交付，随后明确要求现在提供安卓包。已提供可安装的正式接口测试签名 APK；当前尚未完成全部验收，下面的待验收项继续保留。

## 环境

- Android Emulator 37.3.10，Pixel 6，Android 15 / API 35，x86_64。
- Windows WHPX 硬件加速检查通过；ADB 设备 `emulator-5554`。
- SDK、Gradle、镜像及 AVD 位于 `D:/spa/.artifacts/android-toolchain`，未纳入仓库。
- JDK 21，Gradle 8.14.3，compile/target SDK 36。
- AVD 名称 `Diaoyouji_API35_20261124`。
- 定位测试使用明确注入的 WGS84 坐标 `114.180, 30.500`。这是模拟器测试坐标，不是手机真实 GPS 精度的验收证据。

## 已完成

- 正式 H5 资源通过 Capacitor 同步至安卓工程，未使用 demo 构建。
- `:app:assembleDebug` 成功，应用 ID `com.diaoyouji.fishing`，版本 0.1.0 / 100。
- APK 包含 arm64-v8a、armeabi-v7a、x86、x86_64，已安装到模拟器。
- `NativeShellInstrumentedTest` 在模拟器通过：实际 Android WebView 加载 `https://localhost` 页面、Camera/Geolocation 原生插件注册、非体验模式、启动页面无横向溢出。
- 首次进入显示定位门禁；点击请求位置弹出 Android 系统定位授权。
- 授权并取得模拟器位置后进入正式首页，真实钓友圈内容可见。
- 找钓位、我的、短信登录、密码登录页面可打开；目前停在密码登录页，等待用户直接输入账号密码。
- 此轮未修改此前验收正常的下拉刷新实现。

## 未完成，不能据此宣称通过

- 真实账号密码登录及重新启动后的会话保持。
- 地图首次最近水域、缩放稳定性、点选、拖动水内保留/陆地吸附，以及 2D/3D。
- 发布草稿、相机返回、相册图片/视频、评论键盘与发送。
- 举报默认水域、事发地区、当地官方渠道。
- 安卓下拉刷新、横屏、大字、深色与系统返回键。
- 安卓实体手机 GPS、相机及性能复验。

## 证据和交付限制

- `artifacts/android-emulator-20261124/` 保存启动、定位、首页、找钓位、我的及登录截图、原生测试日志和 `acceptance.json`。
- 当前 APK 为模拟器验收使用的 debug 签名构建，业务配置为正式接口。尚不是应用商店发布签名包。
- 交付路径：`artifacts/android-packages/diaoyouji-0.1.0-live-test-20261124.apk`（11,199,763 字节）；APK v2 签名验证通过，哈希与模拟器已安装版本一致。
- 当前 APK SHA256：`BE1276BD457400E168749F64889544CCB33B732BB58B71E41E1843C11D0618B0`。
- 后续有任何代码或资源变更，须重新同步、构建、安装，并更新验收证据及哈希。
- 用户密码由用户在模拟器输入，不在对话或测试日志中收集。
