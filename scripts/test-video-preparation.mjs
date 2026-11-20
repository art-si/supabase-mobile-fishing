// Real container generation/transcoding/playback on Windows Chrome, with no hosted writes.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { Input, Output, BufferSource, BufferTarget, MP4, Conversion, MovOutputFormat, MkvOutputFormat, MpegTsOutputFormat } from 'mediabunny'
import { sanitizeVideo } from '../supabase/functions/_shared/video.ts'
import { inspectMp4Video } from '../src/_mobile-core/video-prepare.ts'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',out='artifacts/video-preparation'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));await mkdir(out,{recursive:true})
const flower=await readFile('tests/fixtures/flower-cc0.mp4'),fixtures=new Map([['flower.mp4',flower]])
const m4v=Buffer.from(flower);m4v.write('M4V ',8,'ascii');fixtures.set('flower.m4v',m4v)
for(const [name,format]of[['flower.mov',new MovOutputFormat()],['flower.mkv',new MkvOutputFormat()],['flower.ts',new MpegTsOutputFormat()]]){
 const input=new Input({source:new BufferSource(flower),formats:[MP4]}),target=new BufferTarget(),output=new Output({format,target})
 try{const conversion=await Conversion.init({input,output,copy:{mode:'forced'}});assert.ok(conversion.isValid);assert.equal(conversion.discardedTracks.length,0);await conversion.execute();fixtures.set(name,Buffer.from(target.buffer))}finally{input.dispose()}
}
for(const[name,bytes]of fixtures)await writeFile(`${out}/${name}`,bytes)
if(process.argv.includes('--fixtures-only')){console.log(`Wrote ${fixtures.size} real video fixtures to ${out}`);process.exit(0)}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage()
const errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000)
// The fixture generator uses the installed real browser bundle. Production conversion
// is imported normally through the actual Vite module, including its lazy dependency.
const bunnyBundle=await readFile('node_modules/mediabunny/dist/bundles/mediabunny.mjs')
await page.route('**/video-test-bunny.js',route=>route.fulfill({body:bunnyBundle,contentType:'text/javascript'}))
await page.route('**/video-test-shell',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Local video preparation contract</body></html>'}))
await page.route('**/video-fixture/*',route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1);return route.fulfill({body:fixtures.get(name),contentType:'application/octet-stream'})})
try{
 await page.goto(`${base}/video-test-shell`)
 await page.evaluate(async()=>{
  window.preparation=await import('/src/_mobile-core/video-prepare.ts')
  window.conversion=await import('/src/platforms/video-conversion.ts')
  window.results=[]
 })
 for(const name of fixtures.keys()){
  const result=await page.evaluate(async name=>{
   const source=await(await fetch(`/video-fixture/${name}`)).blob(),path=URL.createObjectURL(source),progress=[],stages=[]
   try{
    const prepared=await window.preparation.prepareUploadVideo(path,20*1024*1024,{convertBrowserVideo:window.conversion.convertBrowserVideo,onStage:stage=>stages.push(stage),onPreparationProgress:p=>progress.push(p)})
    try{const bytes=await(await fetch(prepared.path)).arrayBuffer();return{bytes:Array.from(new Uint8Array(bytes)),changed:path!==prepared.path,stages,progress}}finally{prepared.dispose()}
   }finally{URL.revokeObjectURL(path)}
  },name)
  const bytes=Uint8Array.from(result.bytes),sanitized=sanitizeVideo(bytes),inspection=inspectMp4Video(bytes)
  assert.ok(inspection?.compatible);assert.equal(inspection.audioTracks,inspectMp4Video(flower).audioTracks)
  assert.ok(sanitized.duration>4);assert.deepEqual(result.stages,['preparing'])
  assert.equal(result.changed,!['flower.mp4','flower.m4v'].includes(name))
  await writeFile(`${out}/${name}.converted.mp4`,bytes)
  checks.push(`${name}: real compatible output, audio tracks retained, server sanitizer accepted (${bytes.length} bytes)`)
  console.log(checks.at(-1))
 }
 const webm=await page.evaluate(async()=>{
  const bunny=await import('/video-test-bunny.js')
  const flower=await(await fetch('/video-fixture/flower.mp4')).blob(),input=new bunny.Input({source:new bunny.BlobSource(flower),formats:[bunny.MP4]})
  const target=new bunny.BufferTarget(),output=new bunny.Output({format:new bunny.WebMOutputFormat(),target})
  try{const fixture=await bunny.Conversion.init({input,output,video:{codec:'vp8'},audio:{codec:'opus'}});if(!fixture.isValid||fixture.discardedTracks.length)throw new Error('Fixture codec unavailable');await fixture.execute()}finally{input.dispose()}
  const source=new Blob([target.buffer],{type:'video/webm'}),path=URL.createObjectURL(source),progress=[]
  window.generatedWebm=source
  const diagnostic=new bunny.Input({source:new bunny.BlobSource(source),formats:[bunny.WEBM,bunny.MATROSKA]})
  try{window.webmDiagnostic={size:source.size,tracks:await diagnostic.getTracks().then(tracks=>Promise.all(tracks.map(async track=>({type:track.type,codec:await track.getCodec()}))))}}finally{diagnostic.dispose()}
  try{
   const prepared=await window.preparation.prepareUploadVideo(path,20*1024*1024,{convertBrowserVideo:window.conversion.convertBrowserVideo,onPreparationProgress:p=>progress.push(p)})
   try{
    const video=document.createElement('video');video.src=prepared.path;document.body.appendChild(video);video.muted=true;await video.play();await new Promise(resolve=>setTimeout(resolve,250));const played=video.currentTime;video.pause();video.removeAttribute('src');video.load();video.remove()
    return{bytes:Array.from(new Uint8Array(await(await fetch(prepared.path)).arrayBuffer())),inputBytes:Array.from(new Uint8Array(await source.arrayBuffer())),progress,played}
   }finally{prepared.dispose()}
  }finally{URL.revokeObjectURL(path)}
 })
 const converted=Uint8Array.from(webm.bytes),result=sanitizeVideo(converted),inspection=inspectMp4Video(converted)
 assert.ok(inspection?.compatible);assert.equal(inspection.audioTracks,1);assert.ok(result.duration>1);assert.ok(webm.played>.1);assert.ok(webm.progress.length>0)
 await writeFile(`${out}/generated-vp8-opus.webm`,Uint8Array.from(webm.inputBytes));await writeFile(`${out}/webm-converted.mp4`,converted)
 checks.push('generated VP8/Opus WebM transcodes into real H264/AAC MP4, retains audio and plays after server validation')
 console.log(checks.at(-1))
 // Real encoder work is cancelled and bounded. These paths use the production
 // converter and valid media, rather than a converter mock or altered extension.
 const guards=await page.evaluate(async()=>{
  const result={}
  try{await window.conversion.convertBrowserVideo(window.generatedWebm,{maxBytes:20000});result.limit='unexpected success'}catch(error){result.limit=error.code}
  const controller=new AbortController();let progressed=false
  try{await window.conversion.convertBrowserVideo(window.generatedWebm,{maxBytes:20*1024*1024,signal:controller.signal,onProgress(){progressed=true;controller.abort()}});result.cancel='unexpected success'}catch(error){result.cancel=error.code}
  result.progressed=progressed
  const source=URL.createObjectURL(window.generatedWebm),signal=new AbortController();let lateSignal
  try{
   const pending=window.preparation.prepareUploadVideo(source,20*1024*1024,{signal:signal.signal,convertBrowserVideo:(_blob,options)=>new Promise(()=>{lateSignal=options.signal})})
   await new Promise(resolve=>setTimeout(resolve,100));signal.abort()
   try{await pending;result.lazy='unexpected success'}catch(error){result.lazy=error.code}
   result.lazyStopped=lateSignal.aborted
  }finally{URL.revokeObjectURL(source)}
  return result
 })
 assert.deepEqual(guards,{limit:'VIDEO_TOO_LARGE',cancel:'UPLOAD_CANCELLED',progressed:true,lazy:'UPLOAD_CANCELLED',lazyStopped:true})
 checks.push('real transcoding stops at output limit and cancellation; lazy converter waits cancel immediately')
 fixtures.set('generated.webm',Buffer.from(webm.inputBytes))
 // A fresh realm avoids codec-support memoization from the successful runs.
 await page.goto(`${base}/video-test-shell`)
 const unavailable=await page.evaluate(async()=>{
  const original=AudioEncoder.isConfigSupported
  AudioEncoder.isConfigSupported=async config=>({supported:false,config})
  try{
   const {convertBrowserVideo}=await import('/src/platforms/video-conversion.ts')
   try{await convertBrowserVideo(await(await fetch('/video-fixture/generated.webm')).blob(),{maxBytes:20*1024*1024});return'unexpected muted success'}catch(error){return error.code}
  }finally{AudioEncoder.isConfigSupported=original}
 })
 assert.equal(unavailable,'VIDEO_CONVERSION_UNAVAILABLE')
 checks.push('an unavailable AAC encoder rejects conversion instead of silently stripping audio')
 assert.deepEqual(errors,[])
 await writeFile(`${out}/result.json`,JSON.stringify({checks,errors,boundary:'Actual local media conversion and playback; no hosted upload. Codec availability is device-dependent.'},null,2));console.log(JSON.stringify({checks,errors},null,2))
}catch(error){
 console.error('CONVERSION_DIAGNOSTIC',await page.evaluate(()=>window.webmDiagnostic||null))
 const source=await page.evaluate(async()=>window.generatedWebm?Array.from(new Uint8Array(await window.generatedWebm.arrayBuffer())):null)
 if(source)await writeFile(`${out}/generated-failure.webm`,Uint8Array.from(source))
 throw error
}finally{await browser.close()}
