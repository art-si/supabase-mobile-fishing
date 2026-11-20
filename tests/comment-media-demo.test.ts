import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as seedModule from '../src/demo/seed'
import * as rules from '../src/domain/rules'
import * as composition from '../src/domain/composition'
import * as errors from '../src/domain/user-errors'
import * as water from '../src/domain/water-report'
import * as catches from '../src/domain/trip-catches'
import * as measurements from '../src/domain/catch-measurements'
import * as coordinates from '../src/_mobile-core/coordinates'

test('demo mixed-media comments preserve retries, order, replies, ownership and deletion',()=>{
 const storage=new Map<string,any>(),exports:Record<string,any>={}
 class ApiError extends Error{constructor(message:string,public status:number,public code:string){super(message)}}
 const modules:Record<string,unknown>={'./seed':seedModule,'@/domain/rules':rules,'@/domain/composition':composition,'@/services/http':{ApiError},'@/domain/user-errors':errors,'@/domain/water-report':water,'@/domain/trip-catches':catches,'@/domain/catch-measurements':measurements,'@mobile-core/coordinates':coordinates}
 runInNewContext(ts.transpileModule(readFileSync(new URL('../src/demo/database.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(id:string)=>{assert.ok(id in modules,id);return modules[id]},uni:{getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:unknown)=>storage.set(key,value)}})
 const author=seedModule.me.id,owner=seedModule.chen.id,other=seedModule.lin.id,post=seedModule.seed().posts[0].id,id=rules.createId()
 const image={id:rules.createId(),path:'comment-image.jpg',kind:'image',width:80,height:80},video={id:rules.createId(),path:'comment-video.mp4',kind:'video',width:160,height:90,duration:5}
 for(const asset of [image,video])exports.rememberDemoPhoto(author,asset)
 const input={id,post_id:post,body:'',media:[video,image]},write=(action:string,payload:unknown,user=author)=>exports.execute('write',action,payload,user)
 write('comment',input);write('comment',input)
 const page=()=>exports.execute('read','comments',{id:post},other)
 assert.equal(page().items.filter((c:any)=>c.id===id).length,1)
 assert.equal(page().items.find((c:any)=>c.id===id).media.map((m:any)=>m.id).join(','),`${video.id},${image.id}`)
 assert.throws(()=>write('comment',{...input,media:[image,video]}),/提交内容|评论标识|重新发送|已变化|相同/)
 assert.throws(()=>write('comment',{...input,id:rules.createId()},other),/无权|不可用|操作/)
 const reply=rules.createId();write('comment',{id:reply,post_id:post,body:'回复这张图',reply_to_id:id},owner)
 assert.equal(page().items.find((c:any)=>c.id===reply).reply_to.body,'[图片/视频]')
 assert.throws(()=>write('update_profile',{avatar_id:image.id}),/评论附件不可复用/)
 assert.throws(()=>write('comment',{id:rules.createId(),post_id:post,body:'',media:[]}),/内容|无效|检查/)
 const stored=storage.get('dyj.demo.database.v1'),comment=stored.comments.find((c:any)=>c.id===id)
 comment.status='hidden'
 assert.equal(page().items.some((c:any)=>c.id===id),false)
 assert.equal(page().items.find((c:any)=>c.id===reply).reply_to,null)
 comment.status='published'
 write('delete_comment',{id,post_id:post});write('delete_comment',{id,post_id:post})
 assert.equal(page().items.some((c:any)=>c.id===id),false);assert.equal(comment.media.length,0)
 assert.equal(stored.draftPhotos.some((p:any)=>p.asset.id===image.id||p.asset.id===video.id),false)
 assert.throws(()=>write('comment',input),/不存在|无权/)
})
