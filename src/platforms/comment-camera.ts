import { Capacitor } from '@capacitor/core'
import { chooseMediaFiles, type ChosenMedia, type MediaChooseSource } from '@mobile-core/media-choose'

function isMiniProgram(): boolean {
  // #ifdef MP-WEIXIN
  return true
  // #endif
  // #ifndef MP-WEIXIN
  return false
  // #endif
}

/** The plain website must never fall back to a file input advertised as a camera. */
export function canUseCamera(): boolean {
  return isMiniProgram() || Capacitor.isNativePlatform()
}

function cameraError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

type CameraPage = { page: unknown; route: string }
type CameraHandoff = CameraPage & { kind: 'native' | 'mini'; background: boolean; resumed: boolean }
let handoff: CameraHandoff | undefined
let returnedCamera: CameraPage | undefined
function currentCameraPage(): CameraPage | undefined {
  if (typeof getCurrentPages !== 'function') return undefined
  const pages = getCurrentPages(), page = pages[pages.length - 1]
  return page ? { page, route: page.route || '' } : undefined
}
function sameCameraPage(snapshot: CameraPage): boolean {
  const current = currentCameraPage()
  return Boolean(current && current.page === snapshot.page && current.route === snapshot.route)
}

/** Page.onHide can precede App.onHide; ownership starts when the camera opens. */
export function isCommentCameraHandoff(): boolean {
  if (!handoff || !sameCameraPage(handoff)) return false
  return isMiniProgram()
    ? handoff.kind === 'mini'
    : Capacitor.isNativePlatform() && handoff.kind === 'native'
}

export function preserveCommentCameraPage(): boolean {
  if (!isCommentCameraHandoff()) return false
  handoff!.background = true
  return true
}

/** Skip the camera's return refresh whether the file callback is before or after Page.onShow. */
export function resumeCommentCameraPage(): boolean {
  if (isCommentCameraHandoff()) {
    handoff!.resumed = true
    return true
  }
  const returning = returnedCamera
  returnedCamera = undefined
  return Boolean(returning && sameCameraPage(returning))
}

function finishHandoff(request: CameraHandoff) {
  if (handoff !== request) return
  if (request.background && !request.resumed && sameCameraPage(request)) returnedCamera = request
  handoff = undefined
}

async function chooseOnPage(load: () => Promise<ChosenMedia[]>, kind: 'native' | 'mini') {
  const page = currentCameraPage()
  if (!page || handoff) throw cameraError('MEDIA_SELECTION_FAILED')
  const request: CameraHandoff = { ...page, kind, background: false, resumed: false }
  const hide = () => { if (handoff === request && sameCameraPage(page)) request.background = true }
  returnedCamera = undefined
  handoff = request
  try {
    if (kind === 'mini') uni.onAppHide(hide)
    const files = await load()
    if (!sameCameraPage(page)) { files.forEach(file => file.release?.()); return [] }
    return files
  } finally {
    finishHandoff(request)
    if (kind === 'mini') uni.offAppHide(hide)
  }
}

/** Album and camera must hold the same comment-page lifecycle while native UI is open. */
export function chooseCommentMedia(count: number, accept: readonly ('image' | 'video')[], source?: MediaChooseSource) {
  if (source === 'camera') return chooseCommentCamera()
  const load = () => chooseMediaFiles(count, accept, source)
  return isMiniProgram() ? chooseOnPage(load, 'mini')
    : Capacitor.isNativePlatform() ? chooseOnPage(load, 'native') : load()
}

/** Ownership of the returned object URL passes to MobileMediaUploader's release lifecycle. */
export async function chooseCommentCamera(): Promise<ChosenMedia[]> {
  if (isMiniProgram()) {
    return chooseOnPage(() => chooseMediaFiles(1, ['image'], 'camera'), 'mini')
  }
  // #ifndef MP-WEIXIN
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Camera'))
    throw cameraError('CAMERA_UNAVAILABLE')
  const page = currentCameraPage()
  if (!page || handoff) throw cameraError('CAMERA_UNAVAILABLE')
  const request: CameraHandoff = { ...page, kind: 'native', background: false, resumed: false }
  returnedCamera = undefined
  handoff = request
  try {
  const { Camera, CameraSource, CameraResultType, CameraDirection } = await import('@capacitor/camera')
  let photo: Awaited<ReturnType<typeof Camera.getPhoto>>
  try {
    // getPhoto remains available in Camera 8; CameraSource.Camera opens the real native camera.
    // Never ask for album access or save a copy to the user's gallery for this action.
    photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      direction: CameraDirection.Rear,
      quality: 85,
      width: 2048,
      height: 2048,
      correctOrientation: true,
      allowEditing: false,
      saveToGallery: false
    })
  } catch (error) {
    const detail = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
    const code = String(detail.code || '')
    const message = String(detail.message || '')
    if (['OS-PLUG-CAMR-0006', 'OS-PLUG-CAMR-0013'].includes(code) || /\bcancel(?:led|ed)?\b/i.test(message)) return []
    if (code === 'OS-PLUG-CAMR-0003' || /denied|permission|restricted/i.test(message)) throw cameraError('CAMERA_PERMISSION_DENIED')
    if (code === 'OS-PLUG-CAMR-0007' || /no camera|not available|not implemented/i.test(message)) throw cameraError('CAMERA_UNAVAILABLE')
    throw cameraError('CAMERA_CAPTURE_FAILED')
  }
  // A camera result belongs to the exact page that requested it, including its route.
  if (!sameCameraPage(page)) return []
  if (!photo.webPath) throw cameraError('CAMERA_READ_FAILED')
  try {
    const response = await fetch(photo.webPath)
    if (!response.ok) throw cameraError('CAMERA_READ_FAILED')
    const blob = await response.blob()
    if (blob.size < 1) throw cameraError('CAMERA_READ_FAILED')
    if (blob.size > 8 * 1024 * 1024) throw cameraError('IMAGE_INPUT_TOO_LARGE')
    const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
    const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)
    if (!jpeg && !png) throw cameraError('IMAGE_UNSUPPORTED')
    if (!sameCameraPage(page)) return []
    const image = blob.type === (jpeg ? 'image/jpeg' : 'image/png') ? blob : new Blob([blob], { type: jpeg ? 'image/jpeg' : 'image/png' })
    const path = URL.createObjectURL(image)
    let released = false
    return [{ path, kind: 'image', size: image.size, release() {
      if (!released) { released = true; URL.revokeObjectURL(path) }
    } }]
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['IMAGE_INPUT_TOO_LARGE', 'IMAGE_UNSUPPORTED', 'CAMERA_READ_FAILED'].includes(String(error.code))) throw error
    throw cameraError('CAMERA_READ_FAILED')
  }
  } finally {
    finishHandoff(request)
  }
  // #endif
}
