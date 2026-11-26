import { Capacitor } from '@capacitor/core'
import { chooseMediaFiles, type ChosenMedia } from '@mobile-core/media-choose'

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
let handoff: CameraPage | undefined
function currentCameraPage(): CameraPage | undefined {
  if (typeof getCurrentPages !== 'function') return undefined
  const pages = getCurrentPages(), page = pages[pages.length - 1]
  return page ? { page, route: page.route || '' } : undefined
}
function sameCameraPage(snapshot: CameraPage): boolean {
  const current = currentCameraPage()
  return Boolean(current && current.page === snapshot.page && current.route === snapshot.route)
}

/** Capacitor backgrounds the web view while its native camera is open. */
export function isCommentCameraHandoff(): boolean {
  return Boolean(handoff && sameCameraPage(handoff) && Capacitor.isNativePlatform())
}

/** Ownership of the returned object URL passes to MobileMediaUploader's release lifecycle. */
export async function chooseCommentCamera(): Promise<ChosenMedia[]> {
  if (isMiniProgram()) {
    if (!currentCameraPage()) throw cameraError('CAMERA_UNAVAILABLE')
    return chooseMediaFiles(1, ['image'], 'camera')
  }
  // #ifndef MP-WEIXIN
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Camera'))
    throw cameraError('CAMERA_UNAVAILABLE')
  const page = currentCameraPage()
  if (!page || handoff) throw cameraError('CAMERA_UNAVAILABLE')
  const request = page
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
    if (handoff === request) handoff = undefined
  }
  // #endif
}
