// Isolated session/API/AMap callbacks. Proves UI and races, never device GPS or hosted writes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir,writeFile } from 'node:fs/promises'
import { setH5TextScale } from './h5-text-scale.mjs'
const base=process.env.FISHING_H5_URL||'http://127.0.0.1:5178'
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname))
const output='artifacts/city-profile'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const owner='11111111-1111-4111-8111-111111111111'
const checks=[],errors=[],escaped=[],contexts=[]
const pass=message=>{checks.push(message);console.log('PASS',message)}
async function setup({denied=false,guest=false}={}){
  const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'})
  contexts.push(context)
  const writes=[],feeds=[]
  await context.addInitScript(({owner,denied,guest})=>{
    if (!guest) localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'city-profile-fixture',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:owner}}}))
    Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>({state:denied?'denied':'granted'})}})
    const fixture=window.cityReview={callbacks:[],city:'武汉市',district:'江汉区',province:'湖北省',geocodes:0}
    class Geolocation{getCurrentPosition(callback){fixture.callbacks.push(callback)}}
    class Geocoder{getAddress(point,callback){fixture.geocodes++;callback('complete',{regeocode:{formattedAddress:'真实定位仅做接口隔离测试',addressComponent:{province:fixture.province,city:fixture.city,district:fixture.district}}})}}
    window.AMap={Geolocation,Geocoder}
  },{owner,denied,guest})
  await context.routeWebSocket(/supabase\.co/,socket=>socket.close())
  await context.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url())
    if(url.origin===base||!url.protocol.startsWith('http'))return route.continue()
    if(url.origin!=='https://jupuypvmgjpnpntfetqv.supabase.co'){escaped.push(url.origin);return route.abort()}
    const reply=(json,status=200)=>route.fulfill({json,status,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}})
    if(req.method()==='OPTIONS')return reply({})
    if(url.pathname==='/auth/v1/user')return reply({id:owner})
    if(url.pathname.endsWith('fishing_moderation'))return reply({allowed:false})
    if(url.pathname.endsWith('fishing_read')){
      const body=req.postDataJSON()||{}
      if(body.action==='feed'){feeds.push(body.payload);return reply({items:[],next:null})}
      if(body.action==='profile')return reply({profile:{id:owner,nickname:'城市验收',city:'苏州',method:'台钓',bio:'原有简介',handle:'fixture'},posts:[],following:false,friend:false,blocked:false})
      return reply({items:[],next:null})
    }
    if(url.pathname.endsWith('fishing_write')){writes.push(req.postDataJSON());return reply({message:'SERVICE_UNAVAILABLE'},503)}
    escaped.push(url.pathname);return route.abort()
  })
  const page=await context.newPage()
  page.on('pageerror',error=>errors.push(error.message))
  return{context,page,writes,feeds}
}
async function choose(page,trigger,city){
  await page.getByRole('button',{name:trigger,exact:true}).click()
  const dialog=page.getByRole('dialog',{name:trigger,exact:true})
  await dialog.waitFor()
  await dialog.locator('input[aria-label="搜索城市"]').fill(city)
  await dialog.getByRole('button',{name:`选择${city}`,exact:true}).click()
}
try{
  const first=await setup(),page=first.page
  await page.goto(`${base}/#/pages/home/index`)
  await page.getByRole('button',{name:'同城',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.cityReview.callbacks.length),0)
  await page.getByRole('button',{name:'同城',exact:true}).click()
  await page.waitForFunction(()=>window.cityReview.callbacks.length===1)
  await choose(page,'切换同城城市','杭州市')
  await page.evaluate(()=>window.cityReview.callbacks[0]('complete',{position:{getLng:()=>114.3,getLat:()=>30.6},location_type:'html5',accuracy:20}))
  await page.waitForTimeout(200)
  await page.getByRole('button',{name:'切换同城城市',exact:true}).getByText('杭州市',{exact:true}).waitFor()
  assert.ok(first.feeds.some(item=>item.filter==='city'&&item.city==='杭州市'))
  assert.equal(first.writes.length,0)
  pass('same-city locates on first use; manual city selection wins over a late GPS callback without profile write')
  const views=[['375',375,812,false,16],['320',320,740,false,16],['440',440,956,false,16],['landscape',844,390,false,16],['wide',1280,900,false,16],['dark-large',320,812,true,32]]
  for(const[name,width,height,dark,scale]of views){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
    await page.screenshot({path:`${output}/feed-${name}.png`,fullPage:true})
    await page.getByRole('button',{name:'切换同城城市',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'切换同城城市',exact:true})
    await dialog.waitFor()
    await page.waitForTimeout(300)
    const box=await dialog.boundingBox()
    assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=width+1&&box.y+box.height<=height+1,`${name}: sheet fits viewport`)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await page.screenshot({path:`${output}/city-picker-${name}.png`})
    await page.getByRole('button',{name:'关闭城市选择',exact:true}).click()
    await dialog.waitFor({state:'hidden'})
  }
  pass('same-city row and shared city sheet fit 320/375/440, landscape, wide and dark large text')
  await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
  const geoBeforeProfile = await page.evaluate(()=>window.cityReview.callbacks.length)
  await page.goto(`${base}/#/pages/mine/profile`)
  await page.getByRole('button',{name:'选择常驻城市',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.cityReview.callbacks.length),geoBeforeProfile)
  await choose(page,'选择常驻城市','南京市')
  await page.getByRole('button',{name:'选择喜欢的钓法',exact:true}).click()
  const methods=page.getByRole('dialog',{name:'选择喜欢的钓法',exact:true})
  await methods.waitFor()
  await page.screenshot({path:`${output}/profile-methods-375.png`})
  await methods.getByRole('checkbox',{name:'路亚',exact:true}).click()
  await methods.getByRole('button',{name:/^确定/}).click()
  await page.locator('textarea[aria-label="一句话介绍自己"]').fill('保存失败也保留这段简介')
  for(const[name,width,height,dark,scale]of views){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light'});await setH5TextScale(page,scale)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await page.screenshot({path:`${output}/profile-${name}.png`,fullPage:true})
  }
  await page.getByRole('button',{name:'保存资料',exact:true}).click()
  await page.getByRole('alert').waitFor()
  assert.equal(first.writes.length,1)
  assert.equal(first.writes[0].payload.city,'南京市')
  assert.equal(first.writes[0].payload.method,'台钓、路亚')
  assert.equal(first.writes[0].payload.avatar_id,null)
  assert.equal(await page.locator('textarea[aria-label="一句话介绍自己"]').inputValue(),'保存失败也保留这段简介')
  await page.getByRole('button',{name:'选择常驻城市',exact:true}).getByText('南京市',{exact:true}).first().waitFor()
  pass('profile shares the city sheet, publishing method multi-picker and avatar draft; failed save retains inputs')
  await page.getByRole('button',{name:'选择常驻城市',exact:true}).click()
  await page.getByRole('button',{name:'清空城市',exact:true}).click()
  await page.getByRole('button',{name:'选择常驻城市',exact:true}).getByText('选择城市（可选）',{exact:true}).waitFor()
  pass('optional home city can be cleared without saving or changing the same-city filter')
  const second=await setup({denied:true,guest:true})
  await second.page.goto(`${base}/#/pages/home/index`)
  await second.page.getByRole('button',{name:'同城',exact:true}).click()
  await second.page.getByText(/定位权限已关闭/).waitFor()
  await choose(second.page,'切换同城城市','深圳市')
  assert.equal(await second.page.evaluate(()=>window.cityReview.callbacks.length),0)
  assert.equal(second.writes.length,0)
  pass('denied device location still supports manual nationwide city selection')
  const third=await setup({guest:true})
  await third.page.goto(`${base}/#/pages/home/index`)
  await third.page.getByRole('button',{name:'同城',exact:true}).click()
  await third.page.waitForFunction(()=>window.cityReview.callbacks.length===1)
  await third.page.evaluate(()=>window.cityReview.callbacks[0]('complete',{position:{getLng:()=>114.3,getLat:()=>30.6},location_type:'html5',accuracy:20}))
  await third.page.getByRole('button',{name:'切换同城城市',exact:true}).getByText('武汉市',{exact:true}).waitFor()
  assert.ok(third.feeds.some(item=>item.filter==='city'&&item.city==='武汉市'))
  assert.equal(third.writes.length,0)
  pass('successful guest location defaults the same-city filter to its reverse-geocoded city without writing profile')
  await third.page.evaluate(()=>{window.cityReview.city='';window.cityReview.district='天门市'})
  await third.page.getByRole('button',{name:'切换同城城市',exact:true}).click()
  await third.page.getByRole('button',{name:'定位当前城市',exact:true}).click()
  await third.page.waitForFunction(()=>window.cityReview.callbacks.length===2)
  await third.page.evaluate(()=>window.cityReview.callbacks[1]('complete',{position:{getLng:()=>113.1,getLat:()=>30.6},location_type:'html5',accuracy:20}))
  await third.page.getByRole('button',{name:'切换同城城市',exact:true}).getByText('天门市',{exact:true}).waitFor()
  pass('province-administered county-level cities resolve from the district when the geocoder city field is empty')
  assert.deepEqual(errors,[]);assert.deepEqual(escaped,[])
  await writeFile(`${output}/result.json`,JSON.stringify({checks,errors,escaped},null,2))
  console.log(JSON.stringify({checks,errors,escaped},null,2))
}finally{for(const context of contexts)await context.close();await browser.close()}
