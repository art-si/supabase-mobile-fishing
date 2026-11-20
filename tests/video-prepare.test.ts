import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { Input, Output, BufferSource, BufferTarget, MP4, Conversion, MovOutputFormat, Mp4OutputFormat } from 'mediabunny'
import { inspectMp4Video } from '../src/_mobile-core/video-prepare'

const maximum=20*1024*1024,source=new Uint8Array(readFileSync(new URL('./fixtures/flower-cc0.mp4',import.meta.url)))
async function fixture(format: MovOutputFormat|Mp4OutputFormat, mute=false) {
  const input=new Input({source:new BufferSource(source),formats:[MP4]}),target=new BufferTarget(),output=new Output({format,target})
  try { const conversion=await Conversion.init({input,output,audio:mute?{discard:true}:undefined});await conversion.execute();return new Uint8Array(target.buffer!) } finally {input.dispose()}
}
const mov=fixture(new MovOutputFormat()),silent=fixture(new Mp4OutputFormat(),true)
function nativeSource(source:string) {
  const enabled=[true]
  return source.split('\n').filter(line=>{
    const directive=line.match(/^\s*\/\/ #(ifdef|ifndef|endif)(?:\s+(\S+))?/)
    if(!directive)return enabled.at(-1)
    if(directive[1]==='endif')enabled.pop()
    else enabled.push(Boolean(enabled.at(-1))&&(directive[1]==='ifdef'?directive[2]==='MP-WEIXIN':directive[2]!=='MP-WEIXIN'))
    return false
  }).join('\n')
}
function harness(original:Uint8Array,converted=source,delayed=false) {
  const files=new Map([['wxfile://source.mov',original],['wxfile://converted.mp4',converted]]),removed:string[]=[],calls:string[]=[]
  let complete:undefined|(()=>void)
  const exports:any={}
  runInNewContext(ts.transpileModule(nativeSource(readFileSync(new URL('../src/_mobile-core/video-prepare.ts',import.meta.url),'utf8')),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,Error,setTimeout,clearTimeout,
    uni:{
      getFileInfo(options:any){calls.push('size');options.success({size:files.get(options.filePath)!.byteLength})},
      getFileSystemManager(){return{
        readFile(options:any){calls.push('read');const bytes=files.get(options.filePath)!;options.success({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})},
        unlink(options:any){removed.push(options.filePath)}
      }},
      compressVideo(options:any){calls.push('compress');assert.equal(options.quality,'high');complete=()=>options.success({tempFilePath:'wxfile://converted.mp4'});if(!delayed)complete()}
    }
  })
  return{api:exports,calls,removed,complete:()=>complete?.()}
}
test('real MP4/MOV headers identify H264/AAC, track counts, and do not trust filenames',async()=>{
  assert.deepEqual(inspectMp4Video(source),{compatible:true,videoTracks:1,audioTracks:1,width:960,height:540})
  assert.equal(inspectMp4Video(await mov)?.compatible,false)
  const m=harness(source),prepared=await m.api.prepareUploadVideo('wxfile://source.mov',maximum)
  assert.equal(prepared.path,'wxfile://source.mov');prepared.dispose()
  assert.equal(m.calls.includes('compress'),false);assert.deepEqual(m.removed,[])
})
test('native MOV conversion verifies the returned codec/audio and disposes only its copy',async()=>{
  const m=harness(await mov),prepared=await m.api.prepareUploadVideo('wxfile://source.mov',maximum)
  assert.equal(prepared.path,'wxfile://converted.mp4');assert.ok(m.calls.includes('compress'))
  prepared.dispose();prepared.dispose();assert.deepEqual(m.removed,['wxfile://converted.mp4'])
})
test('native conversion refuses to silently drop original audio',async()=>{
  const m=harness(await mov,await silent)
  await assert.rejects(m.api.prepareUploadVideo('wxfile://source.mov',maximum),{code:'VIDEO_CONVERSION_UNAVAILABLE'})
  assert.deepEqual(m.removed,['wxfile://converted.mp4'])
})
test('input size and unreadable native containers fail before conversion or upload',async()=>{
  const large=harness(new Uint8Array(maximum+1))
  await assert.rejects(large.api.prepareUploadVideo('wxfile://source.mov',maximum),{code:'VIDEO_TOO_LARGE'})
  assert.deepEqual(large.calls,['size'])
  const unknown=harness(new Uint8Array(64))
  await assert.rejects(unknown.api.prepareUploadVideo('wxfile://source.mov',maximum),{code:'VIDEO_CONVERSION_UNAVAILABLE'})
  assert.equal(unknown.calls.includes('compress'),false)
})
test('native cancellation settles immediately and removes a late compressed copy',async()=>{
  const m=harness(await mov,source,true),controller=new AbortController()
  const pending=m.api.prepareUploadVideo('wxfile://source.mov',maximum,{signal:controller.signal})
  await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(m.calls.includes('compress'))
  controller.abort();await assert.rejects(pending,{code:'UPLOAD_CANCELLED'})
  m.complete();assert.deepEqual(m.removed,['wxfile://converted.mp4'])
})
test('malformed box lengths never produce a compatible-video verdict',()=>{
  for(const bytes of [new Uint8Array(),source.slice(0,40),Uint8Array.from([0,0,0,1,102,116,121,112,255,255,255,255,255,255,255,255])])assert.equal(inspectMp4Video(bytes),null)
})
