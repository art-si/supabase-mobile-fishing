/** Public error copy is a whitelist, never a vendor response or SDK diagnostic. */
export const serviceErrorMessages: Readonly<Record<string, string>> = {
  CAMERA_PERMISSION_DENIED: '相机权限未开启，请在系统设置中允许钓友集使用相机，再点拍照重试。评论内容已保留。',
  CAMERA_UNAVAILABLE: '当前设备暂时无法打开相机，可从相册选择图片。',
  CAMERA_READ_FAILED: '未能读取刚拍的照片，请重新拍摄或从相册选择。',
  CAMERA_CAPTURE_FAILED: '本次拍照未完成，请重试或从相册选择。',
  SERVICE_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  PASSWORD_REQUIRED: '请输入登录密码',
  PASSWORD_INCORRECT: '手机号或密码不正确，可使用短信登录',
  PASSWORD_WEAK: '密码需为 8–64 位，包含字母和数字',
  ACCOUNT_IDENTITY_INVALID: '请重新登录后再管理账号',
  ACCOUNT_IDENTITY_MISMATCH: '验证的账号与当前账号不一致，请重新登录',
  ACCOUNT_FLOW_EXPIRED: '请重新打开页面后重试',
  PHONE_PROOF_EXPIRED: '验证已过期，请重新验证原手机号',
  PHONE_UNCHANGED: '新手机号不能与原手机号相同',
  NEW_PHONE_CODE_REQUIRED: '请先获取新手机号的验证码',
  NETWORK_ERROR: '网络连接中断，请检查网络后重试',
  VIDEO_TOO_LARGE: '视频不能超过 20MB，请选择较小的视频',
  VIDEO_UNSUPPORTED: '这个视频的格式或编码暂时无法读取，请重新选择视频',
  VIDEO_CONVERSION_UNAVAILABLE: '当前设备无法处理此视频格式，请导出为兼容的 MP4 后重选；原片未改动',
  VIDEO_CONVERSION_FAILED: '视频转换未完成，原片和正文已保留；请重试或换一段视频',
  VIDEO_SELECTION_FAILED: '暂时无法读取视频，请检查相册权限',
  VIDEO_UPLOAD_FAILED: '视频未上传，正文已保留；请重试或移除视频',
  POST_LOCATION_REQUIRED: '选择所在位置后再发布',
  MEDIA_LIMIT: '最多添加 9 项图片或视频，请减少后重选',
  MEDIA_SELECTION_FAILED: '暂时无法读取所选内容，请检查相册权限',
  VIDEO_NOT_ALLOWED: '这里只支持照片，请在记录鱼情中分享视频',
  IMAGE_INPUT_TOO_LARGE: '图片文件过大，请选择 8MB 以内的图片',
  IMAGE_DIMENSIONS_TOO_LARGE: '照片分辨率过高，请先缩小照片后重试',
  IMAGE_UNSUPPORTED: '这张图片的格式或编码暂不支持，可导出为 JPG / PNG 后重选',
  IMAGE_PREPARATION_FAILED: '图片处理未完成，请重试或重新选择；原片未改动',
  PHOTO_SERVICE_UNAVAILABLE: '照片上传服务暂时不可用，可稍后单独重试',
  PHOTO_UPLOAD_FAILED: '照片未上传，正文已保留；请重试或移除该照片',
  MAP_NOT_CONFIGURED: '地图暂时无法使用，请稍后重试；仍可查看钓位列表',
  MAP_QUOTA_EXCEEDED: '地图暂时繁忙，请稍后重试；仍可查看钓位列表',
  MAP_PROVIDER_FAILED: '地图未能加载，请检查网络后重试',
  MAP_RESPONSE_INVALID: '地图预览未能加载，请重试',
  MAP_LOCATION_HIDDEN: '作者未开放可预览的位置，可以查看钓位说明',
  MAP_BACKEND_UNAVAILABLE: '地图暂时无法使用，请稍后重试；仍可查看钓位列表',
  MAP_DEMO_UNAVAILABLE: '体验模式不提供真实地点搜索和地图预览，可继续查看示例钓位',
  MAP_LOAD_FAILED: '地图未能加载，请检查网络后重试；仍可查看钓位列表',
  MAP_LOCATION_UNAVAILABLE: '暂时无法取得位置，可以搜索地点或手动选点',
  WEATHER_UNAVAILABLE: '天气暂时无法查询，请检查网络后重试',
  WEATHER_RESPONSE_INVALID: '这次没有取得完整的天气资料，请稍后重试',
  WEATHER_REGION_UNAVAILABLE: '未能识别天气区域，请搜索并选择附近的城市或地点',
  WEATHER_DEMO_UNAVAILABLE: '体验模式不提供真实天气，请在正式环境查询',
  ZONE_EXPIRED: '这条提醒已经过期，请重新核实后再提交',
  ZONE_DEMO: '体验模式不提交真实禁钓提醒',
  NOT_AUTHENTICATED: '请先登录，草稿会保留',
  NOT_FOUND: '内容不存在或你暂时无权查看',
  NOT_FRIENDS: '双方成为好友后才能发送消息',
  CHAT_CONTENT_UNAVAILABLE: '这条内容当前不能分享给对方，请确认可见范围或稍后重新打开',
  PHOTO_NOT_AVAILABLE: '这张照片不可发送，请重新选择照片',
  AVATAR_UNAVAILABLE: '这张图片不可用作头像，请重新选择并上传',
  BLOCKED: '暂时无法与这位钓友互动',
  INVALID_INPUT: '请检查填写的信息',
  COMPOSITION_EMPTY: '写一点鱼情或添加照片，至少提供一项',
  COMPOSITION_TITLE_REQUIRED: '给这次记录起个名字',
  CATCH_DETAILS_REQUIRED: '这份日志包含多条渔获，请更新应用后再编辑；原记录未改动',
  COMMENT_REQUEST_REUSED: '这次评论内容已变化，请刷新评论后再发送',
  COMMENT_REPLY_UNAVAILABLE: '原评论已删除或暂时不可见，请取消回复后重新发表',
  RATE_LIMIT: '操作较频繁，请稍后重试',
  FORBIDDEN: '你没有执行此操作的权限',
  INVALID_TRANSITION: '状态已变化，请刷新后再试',
  REVIEW_CONFLICT: '内容已更新或已被处理，请重新读取后再审核',
  EDIT_CONFLICT: '这条记录已有新版本，你的修改已保留，请重新读取后继续编辑',
  EDIT_REQUEST_REUSED: '本次提交内容已变化，请重新读取记录后再保存',
  AUTH_REQUIRED: '请先登录，草稿会保留',
  REPORT_CONSENT_REQUIRED: '请先确认私密线索保存说明',
  SELF_REVIEW: '不能审核自己的内容，请由另一位审核员处理',
  SELF_REPORT_REVIEW: '自己提交的举报或涉及自己的内容，请由另一位审核员处理',
  CONTENT_REPORT_DEMO: '体验模式不提交真实社区举报',
  RECENT_PHONE_VERIFICATION_REQUIRED: '请先退出并用短信重新登录，再于 5 分钟内完成注销',
  MEDIA_CLEANUP_FAILED: '图片清理未完成，账号尚未删除，请稍后重试',
  CLEANUP_REQUIRES_RETRY: '图片正在分批清理，请再次确认注销以继续',
  ACCOUNT_DELETION_FAILED: '账号未能完成注销，请稍后重试或联系运营者',
  SESSION_REVOCATION_FAILED: '无法撤销其他登录设备，本次未执行注销',
  SESSION_CHANGED: '账号状态已变化，请重新打开页面',
  AUTH_RESPONSE_INVALID: '登录未能完成，请重新登录',
  AUTH_CANCELLED: '已取消登录',
  AUTH_IN_PROGRESS: '登录正在进行，请稍候',
  CONSENT_REQUIRED: '请先阅读并同意用户协议和隐私政策',
  PHONE_AUTH_UNAVAILABLE: '本机号码登录暂时不可用，请使用短信登录',
  PHONE_AUTH_PROOF_INVALID: '本机号码登录未完成，请重试或使用短信登录',
  AUTH_SECURITY_UNAVAILABLE: '短信验证暂时不可用，请稍后再试',
  DEMO_AUTH_DISABLED: '当前为体验模式，请使用体验入口'
}

export function serviceErrorMessage(code: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(serviceErrorMessages, code)
    ? serviceErrorMessages[code]
    : undefined
}

// Existing local validations and recovery notices are explicitly reviewed here.
// Do not replace this with a language/keyword filter: diagnostics may also be in Chinese.
const localMessages = new Set([
  ...Object.values(serviceErrorMessages),
  '密码过长，请减少中文或特殊字符',
  '手机号已被其他账号使用，请换一个号码',
  '新密码不能与原密码相同',
  '请使用更安全的密码，包含字母和数字',
  '请重新验证手机号后再设置密码',
  '请输入正确的中国大陆手机号',
  '请输入 6 位短信验证码',
  '请填写昵称',
  '请填写“注销”确认',
  '验证码错误或已过期，请重新获取',
  '手机号或验证码不正确，请重新填写',
  '请检查手机号和验证码后重试',
  '验证码发送过于频繁，请稍后再试',
  '操作过于频繁，请稍后再试',
  '请求过于频繁，请稍后重试',
  '安全验证未通过，请稍后重试',
  '暂时无法注册新账号，请稍后再试',
  '验证码暂时未能发送，请稍后重试',
  '当前账号暂时无法登录，请联系运营方',
  '登录状态已失效，请重新登录',
  '登录已失效，请重新登录',
  '登录服务暂时不可用，请稍后重试',
  '短信登录暂时不可用，请稍后再试',
  '请先登录，原账号草稿会保留',
  '本机号码登录暂时不可用，请使用短信登录',
  '微信手机号登录暂时不可用，请使用短信登录',
  '微信登录暂时不可用，请重试',
  '同意协议后可检测本机号码登录是否可用',
  '本机体验不提供审核权限',
  '体验模式没有线上账号，不执行账号注销。可以退出体验。',
  '暂时无法读取照片，请检查相册权限',
  '请先登录再上传照片',
  '未能确认照片上传结果，请重试',
  '照片过大，请选择 8MB 以内的 JPG 或 PNG',
  '照片未上传，正文已保留；请重试或移除该照片',
  '照片上传超时，可单独重试',
  '照片不可用，请重新选择',
  '有照片尚未上传，请重试或移除后保存',
  '请先登录再使用这份日志',
  '请先重新读取这条记录',
  '这条记录已更新，请重新读取后再撤回分享',
  '这条记录已有新版本，你的修改已保留',
  '这条记录已有新版本，请重新读取后修改',
  '提交内容已变化，请重新读取记录',
  '记录已变化，请重新读取',
  '请先确认私密保存说明',
  '私人日志无需撤回',
  '钓位不存在或你暂时无权查看',
  '这位钓友暂不可见',
  '你无权读取这个会话',
  '无权读取此会话',
  '无权修改',
  '内容不可见',
  '暂时无法关注',
  '暂时无法申请',
  '申请状态已变化',
  '双方成为好友后才能聊天',
  '作者未开放精确钓点，不能据此导航',
  '地点搜索失败，请稍后重试',
  '地点搜索超时，请稍后重试',
  '地点联想暂不可用，请稍后重试',
  '地点联想超时，请稍后重试',
  '局域网 HTTP 无法获取当前位置。请使用 HTTPS，或搜索地点。',
  '定位权限已关闭。可在浏览器或系统设置中开启，也可以搜索地点。',
  '定位超时，请稍后重试',
  '地址识别超时，请稍后重试'
])

export const unknownErrorMessage = '操作未完成，请稍后重试'

export function userErrorText(error: unknown): string {
  if (!error || typeof error !== 'object') return unknownErrorMessage
  const value = error as { message?: unknown; code?: unknown; status?: unknown }
  if (typeof value.message === 'string') {
    if (localMessages.has(value.message)) return value.message
    // This local validation has one numeric parameter, not arbitrary server text.
    if (/^请填写 0–\d{1,6}(?:\.\d{1,2})? 之间的数字$/.test(value.message)) return value.message
    if (value.message === '正式模式不能使用体验账号')
      return '体验账号不能用于真实服务，请使用手机号登录'
  }
  if (typeof value.code === 'string') {
    const known = serviceErrorMessage(value.code)
    if (known) return known
  }
  if (value.status === 401) return '登录状态已失效，请重新登录'
  if (value.status === 429) return '操作过于频繁，请稍后再试'
  return unknownErrorMessage
}
