// Actual raster decodes through the shared preparation code, isolated from account/API traffic.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/image-formats'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));await mkdir(output,{recursive:true})
function bmp(){const width=96,height=64,stride=width*3,data=Buffer.alloc(54+stride*height);data.write('BM');data.writeUInt32LE(data.length,2);data.writeUInt32LE(54,10);data.writeUInt32LE(40,14);data.writeInt32LE(width,18);data.writeInt32LE(height,22);data.writeUInt16LE(1,26);data.writeUInt16LE(24,28);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=54+y*stride+x*3;data[p]=20;data[p+1]=x<48?30:180;data[p+2]=x<48?230:20}return data}
function gif(){
 const width=96,height=64,header=Buffer.from([71,73,70,56,57,97,96,0,64,0,128,0,0,230,30,20,20,180,20]),frames=[]
 for(const color of [0,1]){const codes=[];for(let i=0;i<width*height;i++)codes.push(4,color);codes.push(5);const packed=Buffer.alloc(Math.ceil(codes.length*3/8));codes.forEach((code,i)=>{const bit=i*3;packed[bit>>3]|=code<<(bit&7);if((bit&7)>5)packed[(bit>>3)+1]|=code>>(8-(bit&7))});const blocks=[];for(let i=0;i<packed.length;i+=255){const block=packed.subarray(i,i+255);blocks.push(Buffer.from([block.length]),block)}frames.push(Buffer.from([33,249,4,4,5,0,0,0,44,0,0,0,0,96,0,64,0,0,2]),...blocks,Buffer.from([0]))}
 return Buffer.concat([header,...frames,Buffer.from([59])])
}
const fixtures=[{name:'BMP',type:'image/bmp',bytes:[...bmp()]},{name:'GIF',type:'image/gif',bytes:[...gif()]}]
await mkdir('tests/fixtures/image-formats',{recursive:true})
await writeFile('tests/fixtures/image-formats/small.bmp',Buffer.from(fixtures[0].bytes));await writeFile('tests/fixtures/image-formats/animated.gif',Buffer.from(fixtures[1].bytes))
const avifPath=process.env.AVIF_FIXTURE||'tests/fixtures/image-formats/color.avif'
try{fixtures.push({name:'AVIF',type:'image/avif',bytes:[...await readFile(avifPath)]})}catch{throw new Error(`A real AVIF fixture is required: ${avifPath}`)}
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:375,height:812}}),external=[],errors=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==base){external.push(url.origin);return route.abort()}if(url.pathname==='/__image_format_review__')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>真实图像格式转换验收</title><style>body{font:16px system-ui;margin:16px;background:#f5f7f3;color:#173d38}section{background:white;border-radius:14px;padding:14px;margin-bottom:14px}img{width:128px;height:90px;object-fit:contain;display:block;background:#edf2ef}p{font-size:13px}</style><h2>真实图像转换</h2>'});return route.continue()})
try{
 await page.goto(`${base}/__image_format_review__`)
 const result=await page.evaluate(async fixtures=>{
  const api=await import('/src/_mobile-core/image-prepare.ts'),limits={maxBytes:8*1024*1024,maxPixels:24000000,maxEdge:2048},checks=[]
  const source=document.createElement('canvas');source.width=96;source.height=64;const context=source.getContext('2d');context.fillStyle='rgb(230,30,20)';context.fillRect(0,0,48,64);context.fillStyle='rgb(20,180,20)';context.fillRect(48,0,48,64)
  const webp=await new Promise(resolve=>source.toBlob(resolve,'image/webp',.85));fixtures.push({name:'WebP',type:'image/webp',bytes:[...new Uint8Array(await webp.arrayBuffer())]})
  context.clearRect(0,0,48,64);const alpha=await new Promise(resolve=>source.toBlob(resolve,'image/webp',1));fixtures.push({name:'WebP alpha',type:'image/webp',bytes:[...new Uint8Array(await alpha.arrayBuffer())]})
  const final=[]
  for(const fixture of fixtures){
   const original=URL.createObjectURL(new Blob([new Uint8Array(fixture.bytes)],{type:fixture.type}));let prepared
   try{
    prepared=await api.prepareUploadImage(original,limits)
    if(prepared.path===original)throw new Error(fixture.name+' small input was not normalized')
    const copy=await(await fetch(prepared.path)).blob(),header=api.uploadImageMetadata(new Uint8Array(await copy.arrayBuffer()))
    if(copy.type!=='image/jpeg'||header.format!=='jpeg')throw new Error(fixture.name+' not a real JPEG')
    const bitmap=await createImageBitmap(copy),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0)
    const pixel=[...ctx.getImageData(Math.floor(bitmap.width/4),Math.floor(bitmap.height/2),1,1).data]
    if(fixture.name==='GIF'&&!(pixel[0]>190&&pixel[1]<80&&pixel[2]<80))throw new Error('GIF must use the actual red first frame, not its later green frame')
    if(fixture.name==='WebP alpha'&&!pixel.slice(0,3).every(value=>value>=250))throw new Error('Transparent WebP must be flattened onto white')
    if(fixture.name!=='AVIF'&&(bitmap.width!==96||bitmap.height!==64))throw new Error(fixture.name+' dimensions changed')
    if(bitmap.width!==prepared.width||bitmap.height!==prepared.height)throw new Error(fixture.name+' output dimensions mismatch')
    const card=document.createElement('section'),title=document.createElement('b'),img=document.createElement('img'),text=document.createElement('p');title.textContent=fixture.name+' → JPEG';img.src=canvas.toDataURL('image/png');text.textContent=`${prepared.width} × ${prepared.height} · 真实像素转换${fixture.name==='GIF'?' · 静态第一帧':''}`;card.append(title,img,text);document.body.append(card)
    bitmap.close();canvas.width=canvas.height=0;prepared.dispose();prepared.dispose()
    let released=false;try{await fetch(prepared.path)}catch{released=true}if(!released||!(await fetch(original)).ok)throw new Error('wrong URL ownership cleanup')
    checks.push(`${fixture.name}: genuine JPEG output even below 2048px, dimensions checked, generated URL released and original retained`)
    final.push({format:fixture.name,width:prepared.width,height:prepared.height,pixel,bytes:copy.size})
   }finally{prepared?.dispose();URL.revokeObjectURL(original)}
  }
  // A local decoder extension must still return a checked bitmap format, never arbitrary content.
  const unsupported=URL.createObjectURL(new Blob(['not-a-supported-image-but-large-enough'],{type:'application/octet-stream'}))
  try{let rejected=false;try{await api.prepareUploadImage(unsupported,limits,{normalizeUnsupportedImage:async()=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'],{type:'image/png'})})}catch{rejected=true}if(!rejected)throw new Error('decoder extension bypassed output validation');checks.push('decoder extension output is independently validated; disguised SVG is rejected')}finally{URL.revokeObjectURL(unsupported)}
  const decoderSource=URL.createObjectURL(new Blob(['unsupported-image-for-cancellation-test']))
  try {
   const controller=new AbortController();let suppliedSignal,started
   const entering=new Promise(resolve=>started=resolve)
   const job=api.prepareUploadImage(decoderSource,limits,{signal:controller.signal,normalizeUnsupportedImage:(_source,_limits,options)=>{suppliedSignal=options.signal;started();return new Promise(()=>{})}})
   const outcome=job.then(()=> 'completed',error=>error.code)
   await entering;controller.abort()
   if(await outcome!=='UPLOAD_CANCELLED'||suppliedSignal!==controller.signal)throw new Error('normalizer cancellation not propagated')
   checks.push('cancelling a stalled normalizer settles promptly and passes the same lifecycle signal to the host decoder')
  } finally { URL.revokeObjectURL(decoderSource) }
  const bitmapSource=URL.createObjectURL(webp), originalCreate=createImageBitmap
  let finishBitmap,bitmapEntered,lateClosed=false
  const waitingBitmap=new Promise(resolve=>bitmapEntered=resolve)
  window.createImageBitmap=()=>{bitmapEntered();return new Promise(resolve=>finishBitmap=resolve)}
  try {
   const controller=new AbortController(), job=api.prepareUploadImage(bitmapSource,limits,{signal:controller.signal})
   const outcome=job.then(()=> 'completed',error=>error.code)
   await waitingBitmap;controller.abort()
   if(await outcome!=='UPLOAD_CANCELLED')throw new Error('bitmap cancel did not settle')
   finishBitmap({close(){lateClosed=true}});await Promise.resolve();await Promise.resolve()
   if(!lateClosed)throw new Error('late cancelled bitmap not closed')
   checks.push('cancelling an in-flight bitmap decode rejects immediately and closes its late result')
  } finally { window.createImageBitmap=originalCreate;URL.revokeObjectURL(bitmapSource) }
  return{checks,final,webpBytes:[...new Uint8Array(await webp.arrayBuffer())]}
 },fixtures)
 assert.ok(result.final.some(item=>item.format==='AVIF'));assert.deepEqual(external,[]);assert.deepEqual(errors,[])
 await writeFile('tests/fixtures/image-formats/small.webp',Buffer.from(result.webpBytes));delete result.webpBytes
 await page.screenshot({path:`${output}/real-conversions-375.png`,fullPage:true})
 await writeFile(`${output}/result.json`,JSON.stringify({...result,external,errors},null,2));console.log(JSON.stringify({...result,external,errors},null,2))
}catch(error){await page.screenshot({path:`${output}/failure.png`,fullPage:true});throw error}finally{await browser.close()}
