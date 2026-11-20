import { VideoPreparationError, type BrowserVideoConverter } from '@mobile-core/video-prepare'

/** Browser codec adapter, loaded only for sources that need a real container/codec conversion. */
export const convertBrowserVideo: BrowserVideoConverter = async (source, options) => {
  // #ifdef H5
  if (options.signal?.aborted) throw new VideoPreparationError('UPLOAD_CANCELLED')
  const media = await import('mediabunny')
  if (options.signal?.aborted) throw new VideoPreparationError('UPLOAD_CANCELLED')
  const input = new media.Input({ source: new media.BlobSource(source), formats: [media.MP4,media.QTFF,media.WEBM,media.MATROSKA,media.MPEG_TS,media.OGG] })
  const target = new media.BufferTarget()
  // Write packets as they are produced, so the byte limit stops expansion before a
  // complete oversized mdat can accumulate in an in-memory fast-start buffer.
  const output = new media.Output({ format: new media.Mp4OutputFormat({fastStart:false}),target })
  let conversion: Awaited<ReturnType<typeof media.Conversion.init>> | undefined
  let stopped: VideoPreparationError | undefined
  let rejectStop: (error: VideoPreparationError) => void = () => {}
  const stopPromise = new Promise<never>((_, reject) => { rejectStop = reject })
  const stop = (error: VideoPreparationError) => {
    if (stopped) return
    stopped = error
    rejectStop(error)
    if (conversion) void conversion.cancel().catch(() => {})
    else input.dispose()
  }
  const abort = () => stop(new VideoPreparationError('UPLOAD_CANCELLED'))
  options.signal?.addEventListener('abort',abort,{once:true})
  const timer = setTimeout(() => stop(new VideoPreparationError('VIDEO_CONVERSION_FAILED')),180000)
  const unwatch = target.on('write',({end}) => { if (end > options.maxBytes) stop(new VideoPreparationError('VIDEO_TOO_LARGE')) })
  try {
    return await Promise.race([stopPromise,(async () => {
      if (options.signal?.aborted) { abort(); throw stopped }
      if (!await input.canRead()) throw new VideoPreparationError('VIDEO_UNSUPPORTED')
      const [tracks,videos,audios] = await Promise.all([input.getTracks(),input.getVideoTracks(),input.getAudioTracks()])
      if (videos.length !== 1 || tracks.length !== videos.length + audios.length) throw new VideoPreparationError('VIDEO_UNSUPPORTED')
      const video = videos[0]
      if (video.displayWidth > 8192 || video.displayHeight > 8192 || video.displayWidth * video.displayHeight > 24000000) throw new VideoPreparationError('VIDEO_CONVERSION_UNAVAILABLE')
      conversion = await media.Conversion.init({ input,output,tracks:'all',video:{codec:'avc'},audio:{codec:'aac'},tags:{},showWarnings:false })
      if (stopped) { await conversion.cancel(); throw stopped }
      // A conversion can be "valid" after silently dropping an unsupported audio track.
      // Every source audio/video track must survive; no muted fallback is permitted.
      if (!conversion.isValid || conversion.discardedTracks.length || tracks.some(track => !conversion!.utilizedTracks.includes(track))) throw new VideoPreparationError('VIDEO_CONVERSION_UNAVAILABLE')
      conversion.onProgress = progress => options.onProgress?.(Math.min(99,Math.max(0,progress*100)))
      await conversion.execute()
      if (stopped) throw stopped
      if (!target.buffer?.byteLength) throw new VideoPreparationError('VIDEO_CONVERSION_FAILED')
      if (target.buffer.byteLength > options.maxBytes) throw new VideoPreparationError('VIDEO_TOO_LARGE')
      const blob = new Blob([target.buffer],{type:'video/mp4'})
      options.onProgress?.(100)
      return blob
    })()])
  } catch (error) {
    if (stopped) throw stopped
    if (error instanceof VideoPreparationError) throw error
    throw new VideoPreparationError('VIDEO_CONVERSION_FAILED')
  } finally {
    clearTimeout(timer); unwatch(); options.signal?.removeEventListener('abort',abort)
    if (conversion && conversion.state !== 'done') await conversion.cancel().catch(() => {})
    input.dispose()
  }
  // #endif
  // #ifndef H5
  throw new VideoPreparationError('VIDEO_CONVERSION_UNAVAILABLE')
  // #endif
}
