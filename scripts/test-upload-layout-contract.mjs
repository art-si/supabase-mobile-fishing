// Shared source-SFC layout + official WXML/WXSS parser contract. No SDK, product
// build, real camera, hosted upload, or physical-device acceptance is performed.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { build } from 'vite'
import { parse, compileScript, compileStyle } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as sass from 'sass'
import { chromium } from 'playwright'
import { resolveMobileProRoot } from './mobile-pro.mjs'

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const wcc = argument('--compiler') || process.env.WECHAT_WXML_COMPILER
const wcsc = argument('--style-compiler') || process.env.WECHAT_WXSS_COMPILER
assert.ok(wcc && wcsc, 'Provide the official wcc and wcsc paths with --compiler and --style-compiler.')
const output = resolve(argument('--artifacts') || 'artifacts/upload-layout-20261124'), core = resolve(resolveMobileProRoot(), 'packages/mobile-core/src').replaceAll('\\', '/')
await mkdir(output, { recursive: true })
const css = [], nativeStyles = [], nativeTemplates = [], nativeWrites = [], errors = [], checks = [], requests = []
const require = createRequire(import.meta.url)
const compiler = require(resolve('node_modules/.pnpm/@dcloudio+uni-mp-compiler@3_cfc7dde158b5167038cb537ac70bff8a/node_modules/@dcloudio/uni-mp-compiler/dist/index.js'))
function platform(source, name) {
 const enabled=[true]
 return source.split('\n').filter(line=>{const d=line.match(/^\s*(?:\/\/|\/\*|<!--)\s*#(ifdef|ifndef|endif)(?:\s+([\w-]+))?/);if(!d)return enabled.at(-1);if(d[1]==='endif')enabled.pop();else enabled.push(enabled.at(-1)&&(d[1]==='ifdef'?d[2]===name:d[2]!==name));return false}).join('\n')
}
const targets = ['MobileEvidence', 'MobileMediaUploader', 'MobileCommentComposer', 'MobileMediaTray']
for (const name of targets) {
 const path = `${core}/components/${name}.vue`, { descriptor } = parse(platform(await readFile(path, 'utf8'), 'MP-WEIXIN'), { filename: path })
 const script = compileScript(descriptor, { id: `native-${name}` })
 const scope = `data-v-native-${name.toLowerCase()}`
 compiler.compile(descriptor.template.content, { filename: `${name}.wxml`, mode: 'module', scopeId:scope, bindingMetadata: script.bindings,
  isCustomElement:tag=>['view','text','button','image','scroll-view','textarea'].includes(tag),
  miniProgram: { class: {array:true}, directive: 'wx:', event: { key:true }, slot: {fallbackContent:false,dynamicSlotNames:true},
   component: {':host':true,dir:'wxcomponents'}, emitFile(file) { nativeTemplates.push(file.fileName); nativeWrites.push(writeFile(resolve(output, file.fileName), file.source)) } } })
 let styleCode = ''
 for (const style of descriptor.styles) {
  const result = compileStyle({ source: style.content, filename: path, id:scope, scoped:style.scoped, preprocessLang:style.lang })
  assert.deepEqual(result.errors, []); styleCode += result.code
 }
 const styleName = `${name}.wxss`; nativeStyles.push(styleName); await writeFile(resolve(output, styleName), styleCode)
}
// emitFile may return a promise; wait until all four concrete outputs exist.
await Promise.all(nativeWrites)
for (const [executable, args, label] of [
 [wcc, ['-o', resolve(output,'native-wxml.js'), ...nativeTemplates.map(file=>`./${file}`)], 'wxml'],
 [wcsc, ['-lc','-pc',String(nativeStyles.length),'-o',resolve(output,'native-wxss.js'),...nativeStyles], 'wxss'],
]) {
 const result=spawnSync(executable,args,{cwd:output,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024})
 await writeFile(resolve(output,`native-${label}.json`),JSON.stringify({exitCode:result.status,error:result.error?.message||'',diagnostics:`${result.stdout||''}${result.stderr||''}`.trim()},null,2))
 assert.equal(result.error,undefined); assert.equal(result.status,0,`official ${label} parser must accept the actual shared source templates/styles`)
}
const trayWxml = await readFile(resolve(output,'MobileMediaTray.wxml'),'utf8')
assert.match(trayWxml,/<scroll-view\b[^>]*scroll-x=/); assert.match(trayWxml,/scroll-y="{{false}}"/)
const trayStyle = await readFile(resolve(output,'MobileMediaTray.wxss'),'utf8')
assert.match(trayStyle,/height:\s*112px/)
const evidenceStyle = await readFile(resolve(output,'MobileEvidence.wxss'),'utf8')
assert.match(evidenceStyle,/flex:\s*0 0 112px/); assert.doesNotMatch(evidenceStyle,/(?:top|right):\s*-\d/)
for (const host of ['src/pages/post/components/PostComments.vue','src/components/SpotCommentsSheet.vue'])
 assert.doesNotMatch(await readFile(host,'utf8'),/mobile-comment-composer__attachments[^\n]*max-height/,'host must not clip the shared attachment tray')

const photo=`data:image/png;base64,${(await readFile('assets/brand/fish-symbol.png')).toString('base64')}`
const entry=resolve(output,'entry.mjs')
await writeFile(entry, `import {createApp,h,ref} from 'vue';import Uploader from ${JSON.stringify(`${core}/components/MobileMediaUploader.vue`)};import Composer from ${JSON.stringify(`${core}/components/MobileCommentComposer.vue`)};
const make=n=>Array.from({length:n},(_,i)=>({key:'fixture-'+i,path:${JSON.stringify(photo)},kind:i%2?'video':'image',poster:${JSON.stringify(photo)},duration:12,asset:{id:'media-'+i,path:'fixture/'+i,kind:i%2?'video':'image',width:640,height:480}}));
const normal=ref(make(2)),compact=ref(make(2)),picker=ref();window.fixture={previews:0,uploads:0,choices:0,setCount:n=>{normal.value=make(n);compact.value=make(Math.min(n,6))},setEmpty:()=>{normal.value=[];compact.value=[]},setBroken:()=>{for(const items of [normal,compact])items.value=[{...make(1)[0],path:'data:image/png;base64,AAAA'}]},setRetry:()=>{for(const items of [normal,compact])items.value=[{...make(1)[0],asset:undefined,error:'上传未完成，请重试。',retryable:true}]}};
const upload=async path=>{window.fixture.uploads++;return{id:'isolated-upload',kind:'image',path,width:80,height:80}};
const props=(items,dense)=>({modelValue:items.value,'onUpdate:modelValue':v=>{items.value=v},scope:dense?'comment':'post',active:true,disabled:false,limit:dense?6:9,accept:['image','video'],uploadImage:upload,uploadVideo:upload,errorText:String,compact:dense,hideAddButton:dense,uploadLabel:'添加图片 / 视频'});
createApp({render(){return h('main',{},[h('section',{class:'card',id:'form'},[h('div',{class:'heading'},[h('strong',{},'图片 / 视频'),h('span',{},normal.value.length+' / 9')]),h(Uploader,props(normal,false)),h('p',{class:'caption'},'照片和视频可混合添加，最多9项。')]),h('section',{class:'card',id:'comment'},[h(Composer,{showCamera:true,sendDisabled:false,showMeta:true,onMedia:()=>{window.fixture.choices++;picker.value.choose('album')},onCamera:()=>{window.fixture.choices++;picker.value.choose('camera')}},{default:()=>h('textarea',{value:'分享有用的经验，友善交流',style:'display:block;width:100%;height:68px;border:0;resize:none;background:transparent;color:inherit;font:inherit'}),attachments:()=>h(Uploader,{...props(compact,true),ref:picker}),meta:()=>h('span',{},'附件 '+compact.value.length+'/6')})])]);}}).component('scroll-view',{props:{scrollX:Boolean,scrollY:Boolean},setup(props,{slots,attrs}){return()=>h('div',{...attrs,'data-native-scroll':true,style:{overflowX:props.scrollX?'auto':'hidden',overflowY:'hidden',scrollbarWidth:'none'}},slots.default?.())}}).component('image',{props:['src'],setup(p,{attrs}){return()=>h('img',{...attrs,src:p.src})}}).component('wd-icon',{setup(){return()=>h('span',{'aria-hidden':true,class:'fixture-video-icon'},'▶')}}).mount('#app');`)
css.push(sass.compileString(await readFile(`${core}/styles/icons.scss`,'utf8')+'\n@include embed();').css)
css.push(sass.compileString('@use "actions"; @include actions.apply("tms");',{loadPaths:[`${core}/styles`]}).css)
const bundle=await build({configFile:false,logLevel:'error',resolve:{alias:{vue:import.meta.resolve('vue/dist/vue.esm-bundler.js').replace('file:///','')}},
 define:{'process.env.NODE_ENV':JSON.stringify('production'),__VUE_OPTIONS_API__:true,__VUE_PROD_DEVTOOLS__:false,__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:false},
 plugins:[{name:'isolated-upload-source',async transform(source,id){
  if(/\/(?:MobileImagePreview|MobileVideoViewer|MobileBottomSheet)\.vue$/.test(id))return `import {h,watch} from 'vue';export default {props:['modelValue'],setup(p,{expose}){expose({open(){window.fixture.previews++}});watch(()=>p.modelValue,v=>{if(v)window.fixture.previews++});return()=>null}}`
  if(id.startsWith(core)&&id.endsWith('.ts'))return ts.transpileModule(platform(source,'H5'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  if(!id.endsWith('.vue'))return
  // A plain browser has no Uni image component; adapt only that platform tag,
  // while keeping the real uploader markup, CSS, events and image source.
  const browserSource=platform(source,'H5').replace(/<image\b/g,'<img').replace(/<\/image>/g,'</img>')
  const scope='data-v-'+createHash('sha1').update(id).digest('hex').slice(0,8),{descriptor}=parse(browserSource,{filename:id})
  const script=compileScript(descriptor,{id:scope,inlineTemplate:true,genDefaultAs:'__component',templateOptions:{compilerOptions:{scopeId:scope}}})
  for(const style of descriptor.styles){const result=compileStyle({source:style.content,filename:id,id:scope,scoped:style.scoped,preprocessLang:style.lang});assert.deepEqual(result.errors,[]);css.push(result.code)}
  return ts.transpileModule(script.content+`\n__component.__scopeId=${JSON.stringify(scope)};export default __component;`,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
 }}],build:{write:false,minify:false,lib:{entry,name:'UploadLayoutContract',formats:['iife']}}})
const code=(Array.isArray(bundle)?bundle[0]:bundle).output.find(value=>value.type==='chunk').code
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:375,height:1000}})
page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{requests.push(route.request().url());return route.abort()})
try {
 await page.setContent(`<style>*{box-sizing:border-box}html{font-size:16px}body{margin:0;padding:16px;font:1rem Arial,sans-serif;background:#F5F7F5;color:#182D27}view{display:block}img{object-fit:cover}button{font:inherit}.card{padding:16px;margin:0 0 20px;border-radius:20px;background:#fff}.heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px}.heading span,.caption{font-size:.75rem;color:#536a63}.caption{margin:12px 0 0}.fixture-video-icon{display:block;font-size:24px;line-height:30px;text-align:center}#app{--mobile-workspace-line:#dae3dd;--mobile-workspace-accent:#116b5d;--mobile-workspace-ink:#182D27;--mobile-workspace-muted:#536a63;--mobile-workspace-on-accent:#fff;--tms-surface-muted:#edf3ef;--tms-surface-soft:#edf3ef;--tms-control-radius:12px}${css.join('\n')}</style><div id="app"></div>`)
 await page.addScriptTag({content:code})
 for(const [size,width,height,large] of [['320',320,812,false],['375',375,812,false],['440',440,956,false],['landscape',844,390,false],['wide',1280,900,false],['large',320,812,true],['dark-large',320,812,true]]) {
  await page.setViewportSize({width,height});await page.addStyleTag({content:`html{font-size:${large?24:16}px}`})
  if(size==='dark-large')await page.addStyleTag({content:'body{background:#111d1b;color:#e8f1eb}.card{background:#192725}#app{--mobile-workspace-line:#3c5149;--mobile-workspace-accent:#82d8c5;--mobile-workspace-ink:#e8f1eb;--mobile-workspace-muted:#a1b4aa;--mobile-workspace-on-accent:#123b31;--tms-surface-muted:#24382f;--tms-surface-soft:#24382f}'})
  for(const count of size==='dark-large'?[2]:[1,2,6,9]) {
   await page.evaluate(count=>window.fixture.setCount(count),count)
   await page.locator('#form .mobile-evidence__item').nth(count-1).waitFor()
   await page.waitForFunction(()=>[...document.querySelectorAll('.mobile-media-uploader__image')].every(image=>image.tagName==='IMG'&&image.complete&&image.naturalWidth>0))
   const geometry=await page.evaluate(()=>{
    const r=node=>{if(!node)return null;const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}}
    const form=document.querySelector('#form'),comment=document.querySelector('#comment'),tray=comment.querySelector('.mobile-media-tray--horizontal'),toolbar=comment.querySelector('.mobile-comment-composer__toolbar')
    return {viewport:r(tray),toolbar:r(toolbar),attachments:r(comment.querySelector('.mobile-comment-composer__attachments')),heading:r(form.querySelector('.heading')),add:r(form.querySelector('.mobile-evidence__add')),items:[...document.querySelectorAll('.mobile-evidence__item')].map(item=>({context:item.closest('#comment')?'comment':'form',tile:r(item),preview:r(item.querySelector('.mobile-evidence__preview')),remove:r(item.querySelector('.mobile-evidence__remove')),mark:r(item.querySelector('.mobile-evidence__remove-mark'))})),pageWidth:document.documentElement.scrollWidth,windowWidth:innerWidth}
   })
   assert.ok(geometry.pageWidth<=geometry.windowWidth+1)
   assert.ok(geometry.items.every(i=>i.tile.width===112&&i.tile.height===112&&i.remove.width===48&&i.remove.height===48))
   assert.ok(geometry.items.every(i=>i.remove.x>=i.tile.x&&i.remove.y>=i.tile.y&&i.remove.right<=i.tile.right+.1&&i.remove.bottom<=i.tile.bottom+.1))
   assert.ok(geometry.items.every(i=>!(i.preview.x+i.preview.width/2>=i.remove.x&&i.preview.x+i.preview.width/2<=i.remove.right&&i.preview.y+i.preview.height/2>=i.remove.y&&i.preview.y+i.preview.height/2<=i.remove.bottom)))
   const comments=geometry.items.filter(i=>i.context==='comment'),forms=geometry.items.filter(i=>i.context==='form')
   assert.ok(comments.every(i=>i.tile.y>=geometry.viewport.y-.1&&i.tile.bottom<=geometry.viewport.bottom+.1),'every comment thumbnail must be vertically complete')
   assert.ok(geometry.toolbar.y>=geometry.viewport.bottom+7,'toolbar must remain below the full attachment tray')
   assert.ok(geometry.toolbar.y>=geometry.attachments.bottom-.1)
   assert.ok(forms[0].tile.y>=geometry.heading.bottom+11)
   if(count<9)assert.ok(geometry.add.y>=Math.max(...forms.map(i=>i.tile.bottom))+11)
   else assert.equal(geometry.add,null,'full form must not offer an unusable add button')
   const offsets=geometry.items.map(i=>`${Math.round(i.mark.y-i.preview.y)}:${Math.round(i.preview.right-i.mark.right)}`);assert.equal(new Set(offsets).size,1)
   await page.screenshot({path:resolve(output,`layout-${size}-${count}.png`),fullPage:true});checks.push({size,count,geometry})
  }
 }
 await page.setViewportSize({width:375,height:1000});await page.addStyleTag({content:'html{font-size:16px}'})
 await page.evaluate(()=>window.fixture.setBroken());await page.waitForFunction(()=>[...document.querySelectorAll('.mobile-media-uploader__image')].every(image=>image.complete&&!image.naturalWidth))
 assert.equal(await page.locator('.mobile-evidence__original').count(),0,'custom preview already owns the original-image action; a failed thumbnail must not add another row')
 await page.evaluate(()=>window.fixture.setRetry());await page.getByRole('button',{name:'重试上传',exact:true}).last().waitFor()
 assert.ok(await page.locator('#comment').evaluate(root=>{const retry=root.querySelector('.mobile-media-uploader__retry').getBoundingClientRect(),tile=root.querySelector('.mobile-evidence__item').getBoundingClientRect(),tray=root.querySelector('.mobile-media-tray--horizontal').getBoundingClientRect(),toolbar=root.querySelector('.mobile-comment-composer__toolbar').getBoundingClientRect();return retry.bottom<=tile.bottom+.1&&retry.top>=tile.top+tile.height/2+8&&toolbar.top>=tray.bottom+8}))
 await page.screenshot({path:resolve(output,'layout-retry.png'),fullPage:true})
 await page.evaluate(()=>window.fixture.setCount(2))
 await page.locator('#comment .mobile-evidence__preview').first().click();assert.equal(await page.evaluate(()=>window.fixture.previews),1)
 await page.locator('#comment .mobile-evidence__remove').first().click();assert.equal(await page.locator('#comment .mobile-evidence__item').count(),1);assert.equal(await page.evaluate(()=>window.fixture.previews),1);assert.equal(await page.evaluate(()=>window.fixture.choices),0)
 await page.evaluate(()=>window.fixture.setCount(6));await page.locator('#comment [data-native-scroll]').evaluate(node=>{node.scrollLeft=node.scrollWidth})
 await page.locator('#comment .mobile-evidence__remove').last().click();assert.equal(await page.locator('#comment .mobile-evidence__item').count(),5);assert.equal(await page.evaluate(()=>window.fixture.previews),1)
 await page.evaluate(()=>window.fixture.setEmpty());const choose=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加图片 / 视频',exact:true}).last().click();const input=await choose
 await input.setFiles({name:'isolated.png',mimeType:'image/png',buffer:await readFile('assets/brand/fish-symbol.png')});await page.waitForFunction(()=>window.fixture.uploads===1)
 assert.equal(await page.locator('#comment .mobile-evidence__item').count(),1);assert.equal(await page.evaluate(()=>window.fixture.choices),1)
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
 await writeFile(resolve(output,'result.json'),JSON.stringify({checks,errors,requests,interactive:{deleteDidNotPreviewOrChoose:true,lastHorizontalItemRemovable:true,emptyPickerStayedMounted:true},boundary:'Actual shared source SFC/browser geometry and official WXML/WXSS parser. Native chooser callbacks, physical keyboard and phone rendering remain device acceptance.'},null,2))
 console.log(JSON.stringify({passed:true,layouts:checks.length,errors,requests,officialParsers:true},null,2))
} catch(error) { await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{}); throw error }
finally { await browser.close() }
