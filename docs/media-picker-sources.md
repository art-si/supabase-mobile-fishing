# Shared attachment picker sources

`chooseMediaFiles(count, accept, source?)` in Pro's `media-choose.ts` accepts optional `camera | album`. Omitting it preserves existing chooser behavior. A camera request is one image; an album request retains the caller's available capacity and image/video types.

`MobileMediaUploader` exposes `choose(source?)` alongside `choosing` and `uploading`. `hideAddButton` hides only the legacy upload row; previews, deletion, progress and ordering remain available. `compact` selects three equal thumbnail columns, with the existing 48 px delete target placed above the small tile's center so it does not intercept preview/play taps. Both options default off.

The optional `cameraPicker: () => Promise<ChosenMedia[]>` prop lets a host inject a genuine native camera implementation without adding a camera plugin to every shared-component consumer. `ChosenMedia` contains `path`, `kind`, byte `size`, optional video metadata and an optional `release()` cleanup function. Cancellation returns an empty list. The uploader applies the same capacity/type/size validation and active-page/account checks to injected and default picker results. It releases rejected or stale selections, including after leaving and returning to a page before a picker finishes.

Only a supported mini program or native app should expose the product's camera action. In a regular H5 browser, the comment composer hides it. The generic H5 source API retains a standards-based `accept="image/*" capture="environment"` input for compatible callers; this requests capture from a supporting browser and is not a guarantee that camera hardware opens. Desktop browsers normally show a file selector. The album input has no capture attribute.

For a mini program, the real call is `uni.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera'] })`. Platform privacy/permission configuration and device support still apply. Invoke chooser actions from a user tap/click, without an unrelated awaited task before opening the system UI.

References checked: [MDN HTML capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture) and [official uni-app chooseMedia](https://uniapp.dcloud.net.cn/api/media/video.html). Apple `buttons.md › Best practices` informs the independent touch areas; no thumbnail-specific camera API was assumed.

Verification:

- `tests/media-choose.test.ts`: six non-H5 API contract cases for camera, album, unchanged defaults, cancellation, permission failure and no-capacity/video-only callers. These are not physical-device tests.
- `scripts/test-media-picker-sources.mjs`: four real browser input/file-event cases, using actual PNG/MP4 fixture files. It checks capture/type/multiple attributes, cancellation, cleanup and default compatibility; it does not claim a desktop camera capture.
- `scripts/test-media-picker-lifecycle.mjs`: actual routed comment page hides, return before an old chooser completes, and real mounted authentication-store sign-out; late blobs must be released with no attachment insertion or upload.
- The comment composer integration/screenshot suite covers the visible toolbar, hidden browser camera action, compact attachments and shared previews separately.
