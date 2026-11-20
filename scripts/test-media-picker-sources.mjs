// Real H5 input/file events; fixture files do not claim a physical desktop camera.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/media-picker-sources'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname))
await mkdir(output,{recursive:true})
const image=await readFile('assets/brand/fish-symbol.png'),video=await readFile('tests/fixtures/flower-cc0.mp4')
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:375,height:812}}),page=await context.newPage()
const errors=[],escaped=[],checks=[];page.on('pageerror',error=>errors.push(error.message))
await context.route('**/*',async route=>{
 const url=new URL(route.request().url())
 if(url.origin!==base){escaped.push(url.origin);return route.abort()}
 if(url.pathname==='/__media-picker-review__')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><button id="camera">拍照接口验收</button><button id="album">相册接口验收</button><button id="default">默认接口验收</button><script type="module">import {chooseMediaFiles} from '/src/_mobile-core/media-choose.ts';for(const source of ['camera','album','default'])document.getElementById(source).onclick=()=>{window.finished=false;window.chosen=undefined;window.selection=chooseMediaFiles(6,['image','video'],source==='default'?undefined:source).then(items=>{window.chosen=items;window.finished=true})}</script>`})
 return route.continue()
})
try{
 await page.goto(`${base}/__media-picker-review__`)
 const cameraEvent=page.waitForEvent('filechooser');await page.locator('#camera').click();const camera=await cameraEvent
 assert.deepEqual(await camera.element().evaluate(input=>({accept:input.accept,capture:input.getAttribute('capture'),multiple:input.multiple})),{accept:'image/*',capture:'environment',multiple:false})
 await camera.setFiles({name:'real-photo.png',mimeType:'image/png',buffer:image});await page.waitForFunction(()=>window.finished)
 assert.deepEqual(await page.evaluate(()=>window.chosen.map(item=>({kind:item.kind,size:item.size,blob:item.path.startsWith('blob:')}))),[{kind:'image',size:image.length,blob:true}])
 assert.equal(await page.locator('input[type=file]').count(),0)
 await page.evaluate(()=>window.chosen.forEach(item=>item.release?.()))
 checks.push('camera input requests environment capture with image/* and a single file; real PNG becomes an owned blob and chooser is removed')
 const albumEvent=page.waitForEvent('filechooser');await page.locator('#album').click();const album=await albumEvent
 const attrs=await album.element().evaluate(input=>({accept:input.accept,capture:input.getAttribute('capture'),multiple:input.multiple}))
 assert.equal(attrs.capture,null);assert.equal(attrs.multiple,true);assert.ok(attrs.accept.includes('image/png')&&attrs.accept.includes('video/mp4'))
 await album.setFiles([{name:'photo.png',mimeType:'image/png',buffer:image},{name:'clip.mp4',mimeType:'video/mp4',buffer:video}]);await page.waitForFunction(()=>window.finished)
 assert.deepEqual(await page.evaluate(()=>window.chosen.map(item=>item.kind)),['image','video']);await page.evaluate(()=>window.chosen.forEach(item=>item.release?.()))
 checks.push('album omits capture and preserves mixed real photo/video selection')
 const formatsEvent=page.waitForEvent('filechooser');await page.locator('#album').click();const formats=await formatsEvent
 const accepted=await formats.element().getAttribute('accept');for(const format of ['webp','gif','bmp','avif','heic','heif'])assert.ok(accepted.includes(`.${format}`))
 await formats.setFiles(['tests/fixtures/image-formats/animated.gif','tests/fixtures/image-formats/small.webp','tests/fixtures/image-formats/small.bmp','tests/fixtures/image-formats/color.avif'])
 await page.waitForFunction(()=>window.finished)
 const notices=await page.evaluate(()=>window.chosen.map(item=>item.notice))
 assert.equal(notices[0],'动图将按静态首帧保存');assert.equal(notices[1],'');assert.equal(notices[2],'')
 await page.evaluate(()=>window.chosen.forEach(item=>item.release?.()))
 checks.push('the real picker accepts WebP/GIF/BMP/AVIF/HEIC/HEIF; actual GIF signature produces the static-frame notice, ordinary WebP/BMP do not')
 const signatureHints=await page.evaluate(async()=>{
  const {imageSelectionNotice}=await import('/src/_mobile-core/media-choose.ts');const bytes=new Uint8Array(30);bytes.set(new TextEncoder().encode('RIFF'),0);bytes.set(new TextEncoder().encode('WEBPVP8X'),8);bytes[20]=2;const animated=imageSelectionNotice(bytes);bytes[20]=0;return[animated,imageSelectionNotice(bytes)]
 });assert.deepEqual(signatureHints,['动图将按静态首帧保存',''])
 const videosEvent=page.waitForEvent('filechooser');await page.locator('#album').click();const videos=await videosEvent
 const videoAccept=await videos.element().getAttribute('accept');for(const ext of ['mp4','mov','m4v','webm','mkv','ts','mts','m2ts','ogv'])assert.ok(videoAccept.includes(`.${ext}`))
 await videos.setFiles(['mkv','mts','m2ts','ogv'].map((extension,index)=>({name:`container.${extension}`,mimeType:index%2?'application/octet-stream':'',buffer:Buffer.from('picker-classification-only-not-a-playable-video')})))
 await page.waitForFunction(()=>window.finished)
 assert.deepEqual(await page.evaluate(()=>window.chosen.map(item=>item.kind)),['video','video','video','video'])
 await page.evaluate(()=>window.chosen.forEach(item=>item.release?.()))
 checks.push('empty/generic MIME .mkv/.mts/.m2ts/.ogv selections are classified as video for later codec validation; this does not claim these bytes are playable')
 const cancelEvent=page.waitForEvent('filechooser');await page.locator('#camera').click();const cancel=await cancelEvent
 await cancel.element().evaluate(input=>input.dispatchEvent(new Event('cancel')));await page.waitForFunction(()=>window.finished)
 assert.equal(await page.evaluate(()=>window.chosen.length),0);assert.equal(await page.locator('input[type=file]').count(),0)
 checks.push('cancelling the chooser resolves empty and removes the hidden input, allowing the next choice')
 const defaultEvent=page.waitForEvent('filechooser');await page.locator('#default').click();const original=await defaultEvent
 assert.equal(await original.element().getAttribute('capture'),null);assert.ok(original.isMultiple())
 await original.setFiles([]);await page.waitForFunction(()=>window.finished);assert.equal(await page.evaluate(()=>window.chosen.length),0)
 checks.push('existing callers retain their default multiple-file chooser without camera capture')
 assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/result.json`,JSON.stringify({checks,errors,escaped,scope:'Desktop browser input contract. Camera hardware and native pickers require device acceptance.'},null,2));console.log(JSON.stringify({checks,errors,escaped},null,2))
}finally{await context.close();await browser.close()}
