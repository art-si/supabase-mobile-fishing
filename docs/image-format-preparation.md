# Image formats and local preparation

The shared implementation belongs to Pro `packages/mobile-core/src/image-prepare.ts`, `media-choose.ts`, and the avatar editor/cropper. Fishing injects its lazy HEIC/HEIF decoder through `normalizeUnsupportedImage`; the shared package does not depend on the HEIF library.

H5 accepts JPEG, PNG, WebP, GIF, BMP and AVIF. It inspects signatures and dimensions before decoding, checks decoded dimensions again, and exports the added formats as an actual white-backed JPEG even when the original is smaller than 2048 px. The existing small JPEG/PNG path and EXIF orientation behavior remain intact. Byte limits and the 24 MP limit remain enforced; server sanitization is still required.

Animated GIF, WebP and AVIF are stored as a static first frame. The chooser recognizes GIF signatures, WebP VP8X animation flags and the AVIF sequence brand and displays “动图将按静态首帧保存”. Avatar cropping shows the same notice and operates on the frozen raster. Original files are not modified. Browser decoding support still varies; a file that cannot be decoded produces a recoverable selection error.

On mini-program/native image bridges, supported source types go through `getImageInfo` and `compressImage` when normalization is needed. The result must actually be JPEG/PNG and within limits; returning the original unsupported format is rejected. This is API-contract coverage, not a claim that every phone supports every codec. HEIC/HEIF H5 decoding and its worker cancellation are documented by the host adapter's tests.

`ImagePreparationOptions.signal` also reaches the optional normalizer. Fetch, bitmap decoding, image loading, encoding and native compression settle on cancellation; late bitmaps are closed and late native copies are removed. The original selected file is never deleted. Leaving an active uploader aborts preparation/transport and retains unfinished items for explicit retry. Returning does not automatically upload again; completed attachments remain intact. Ordinary sending/busy `disabled` state does not abort an existing transfer.

Preparation progress uses its own label and percentage, separate from upload progress. Compact comment thumbnails show this within the existing square without an extra spinner crowding the text.

`UploadOptions.onPreparedMedia` hands a normalized local preview to the uploader only when it explicitly returns `true`. The original selection remains the retry source; the normalized JPEG/MP4 is used by the thumbnail, shared image/video viewer and video poster extraction. This matters for HEIC and containers that the browser cannot display directly. Replacing, removing, clearing, changing account or unmounting disposes the owned copy. If the component is stale or declines ownership, the upload service releases it. There is no duplicate Blob copy or persistent cache.

## Verification

- `tests/image-prepare.test.ts`: bounded raster/ISO headers, byte/pixel limits, native normalization/output verification, late-output cleanup and cancellation.
- `scripts/test-image-prepare.mjs`: 38 actual browser checks covering JPEG EXIF orientations, PNG alpha, scaling and ownership cleanup.
- `scripts/test-image-formats.mjs`: real WebP, transparent WebP, two-frame GIF, BMP and official AVIF conversions; exact JPEG bytes/dimensions, white alpha, red first GIF frame, normalizer rejection/cancellation and late bitmap cleanup.
- `scripts/test-profile-avatar.mjs`: actual avatar file-picker and cropper entry for new formats, plus existing drag/touch/keyboard, save/retry, cancel and viewport coverage. Transport is isolated; no hosted avatar write.
- `scripts/test-media-picker-sources.mjs`: actual hidden input attributes, extended format acceptance and static-frame hints; desktop capture attributes are not presented as real camera hardware.
- `scripts/test-uploader-preparation-lifecycle.mjs`: mounted production component and Uni hide/show hooks with delayed callback fixtures; cancellation, ignored late progress/results, explicit retry and preserved completed attachments.
- `scripts/test-prepared-media-preview.mjs`: actual HEIC conversion in the comment composer, a JPEG thumbnail/full-screen viewer, prepared video playback, and original/copy cleanup on removal and account exit. Only HTTP responses are isolated; codecs and viewers run for real.

Evidence: `artifacts/image-formats`, `artifacts/profile-avatar`, `artifacts/media-picker-sources` and `artifacts/uploader-preparation-lifecycle`. Fixture provenance and license: `tests/fixtures/image-formats/README.md`.

## Reference material

- [HTML image bitmap specification](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html): Blob image bitmap animation first/default-frame behavior.
- [WebP RIFF container specification](https://developers.google.com/speed/webp/docs/riff_container): VP8/VP8L/VP8X dimensions and animation flag.
- [Uni image API](https://uniapp.dcloud.io/api/media/image): platform image information and compression contracts.
- [WebKit Safari 17 features](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/): HEIC support varies by browser/runtime, so it is not assumed across all H5 devices.
