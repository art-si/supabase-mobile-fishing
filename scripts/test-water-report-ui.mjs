// Isolated browser/API/GPS contract fixtures. No real upload, location, dial or report write.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFile,mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178',output='artifacts/water-report-ui',owner='11111111-1111-4111-8111-111111111111'
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname))
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const checks=[],errors=[],writes=[],uploads=[],escaped=[]
async function open(mode='success',saved){
 const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'})
 await context.addInitScript(({owner,mode,saved})=>{
  if(mode!=='guest')localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'water-report-ui-contract',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
  if(saved)localStorage.setItem(`dyj.live.draft.${owner}.water-report`,JSON.stringify({type:'object',data:saved}))
  window.locationCalls=0
  Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:mode==='denied'?'denied':'granted'})}})
  window.AMap={
   Geolocation:class{getCurrentPosition(callback){window.locationCalls++;const done=()=>callback('complete',{position:{getLng:()=>115.2,getLat:()=>29.84},accuracy:12,location_type:'html5'});if(mode==='late')window.releaseLocation=done;else setTimeout(done,15)}},
   Geocoder:class{getAddress(point,callback){const cross=point[0]>120;setTimeout(()=>callback('complete',{regeocode:{formattedAddress:cross?'浙江省宁波市海曙区（隔离跨市样本）':'湖北省黄石市阳新县富池镇长江沿岸（隔离定位样本）',addressComponent:cross?{adcode:'330203',province:'浙江省',city:'宁波市',district:'海曙区'}:{adcode:'420222',province:'湖北省',city:'黄石市',district:'阳新县'}}}),15)}}
  }
 },{owner,mode,saved})
 await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
  const reply=(json,status=200)=>route.fulfill({status,headers,json})
  if(url.origin!=='https://tlfmfokyhahlpzmpliad.supabase.co'){escaped.push(url.origin+url.pathname);return route.abort()}
  if(request.method()==='OPTIONS')return reply({})
  if(url.pathname==='/auth/v1/user')return reply({id:owner})
  if(url.pathname==='/functions/v1/media-upload'){
   const kind=request.postDataBuffer().includes(Buffer.from('name="kind"\r\n\r\nvideo'))?'video':'image',id=`${String(uploads.length+1).padStart(8,'0')}-4444-4444-8444-444444444444`
   const asset={id,path:`${owner}/${id}.${kind==='video'?'mp4':'jpg'}`,kind,width:kind==='video'?960:64,height:kind==='video'?540:64,duration:kind==='video'?5:undefined,size:1000}
   uploads.push(asset);return reply(asset)
  }
  if(url.pathname.endsWith('fishing_read'))return reply({items:[],next:null})
  if(url.pathname.endsWith('fishing_write')){writes.push(request.postDataJSON());return reply({})}
  return reply({items:[]})
 })
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`${base}/#/pages/water-report/index`,{waitUntil:'domcontentloaded'})
 await page.locator('#report-region').waitFor()
 return{context,page}
}
async function chooseDistrict(page,name){
 await page.locator('#report-region').click()
 const dialog=page.getByRole('dialog',{name:'选择事发地区',exact:true});await dialog.waitFor()
 await dialog.locator('input[aria-label="搜索地区"]').fill(name)
 await dialog.getByRole('button',{name:`选择${name}`,exact:true}).click()
 await dialog.waitFor({state:'hidden'})
}
try{
 let session=await open(),page=session.page
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('阳新县') && document.querySelector('input[aria-label="具体水域与位置"]')?.value.includes('隔离定位样本'))
 assert.match(await page.locator('input[aria-label="具体水域与位置"]').inputValue(),/隔离定位样本/)
 assert.equal(await page.evaluate(()=>window.locationCalls),1)
 assert.equal(await page.getByRole('button',{name:'填入当前位置',exact:true}).count(),0)
 const now=await page.evaluate(()=>{const d=new Date(),n=v=>String(v).padStart(2,'0');return`${d.getFullYear()}-${n(d.getMonth()+1)}-${n(d.getDate())} ${n(d.getHours())}:${n(d.getMinutes())}`})
 assert.ok((await page.locator('#report-time').innerText()).includes(now.slice(0,10)))
 assert.ok((await page.locator('#report-time-time').innerText()).includes(now.slice(11)))
 await page.getByRole('button',{name:'选择事发时间',exact:true}).click()
 const timeDialog=page.getByRole('dialog',{name:'选择事发时间',exact:true});await timeDialog.waitFor()
 await page.screenshot({path:`${output}/time-375.png`})
 await page.keyboard.press('Escape');await timeDialog.waitFor({state:'hidden'})
 checks.push('one real-adapter GPS request fills region and detailed place in the fixture; date/time defaults to now and opens the shared themed picker')
 await page.evaluate(async()=>{let component=document.querySelector('.fishing-content').__vueParentComponent;while(component && !component.setupState.applySelectedPlace)component=component.parent;await component.setupState.applySelectedPlace({longitude:121.55,latitude:29.87,name:'宁波选中的河段'})})
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('海曙区') && document.querySelector('input[aria-label="具体水域与位置"]')?.value==='宁波选中的河段')
 assert.match(await page.locator('#report-region').innerText(),/浙江省.*宁波市.*海曙区/)
 checks.push('selected coordinates reverse-geocode their own province/city/district instead of keeping a previous city')
 await chooseDistrict(page,'郎溪县')
 assert.match(await page.locator('#report-region').innerText(),/安徽省.*宣城市.*郎溪县/)
 assert.equal(await page.locator('#report-province,#report-city,#report-district').count(),0)
 await page.locator('#report-region').click()
 await page.getByRole('dialog',{name:'选择事发地区',exact:true}).getByRole('button',{name:'北京市',exact:true}).click()
 await page.getByRole('button',{name:'选择朝阳区',exact:true}).click()
 assert.match(await page.locator('#report-region').innerText(),/北京市.*朝阳区/)
 await chooseDistrict(page,'仙桃市')
 assert.equal((await page.locator('#report-region').innerText()).match(/仙桃市/g)?.length,1)
 checks.push('province/city/county uses one searchable picker including direct municipalities')
 const add=page.getByRole('button',{name:'添加图片 / 视频',exact:true})
 assert.equal(await add.isDisabled(),true)
 assert.equal(uploads.length,0)
 await page.getByRole('checkbox',{name:/我确认将文字/}).click()
 const chooser=page.waitForEvent('filechooser');await add.click()
 await(await chooser).setFiles([{name:'evidence.png',mimeType:'image/png',buffer:await readFile('assets/brand/fish-symbol.png')},{name:'evidence.mp4',mimeType:'video/mp4',buffer:await readFile('tests/fixtures/flower-cc0.mp4')}])
 await page.waitForFunction(()=>document.querySelectorAll('.mobile-evidence__item').length===2)
 await page.waitForFunction(()=>document.querySelectorAll('.mobile-media-uploader__progress').length===0)
 await page.waitForFunction(()=>[...document.querySelectorAll('.mobile-evidence__preview')].every(node=>{const image=node.querySelector('img');return image?.complete&&image.naturalWidth>0}))
 assert.equal(uploads.length,2);assert.ok(uploads.some(item=>item.kind==='video'))
 await page.getByRole('button',{name:'预览视频 2',exact:true}).click()
 await page.getByRole('dialog',{name:'视频预览',exact:true}).waitFor()
 await page.getByRole('button',{name:'关闭视频预览',exact:true}).click()
 checks.push('no media request before explicit private-storage consent; mixed photo/video use shared queue and fullscreen video viewer')
 for(const [name,width,height,dark,scale]of[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',812,375,false,16],['wide',1280,800,false,16],['dark-large',320,740,true,24]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  await page.locator('.mobile-evidence__grid').scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>[...document.querySelectorAll('.mobile-evidence__preview')].every(node=>{const image=node.querySelector('img');return image?.complete&&image.naturalWidth>0}))
  await page.locator('#report-region').scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:`${output}/form-${name}.png`,fullPage:true})
  await page.locator('#report-region').click()
  await page.getByRole('dialog',{name:'选择事发地区',exact:true}).waitFor()
  await page.screenshot({path:`${output}/region-${name}.png`})
  await page.keyboard.press('Escape')
 }
 checks.push('320/375/440, landscape, wide and dark large-text forms and region sheets fit without horizontal overflow')
 await session.context.close()
 session=await open('late');page=session.page
 await page.waitForFunction(()=>!!window.releaseLocation)
 await chooseDistrict(page,'郎溪县')
 await page.locator('input[aria-label="具体水域与位置"]').fill('手填的事发河段，不可被迟到定位覆盖')
 await page.evaluate(()=>window.releaseLocation())
 await page.waitForTimeout(150)
 assert.match(await page.locator('#report-region').innerText(),/郎溪县/)
 assert.equal(await page.locator('input[aria-label="具体水域与位置"]').inputValue(),'手填的事发河段，不可被迟到定位覆盖')
 await session.context.close()
 const saved={id:'22222222-2222-4222-8222-222222222222',category:'electric',province:'湖南省',city:'长沙市',district:'雨花区',location_label:'此前保存的私密水域草稿',longitude:null,latitude:null,observed_local:'2026-11-19 08:00',description:'此前保存的现场情况',media:[]}
 session=await open('success',saved);page=session.page
 assert.equal(await page.locator('input[aria-label="具体水域与位置"]').inputValue(),saved.location_label)
 await page.waitForFunction(()=>window.locationCalls===1)
 assert.match(await page.locator('#report-region').innerText(),/雨花区/)
 await session.context.close()
 session=await open('denied');page=session.page
 await page.getByText('暂未获取当前位置，可手动选择地区并填写具体地点。',{exact:true}).waitFor()
 await chooseDistrict(page,'阳新县')
 assert.match(await page.locator('#report-region').innerText(),/阳新县/)
 await session.context.close()
 session=await open('guest');page=session.page
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('阳新县'))
 await chooseDistrict(page,'阳新县')
 assert.equal(await page.evaluate(()=>window.locationCalls),1)
 assert.equal(await page.locator('textarea').count(),0)
 assert.ok(await page.evaluate(()=>!Object.keys(localStorage).some(key=>key.includes('draft.'))))
 await session.context.close()
 checks.push('late location results preserve manual edits and saved drafts; current fix can rank contacts without overwriting prior incidents; denied location permits manual selection; guest automatically fills public region without restoring private drafts')
 session=await open('success',{...saved,description:'',media:[],_edited:false});page=session.page
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('阳新县') && document.querySelector('input[aria-label="具体水域与位置"]')?.value.includes('隔离定位样本'))
 assert.match(await page.locator('input[aria-label="具体水域与位置"]').inputValue(),/隔离定位样本/)
 assert.ok(!(await page.locator('#report-time-time').innerText()).includes('08:00') || now.slice(11)==='08:00')
 await session.context.close()
 checks.push('an empty auto-saved draft refreshes old region, location and time on re-entry')
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks,errors,uploads:uploads.length,writes:writes.length,boundary:'Isolated GPS/API fixtures; actual browser photo/video decoding and interactions. No real GPS, cloud upload, report write, delivery or phone call.'},null,2))
 console.log(JSON.stringify({checks,errors},null,2))
}finally{await browser.close()}
