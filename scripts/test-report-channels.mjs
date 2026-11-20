// Public directory UI and an isolated stored-session fixture. No real login, GPS,
// uploads, phone calls or external requests. This does not verify Supabase Auth.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
const output = resolve('artifacts/report-channels')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  locale: 'zh-CN',
  reducedMotion: 'reduce'
})
const checks = [],
  errors = [],
  external = []
await context.routeWebSocket(/supabase\.co/, (socket) => socket.close())
await context.route('**/*', (route) => {
  const url = new URL(route.request().url())
  if (url.origin === base || !url.protocol.startsWith('http')) return route.continue()
  external.push(`${route.request().method()} ${url.origin}${url.pathname}`)
  return route.abort()
})
await context.addInitScript(()=>Object.defineProperty(navigator,'permissions',{value:{query:async()=>({state:'denied'})}}))
const page = await context.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', (error) => errors.push(error.message))
const button = (name) => page.getByRole('button', { name, exact: true })
const pass = (name) => checks.push(name)
const panel = (name) => page.locator('.panel').filter({ has: page.getByText(name, { exact: true }) })
async function selectRegion(name,provinceOnly=false) {
 await page.locator('#report-region').click()
 const dialog=page.getByRole('dialog',{name:'选择事发地区',exact:true})
 if(provinceOnly){
  await dialog.getByRole('button',{name,exact:true}).click()
  await dialog.getByRole('button',{name:'只选择'+name,exact:true}).click()
 }else{
  await dialog.locator('input[aria-label="搜索地区"]').fill(name)
  await dialog.getByRole('button',{name:'选择'+name,exact:true}).click()
  const cityOnly=dialog.getByRole('button',{name:'只选择'+name,exact:true})
  await Promise.race([dialog.waitFor({state:'hidden'}),cityOnly.waitFor()])
  if(await cityOnly.isVisible())await cityOnly.click()
 }
 await dialog.waitFor({state:'hidden'})
}
async function capture(name) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: resolve(output, `${name}.png`) })
}
try {
 await page.goto(base+'/#/pages/water-report/index',{waitUntil:'domcontentloaded'})
 await page.getByText('中国渔政举报受理平台',{exact:true}).waitFor()
 assert.equal(await page.locator('textarea').count(),0)
 await capture('guest-region-375')
 await selectRegion('凤凰县')
 await page.getByText('湘西州农业综合执法局',{exact:true}).waitFor()
 assert.equal(await button('拨打长沙市农业综合执法局').count(),0)
 await selectRegion('长沙市')
 await page.getByText('长沙市农业综合执法局',{exact:true}).waitFor()
 assert.equal(await button('拨打湘西州农业综合执法局').count(),0)
 assert.ok(!(await page.locator('#report-region').innerText()).includes('凤凰县'))
 pass('one region picker selects prefectures/counties and city contacts without login; switching city clears prior county')
 await selectRegion('郎溪县')
 await page.getByText('郎溪县农业农村局',{exact:true}).waitFor()
 assert.equal(await button('拨打宣州区渔业违法举报').count(),0)
 await selectRegion('宣州区')
 await page.getByText('宣州区渔业违法举报',{exact:true}).waitFor()
 assert.equal(await button('拨打郎溪县农业农村局').count(),0)
 await selectRegion('香港特别行政区',true)
 await page.getByText(/^此地区暂无可用的已核验渠道/).waitFor()
 assert.equal(await button('拨打中国渔政举报受理平台').count(),0)
 pass('neighbouring counties and separate jurisdictions stay distinct')
 for(const [width,height,skin,dark,textSize]of[[320,740,'lake',false,16],[375,812,'lake',false,16],[440,956,'ocean',false,16],[812,375,'stone',false,16],[1280,800,'stone',true,16],[320,740,'lake',true,24],[375,812,'ocean',true,32]]){
  await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:dark?'dark':'light',reducedMotion:'reduce'})
  await page.evaluate(skin=>localStorage.setItem('dyj.appearance.skin.v1',JSON.stringify({type:'string',data:skin})),skin)
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#report-region').waitFor()
  await setH5TextScale(page,textSize)
  await selectRegion('张家界市')
  const contact=button('拨打张家界市农业农村局'),card=panel('张家界市农业农村局')
  await contact.waitFor();await card.scrollIntoViewIfNeeded();await page.keyboard.press('Tab');await contact.focus()
  assert.ok(await contact.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>=48&&r.height>=48&&s.outlineStyle!=='none'}))
  assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1))
  const suffix=width+'-'+height+'-'+skin+'-'+(dark?'dark':'light')+'-'+textSize
  await capture('channel-'+suffix);await contact.press('Enter')
  const dialog=page.getByRole('dialog');await dialog.waitFor()
  assert.match(await dialog.innerText(),/0744-8281352/);assert.match(await dialog.innerText(),/不会自动发送你的图片、视频或坐标/)
  await capture('confirm-'+suffix);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'})
  assert.ok(await contact.evaluate(el=>document.activeElement===el))
 }
 pass('320/375/440/landscape/wide, all skins, dark and 150%/200% text retain readable channels, 48px focusable actions and cancelable dialogs')
 assert.ok(await page.evaluate(()=>!Object.keys(localStorage).some(key=>key.includes('draft.'))))
 pass('guest filtering creates no private draft and makes no external request or login attempt')
 await page.evaluate(()=>localStorage.setItem('dyj.auth.v1',JSON.stringify({type:'object',data:{access_token:'isolated-report-ui-fixture',refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:'11111111-1111-4111-8111-111111111111'}}})))
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('textarea[aria-label="现场情况"]').waitFor()
 await selectRegion('郎溪县')
 await page.locator('textarea[aria-label="现场情况"]').fill('隔离验收的私人草稿')
 await button('先查看官方举报渠道').click();await page.getByText('郎溪县农业农村局',{exact:true}).waitFor()
 assert.match(await page.locator('#report-region').getAttribute('aria-describedby'),/report-region-required/)
 await page.waitForFunction(()=>{const v=localStorage.getItem('dyj.live.draft.11111111-1111-4111-8111-111111111111.water-report');return v&&JSON.parse(v).data.district==='郎溪县'})
 await page.evaluate(()=>localStorage.removeItem('dyj.auth.v1'))
 await page.reload({waitUntil:'domcontentloaded'});await page.getByText('中国渔政举报受理平台',{exact:true}).waitFor()
 assert.equal(await page.locator('textarea').count(),0)
 assert.ok(!(await page.locator('#report-region').innerText()).includes('郎溪县'))
 assert.equal(await button('拨打郎溪县农业农村局').count(),0)
 assert.ok(!(await page.locator('body').innerText()).includes('隔离验收的私人草稿'))
 assert.deepEqual(external,[]);assert.deepEqual(errors,[])
 pass('owned private drafts persist, while guest directory never restores their location or text')
} catch (error) {
  process.exitCode = 1
  errors.push(String(error))
  await page.screenshot({ path: resolve(output, 'failed.png') }).catch(() => {})
} finally {
  const result = {
    passed: !process.exitCode,
    scope:
      'local H5 directory and isolated stored-session fixture; external requests blocked, not real Auth',
    checks,
    errors,
    external
  }
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  await browser.close()
}
