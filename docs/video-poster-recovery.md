# Video covers and shared preview

The shared implementation lives in `supabase-mobile-pro/packages/mobile-core/src/video-poster.ts`, `MobileMediaGallery.vue`, and `MobileMediaUploader.vue`. Fishing passes its session boundary through `FishingPhotos`; comment uploads use `posterScope` when their upload queue is scoped to a post as well as an account.

- H5 decodes an actual frame after metadata and a short seek (up to 0.25 seconds). The decoder listens for data, canplay, and seek completion, with a 12-second deadline starting only when one of two decoder slots becomes available.
- Successful covers are kept in session memory for up to ten minutes, bounded to 32 entries and approximately 8 MB. The key includes the account/session and media id, so renewing a signed video URL does not discard a valid frame. Nothing is stored in localStorage, IndexedDB, or a public media URL. Reloading the app decodes again.
- A locally chosen video's actual frame is reused after upload under the server media id. Account changes clear the previous scope. Cancellation detaches only that subscriber; once the last subscriber leaves, the decoder releases its source and event handlers. Page hide and component teardown cancel gallery requests.
- A missing cover keeps the playback button usable and offers **重新加载封面**. Retry also asks the app to renew its signed attachment URLs. Network, codec, and CORS errors never produce a fabricated cover or an assertion that the underlying video cannot play.
- Native `chooseMedia` already supplies a real `thumbTempFilePath` when available. We retain and reuse that temporary cover in the current session. This change does not invent a native remote-video thumbnail API or add a server poster column. Existing remote videos without a stored poster still require a backend thumbnail pipeline for consistent covers across native sessions; H5 can decode them client-side.

## Design references

The Apple design skill's `playing-video.md › Best practices` informed consistent shared playback and keeping full media proportions in the viewer. `loading.md › Best practices / Showing progress` informed retaining the usable card while a real frame loads. The UI/UX Pro Max query `loading feedback retry recovery --domain ux` returned **Error Recovery** and **Loading Indicators**: provide a recovery action next to a failure and keep loading feedback understandable.

Technical references checked:

- [MDN loadeddata](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/loadeddata_event): mobile data-saving modes may suppress this event, so it is not our sole completion signal.
- [uni-app chooseMedia](https://uniapp.dcloud.net.cn/api/media/video.html): documents the genuine `thumbTempFilePath` picker result. No app id, remote image, or unsupported API was assumed.

## Verification

`scripts/test-video-posters.mjs` uses a real CC0 MP4 and isolated session/API fixtures. It delays the actual media response by 4.5 seconds, checks decoded frame dimensions and nonuniform pixels, exercises signed-URL renewal, two-decoder concurrency, independent cancellation, account cache isolation, codec/CORS failures, visible retry, playback and page departure. CORS is tested against a real second local HTTP origin because intercepted `route.fulfill` responses can add permissive headers.

`scripts/test-post-media-gallery.mjs` checks 15 list/detail/preview flows. Both list and detail use aligned compact square thumbnails; the shared fullscreen viewers show the complete image/video. Screenshots cover 320, 375, 440, landscape, wide, and dark with enlarged text, plus failed-cover and player states. Evidence is written to `artifacts/video-posters` and `artifacts/post-media-gallery`. These are local browser/contract checks, not native device acceptance or a claim about any production media's CORS configuration.
