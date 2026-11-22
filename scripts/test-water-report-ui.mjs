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
async function open(mode='success',saved,fromHome=false){
 const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'})
 await context.addInitScript(({owner,mode,saved})=>{
  if(mode!=='guest')localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'water-report-ui-contract',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
  if(saved)localStorage.setItem(`dyj.live.draft.${owner}.water-report`,JSON.stringify({type:'object',data:saved}))
  window.locationCalls=0
  Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'granted'})}})
  Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition(done){done({coords:{longitude:115.2,latitude:29.84,accuracy:12}})}}})
  window.AMap={
   Geolocation:class{getCurrentPosition(callback){window.locationCalls++;const done=()=>callback('complete',{position:{getLng:()=>115.2,getLat:()=>29.84},accuracy:12,location_type:'html5'});if(mode==='denied')callback('error',{message:'Geolocation permission denied'});else if(mode==='late')window.releaseLocation=done;else setTimeout(done,15)}},
   Geocoder:class{getAddress([lng],callback){
    let address={adcode:'420222',citycode:'0714',province:'湖北省',city:'黄石市',district:'阳新县'}
    if(lng===114.191333)address={adcode:'420114',citycode:'027',province:'湖北省',city:'武汉市',district:'蔡甸区'}
    else if(lng===121.12)address={adcode:'310118',citycode:'021',province:'上海市',city:'上海市',district:'青浦区'}
    else if(lng>120)address={adcode:'330203',citycode:'0574',province:'浙江省',city:'宁波市',district:'海曙区'}
    else if(lng<112)address={adcode:'420381',citycode:'0719',province:'湖北省',city:'十堰市',district:'丹江口市'}
    setTimeout(()=>callback('complete',{regeocode:{addressComponent:address}}),15)
   }}
  }
 },{owner,mode,saved})
 await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url())
  if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}
  const reply=(json,status=200)=>route.fulfill({status,headers,json})
  if(url.origin!=='https://jupuypvmgjpnpntfetqv.supabase.co'){escaped.push(url.origin+url.pathname);return route.abort()}
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
 await page.goto(`${base}/#${fromHome?'/pages/home/index':'/pages/water-report/index'}`,{waitUntil:'domcontentloaded'})
 if(fromHome){
  assert.equal(await page.getByRole('link',{name:'消息',exact:true}).count(),0)
  await page.getByRole('link',{name:'举报',exact:true}).click()
  await page.waitForURL('**/pages/water-report/index?tabbed=1')
  assert.equal(await page.getByRole('link',{name:'举报',exact:true}).getAttribute('aria-current'),'page')
 }
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
 let session=await open('success',undefined,true),page=session.page
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('阳新县'))
 assert.equal(await page.locator('input[aria-label="具体水域与位置"]').inputValue(),'')
 assert.equal(await page.getByText(/^已选位置：/).count(),0)
 await page.getByRole('link',{name:'举报',exact:true}).focus()
 await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab')
 assert.ok(await page.getByRole('link',{name:'举报',exact:true}).evaluate(node=>node.matches(':focus-visible')))
 await page.screenshot({path:`${output}/report-tab-375.png`})
 assert.equal(await page.evaluate(()=>window.locationCalls),1)
 assert.equal(await page.getByRole('button',{name:'填入当前位置',exact:true}).count(),0)
 const now=await page.evaluate(()=>{const d=new Date(),n=v=>String(v).padStart(2,'0');return`${d.getFullYear()}-${n(d.getMonth()+1)}-${n(d.getDate())} ${n(d.getHours())}:${n(d.getMinutes())}`})
 assert.ok((await page.locator('#report-time').innerText()).includes(now.slice(0,10)))
 assert.ok((await page.locator('#report-time-time').innerText()).includes(now.slice(11)))
 const dateTrigger = page.getByRole('button', { name: '选择事发日期', exact: true })
 await dateTrigger.click()
 const dateDialog = page.getByRole('dialog', { name: '选择事发日期', exact: true })
 await dateDialog.waitFor()
 for (const name of ['取消', '确定']) {
   const button = dateDialog.getByRole('button', { name, exact: true })
   assert.ok(await button.evaluate(node => {
     const { left, top, width, height } = node.getBoundingClientRect()
     return height >= 44 && node.contains(document.elementFromPoint(left + width / 2, top + height / 2))
   }), `The bottom navigation must not cover the calendar's ${name} button`)
 }
 await dateDialog.getByRole('button', { name: '取消', exact: true }).click()
 await dateDialog.waitFor({ state: 'hidden' })
 assert.equal(await dateTrigger.evaluate(node => node === document.activeElement), true)
 checks.push('the report tab calendar keeps both footer actions tappable and restores focus')
 await page.getByRole('button',{name:'选择事发时间',exact:true}).click()
 const timeDialog=page.getByRole('dialog',{name:'选择事发时间',exact:true});await timeDialog.waitFor()
 await page.screenshot({path:`${output}/time-375.png`})
 await page.keyboard.press('Escape');await timeDialog.waitFor({state:'hidden'})
 checks.push('one GPS request fills only the region; the water name and coordinates require a selection; the shared picker defaults to now')
 await page.locator('input[aria-label="具体水域与位置"]').fill('手填的水域名')
 await page.getByRole('textbox',{name:'现场情况'}).fill('测试保存必须有水域坐标')
 await page.getByRole('button',{name:'上报',exact:true}).click()
 await page.getByText('请选择事发水域，获取经纬度',{exact:true}).waitFor()
 assert.equal(writes.length,0)
 assert.equal(await page.getByRole('dialog',{name:'选择举报机构'}).count(),0)
 async function chooseWater(name,longitude,latitude){
  await page.evaluate(async point=>{let c=document.querySelector('.fishing-content').__vueParentComponent;while(c&&!c.setupState.applySelectedPlace)c=c.parent;await c.setupState.applySelectedPlace(point)},{name,longitude,latitude})
 }
 const safety=page.getByRole('note',{name:'现场安全提醒',exact:true})
 const guide=page.getByRole('note',{name:'上报去向',exact:true})
 const submit=page.getByRole('button',{name:'上报',exact:true})
 await chooseWater('北太子湖',114.191333,30.516943)
 await page.waitForFunction(()=>document.querySelector('input[aria-label="具体水域与位置"]')?.value==='北太子湖')
 await page.getByRole('textbox',{name:'现场情况'}).fill('仅用于演示上报流程。')
 await safety.waitFor()
 assert.match(await safety.innerText(),/安全距离.*阻拦.*争执.*报警.*亲眼所见/s)
 assert.match(await page.locator('#report-region').innerText(),/武汉市.*蔡甸区/)
 await guide.getByText(/我的上报记录.*可选举报机构.*蔡甸区农业综合执法大队.*全国渔政举报热线.*接收部门回复/).waitFor()
 assert.equal(await submit.getAttribute('aria-describedby'),'report-submit-help')
 assert.ok(await page.evaluate(()=>{
  const follows=(a,b)=>Boolean(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)
  const safety=document.querySelector('#report-safety-title'),issue=document.querySelector('#report-kind')
  const button=document.querySelector('[aria-describedby="report-submit-help"]'),help=document.querySelector('#report-submit-help')
  return follows(safety,issue)&&follows(button,help)&&follows(help,document.querySelector('[aria-label="举报联系方式"]'))
 }))
 await page.evaluate(()=>window.scrollTo(0,0))
 await page.screenshot({path:`${output}/report-safety-375.png`})
 await guide.evaluate(el=>el.scrollIntoView({block:'center'}))
 await page.screenshot({path:`${output}/report-destination-375.png`})
 await chooseWater('上海测试河段',121.12,31.1)
 await guide.getByText(/上海市农业农村委员会行政执法举报信箱/).waitFor()
 assert.doesNotMatch(await guide.innerText(),/全国渔政举报热线/)
 await chooseWater('未命名水域',111.172702,32.594393)
 const selectedContacts=page.getByRole('button',{name:'举报联系方式',exact:true})
 assert.equal(await selectedContacts.getAttribute('aria-expanded'),'false')
 assert.equal(await page.getByText('0719-12345',{exact:true}).count(),0)
 await selectedContacts.click()
 await page.getByText('0719-12345',{exact:true}).waitFor()
 await selectedContacts.evaluate(el=>el.scrollIntoView({block:'start'}))
 await page.screenshot({path:output+'/water-contacts-shiyan.png'})
 await page.getByText('中国渔政举报受理平台',{exact:true}).waitFor()
 await page.getByRole('button',{name:'拨打十堰市12345政务服务便民热线',exact:true}).click()
 const dial=page.getByRole('dialog',{name:'打开拨号？'});await dial.waitFor()
 assert.match(await dial.innerText(),/0719-12345/)
 await dial.getByRole('button',{name:'取消',exact:true}).click()
 await page.evaluate(async()=>{let component=document.querySelector('.fishing-content').__vueParentComponent;while(component && !component.setupState.applySelectedPlace)component=component.parent;await component.setupState.applySelectedPlace({longitude:121.55,latitude:29.87,name:'宁波选中的河段'})})
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('海曙区') && document.querySelector('input[aria-label="具体水域与位置"]')?.value==='宁波选中的河段')
 assert.match(await page.locator('#report-region').innerText(),/浙江省.*宁波市.*海曙区/)
 await selectedContacts.click()
 await page.getByText('0574-12345',{exact:true}).waitFor()
 assert.equal(await page.getByText('0719-12345',{exact:true}).count(),0)
 await page.locator('#report-kind').click()
 await page.getByRole('button',{name:'其他水域问题',exact:true}).click()
 await guide.getByText(/河湖侵占.*水利部 12314.*水体污染.*生态环境部/).waitFor()
 assert.doesNotMatch(await guide.innerText(),/渔政/)
 checks.push('the safety note precedes the fields; the note under the submit button describes personal storage, the matching official recipient and who provides follow-up')
 await selectedContacts.click()
 await page.getByText('水利部12314监督举报平台',{exact:true}).waitFor()
 assert.equal(await page.getByText('中国渔政举报受理平台',{exact:true}).count(),0)
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
 assert.equal(await add.isDisabled(),false)
 assert.equal(uploads.length,0)
 assert.equal(await page.getByRole('checkbox').count(),0)
 const chooser=page.waitForEvent('filechooser');await add.click()
 await(await chooser).setFiles([{name:'evidence.png',mimeType:'image/png',buffer:await readFile('assets/brand/fish-symbol.png')},{name:'evidence.mp4',mimeType:'video/mp4',buffer:await readFile('tests/fixtures/flower-cc0.mp4')}])
 await page.waitForFunction(()=>document.querySelectorAll('.mobile-evidence__item').length===2)
 await page.waitForFunction(()=>document.querySelectorAll('.mobile-media-uploader__progress').length===0)
 await page.waitForFunction(()=>[...document.querySelectorAll('.mobile-evidence__preview')].every(node=>{const image=node.querySelector('img');return image?.complete&&image.naturalWidth>0}))
 assert.equal(uploads.length,2);assert.ok(uploads.some(item=>item.kind==='video'))
 await page.getByRole('button',{name:'预览视频 2',exact:true}).click()
 await page.getByRole('dialog',{name:'视频预览',exact:true}).waitFor()
 await page.getByRole('button',{name:'关闭视频预览',exact:true}).click()
 await selectedContacts.evaluate(el=>el.scrollIntoView({block:'end'}))
 await page.screenshot({path:output+'/report-submit-375.png'})
 checks.push('missing coordinates block a save, selected waters route to two different city hotlines, water management opens its own reporting option, and attachments work directly')
 for(const [name,width,height,dark,scale]of[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',812,375,false,16],['wide',1280,800,false,16],['dark-large',320,740,true,24],['dark-200',320,740,true,32]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
  await page.locator('.mobile-evidence__grid').scrollIntoViewIfNeeded()
  await page.waitForFunction(()=>[...document.querySelectorAll('.mobile-evidence__preview')].every(node=>{const image=node.querySelector('img');return image?.complete&&image.naturalWidth>0}))
  await page.locator('#report-region').scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  for(const note of [safety,guide]){
   assert.ok(await note.evaluate(el=>el.clientWidth>0 && el.scrollWidth<=el.clientWidth+1))
  }
  await page.screenshot({path:`${output}/form-${name}.png`,fullPage:true})
  await page.locator('#report-region').click()
  const region=page.getByRole('dialog',{name:'选择事发地区',exact:true})
  const close=region.getByRole('button',{name:'关闭地区选择',exact:true})
  await close.click({trial:true})
  await page.screenshot({path:`${output}/region-${name}.png`})
  await page.keyboard.press('Escape')
  await region.waitFor({state:'hidden'})
 }
 checks.push('320/375/440, landscape, wide and dark large-text forms and region sheets fit without horizontal overflow')
 await page.getByRole('link',{name:'钓友圈',exact:true}).click()
 await page.getByRole('link',{name:'钓友圈',exact:true}).waitFor()
 assert.equal(await page.getByRole('link',{name:'钓友圈',exact:true}).getAttribute('aria-current'),'page')
 await page.getByRole('link',{name:'举报',exact:true}).click()
 await page.locator('#report-region').waitFor()
 assert.equal(await page.getByRole('link',{name:'举报',exact:true}).getAttribute('aria-current'),'page')
 await page.getByRole('button',{name:'我的上报记录',exact:true}).click()
 await page.getByText('还没有保存的上报记录。',{exact:true}).waitFor()
 assert.equal(await safety.count(),0)
 assert.equal(await guide.count(),0)
 await page.goto(`${base}/#/pages/home/index?tab=messages`)
 await page.waitForURL('**/pages/water-report/index?tabbed=1')
 checks.push('the primary 举报 tab directly opens water reporting and switches back through the main navigation')
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
 await page.getByText('暂未获取当前位置，请选择事发地区。',{exact:true}).waitFor()
 await chooseDistrict(page,'阳新县')
 assert.match(await page.locator('#report-region').innerText(),/阳新县/)
 await session.context.close()
 session=await open('guest');page=session.page
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('阳新县'))
 await chooseDistrict(page,'阳新县')
 assert.equal(await page.evaluate(()=>window.locationCalls),1)
 assert.equal(await page.locator('textarea').count(),0)
 assert.ok(await page.getByRole('note',{name:'现场安全提醒',exact:true}).isVisible())
 assert.ok(await page.evaluate(()=>!Object.keys(localStorage).some(key=>key.includes('draft.'))))
 await session.context.close()
 checks.push('late location results preserve manual edits and saved drafts; current fix can rank contacts without overwriting prior incidents; denied location permits manual selection; guest automatically fills public region without restoring private drafts')
 session=await open('success',{...saved,description:'',media:[],_edited:false});page=session.page
 await page.waitForFunction(()=>document.querySelector('#report-region')?.textContent.includes('阳新县'))
 assert.equal(await page.locator('input[aria-label="具体水域与位置"]').inputValue(),'')
 assert.equal(await page.getByText(/^已选位置：/).count(),0)
 assert.ok(!(await page.locator('#report-time-time').innerText()).includes('08:00') || now.slice(11)==='08:00')
 await session.context.close()
 checks.push('an empty auto-saved draft refreshes old region, location and time on re-entry')
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
 await writeFile(`${output}/result.json`,JSON.stringify({passed:true,checks,errors,uploads:uploads.length,writes:writes.length,boundary:'Isolated GPS/API fixtures; actual browser photo/video decoding and interactions. No real GPS, cloud upload, report write, delivery or phone call.'},null,2))
 console.log(JSON.stringify({checks,errors},null,2))
}finally{await browser.close()}
