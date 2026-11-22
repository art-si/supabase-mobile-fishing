// Exercise the actual H5 sheet with isolated HTTP fixtures, including upload/retry and paging.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { setH5TextScale } from './h5-text-scale.mjs'

const base = process.env.FISHING_H5_URL || 'http://127.0.0.1:5178'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const output = 'artifacts/spot-discussion'
await mkdir(output, { recursive: true })
const fixture = new URL('../tests/fixtures/image-formats/small.webp', import.meta.url)
const photoBytes = await readFile(fixture)
const owner = { id: randomUUID(), nickname: '湖边小林' }
const visitor = { id: randomUUID(), nickname: '听风' }
const spot = { id: randomUUID(), name: '凤凰湖', city: '武汉市', author: owner, water_type: '自然水域',
  precision: 'hidden', status: 'published', audience: 'public' }
const target = 'spot:' + spot.id
const rankedSpots = [
  ['凤凰湖', '自然水域', 8], ['松林水库', '水库', 4], ['芦苇湾', '自然水域', 2],
  ['西岸钓场', '钓场', 0], ['封闭岸线', '自然水域', 12]
].map(([name, water_type, likes], index) => ({
  ...spot, id: randomUUID(), name, water_type, likes, precision: 'exact',
  longitude: 114.19 + index * .008, latitude: 30.52,
  fishing_status: index === 4 ? 'prohibited' : 'allowed'
}))
const likers = [owner,visitor,{id:randomUUID(),nickname:'小鱼'}]
const postLikers = [...likers,...Array.from({length:18},(_,i)=>({id:randomUUID(),nickname:'岸边钓友 '+(i+1)}))]
const first = { id: randomUUID(), author: owner, own: false, body: '今天东岸的水位怎么样？',
  created_at: new Date().toISOString(), reply_to_id: null, reply_to: null, media: [] }
const uploaded = { id: randomUUID(), kind: 'image', width: 64, height: 64 }
uploaded.path = visitor.id + '/' + uploaded.id + '.jpg'
const rows = [first, ...Array.from({ length: 21 }, (_, i) => ({
  ...first, id: randomUUID(), body: i === 0 ? '刚从东岸回来，水位比昨天高一点。' : '岸边观察 ' + (i + 1),
  reply_to_id: i === 0 ? first.id : null, reply_to: i === 0 ? first : null
}))]
const post = { id: randomUUID(), author: owner, title: '东岸鱼情', body: '今天沿着东岸走了一圈。', kind: 'experience',
  topic: '', created_at: new Date().toISOString(), audience:'public', status:'published', media:[],
  like_count:postLikers.length, comment_count:3, liked:true, saved:false, location_label:'' }
let nextReads = 0, uploads = 0
let failLikes = false
const submissions = []
const browser = await chromium.launch({ channel: 'chrome' })
let page
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'zh-CN',
    permissions: ['geolocation'], geolocation: { longitude: 114.1859, latitude: 30.5189, accuracy: 12 } })
  await context.addInitScript(user => {
    localStorage.setItem('dyj.auth.v1', JSON.stringify({ type: 'object', data: {
      access_token: 'isolated-discussion-test', refresh_token: 'fixture', expires_at: Date.now()/1000+3600, user
    } }))
  }, { id: visitor.id })
  await context.routeWebSocket(/supabase\.co/, socket => socket.close())
  await context.route('https://*.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/media-upload')) {
      uploads++
      return route.fulfill({ json: uploaded })
    }
    if (path.includes('/storage/v1/object/sign/')) {
      if (route.request().method() === 'POST') return route.fulfill({ json: { signedURL: '/object/sign/fishing-media/' + uploaded.path + '?token=fixture' } })
      return route.fulfill({ body: photoBytes, contentType: 'image/webp' })
    }
    if (path.endsWith('/fishing_read')) {
      const {action,payload}=route.request().postDataJSON()
      if (action === 'spot') return route.fulfill({json:spot})
      if (action === 'spots') return route.fulfill({json:{items:rankedSpots, next:null}})
      if (action === 'post') return route.fulfill({json:{post,comments:rows.slice(0,3),comments_next:null}})
      if (action === 'discussion_likes') {
        if (failLikes) return route.fulfill({status:503,json:{message:'fixture outage'}})
        const roster=payload.target==='post:'+post.id ? postLikers : likers
        return route.fulfill({json:payload.cursor ? {items:roster.slice(18),next:null} :
          {items:roster.slice(0,18),next:roster.length>18 ? 'older-likes' : null}})
      }
    }
    if (path.endsWith('/fishing_notifications')) {
      const { action }=route.request().postDataJSON()
      const notification={id:'1',kind:'like',category:'interaction',created_at:first.created_at,read:false,available:true,
        actor:owner,title:owner.nickname+'赞了你的动态',preview:post.title,target:{type:'post',id:post.id}}
      return route.fulfill({json:action==='preferences' ? {likes:true,comments:true} : {items:[notification],summary:{interaction:1,system:0},next:null}})
    }
    if (path.endsWith('/fishing_spot_community')) {
      const { action, payload } = route.request().postDataJSON()
      const summary = { target, comments: rows.length, likes: likers.length, liked: false, saved: false, status: '' }
      if (action === 'summary') return route.fulfill({json:payload.targets.map(key => {
        const ranked = rankedSpots.find(row => key === 'spot:' + row.id)
        return ranked ? {target:key, likes:ranked.likes, rank_likes:ranked.likes, comments:0} : summary
      })})
      if (action === 'comments') {
        if (payload.cursor) nextReads++
        return route.fulfill({ json: { summary, items: payload.cursor ? rows.slice(20) : rows.slice(0,20), next: payload.cursor ? null : 'older' } })
      }
      if (action === 'comment') {
        submissions.push(payload)
        if (submissions.length === 1) return route.fulfill({ status: 503, json: { message: 'test retry' } })
        rows.unshift({ ...first, ...payload, own: true, author: visitor, reply_to: payload.reply_to_id ? first : null,
          media: payload.media.length ? [uploaded] : [] })
        return route.fulfill({ json: { id: payload.id } })
      }
      return route.fulfill({ json: [summary] })
    }
    return route.fulfill({ json: path === '/auth/v1/user' ? { id: visitor.id } : { items: [] } })
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(12000)
  await page.goto(base + '/#/pages/spot/detail?id=' + spot.id)
  await page.getByRole('button', { name: '查看评论：' + spot.name }).click()
  const sheet = page.getByRole('dialog', { name: '钓位评论', exact: true })
  const scroll = sheet.locator('.mobile-sheet__body .uni-scroll-view-scrollbar-hidden')
  const select = sheet.getByRole('button', { name: '回复湖边小林的评论' }).first()
  async function aligned(region, error = false) {
    const heart=region.locator('.discussion-likes__heart'), people=region.locator('.discussion-likes__people')
    const firstCell=error ? people.getByRole('button',{name:'重试'}) : people.locator('.mobile-avatar').first()
    await firstCell.waitFor()
    const [a,b]=await Promise.all([heart.boundingBox(),firstCell.boundingBox()])
    assert.ok(Math.abs((a.y+a.height/2)-(b.y+b.height/2))<1.2, 'like heart and first avatar/action share a centerline')
    if (!error) {
      const name=await region.locator('.discussion-comment__name').first().boundingBox()
      assert.ok(Math.abs(b.x-name.x)<1.2, 'liker avatars and comment author column align')
    }
  }
  async function multiline(region) {
    const input=await region.locator('textarea').boundingBox(), tools=await region.locator('.mobile-comment-composer__toolbar').boundingBox()
    assert.ok(input.width >= tools.width-20 && input.height>=32, 'text field spans the composer')
    assert.ok(input.y+input.height<=tools.y+2, 'emoji, photos and send are below the multiline field '+JSON.stringify({input,tools,
      field:await region.locator('.mobile-field__control--textarea').boundingBox(),inner:await region.locator('.uni-textarea-wrapper').boundingBox()}))
  }
  await select.waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '关闭钓位评论')
  await page.waitForTimeout(350)
  for (const [label, width, height, dark, scale] of [
    ['375',375,812,false,16], ['320',320,680,false,16], ['440',440,956,false,16],
    ['wide',1024,768,false,16], ['landscape',844,390,false,16], ['dark-large',375,812,true,22]
  ]) {
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
    await setH5TextScale(page, scale)
    await page.waitForTimeout(120)
    const bounds = await sheet.boundingBox()
    assert.ok(bounds.height >= Math.min(height * .82, 795) && bounds.y >= -1 && bounds.y+bounds.height <= height+1, label + ': dialog height')
    const list = await scroll.boundingBox()
    assert.ok(list.height >= height * .25, label + ': independent reading area')
    assert.ok(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth+1), label + ': no horizontal overflow')
    await aligned(sheet)
    await multiline(sheet)
    await page.screenshot({ path: output + '/' + label + '.png' })
  }
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ colorScheme: 'light' })
  await setH5TextScale(page, 16)
  await select.click()
  const field = sheet.getByRole('textbox', { name: '回复 湖边小林', exact: true })
  await field.waitFor()
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA')
  await field.fill('我也在东岸。')
  // H5 keyboard layout uses visualViewport. Exercise its resize handler with a shortened visible area.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>460})
    visualViewport.dispatchEvent(new Event('resize'))
  })
  await page.waitForFunction(()=>document.querySelector('.mobile-sheet__footer')?.getBoundingClientRect().bottom<=461)
  assert.ok((await scroll.boundingBox()).height>100)
  await multiline(sheet)
  await page.screenshot({path:output+'/keyboard.png'})
  await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))})
  await page.screenshot({path:output+'/reply-compose.png'})
  await sheet.getByRole('button', { name: '取消回复' }).click()
  assert.equal(await sheet.getByRole('textbox', { name: '写一条评论' }).inputValue(), '我也在东岸。')
  await select.click()
  await field.fill('')
  const choosing = page.waitForEvent('filechooser')
  await sheet.getByRole('button', { name: '添加图片', exact: true }).click()
  const picker = await choosing
  assert.ok(!(await picker.element().getAttribute('accept')).includes('video'))
  await picker.setFiles({ name: '岸边.webp', mimeType: 'image/webp', buffer: photoBytes })
  const send = sheet.getByRole('button', { name: '发表回复', exact: true })
  await page.waitForFunction(() => !document.querySelector('[aria-label="发表回复"]')?.hasAttribute('disabled'))
  await send.click()
  await sheet.getByRole('alert').waitFor()
  assert.equal(uploads,1)
  await page.screenshot({ path: output + '/reply-retry.png' })
  await send.click()
  await sheet.getByText('回复已发表', { exact: true }).waitFor()
  assert.equal(submissions.length,2)
  assert.deepEqual(submissions[1], submissions[0])
  assert.equal(submissions[1].body, '')
  assert.equal(submissions[1].reply_to_id, first.id)
  assert.deepEqual(submissions[1].media,[{id:uploaded.id}])
  const preview = sheet.getByRole('button', { name: '评论图片，查看大图，第1项' })
  await preview.click()
  const viewer = page.getByRole('dialog', { name: '预览评论图片' })
  await viewer.getByRole('button', { name: '关闭预览' }).click()
  await viewer.waitFor({ state: 'hidden' })
  await page.screenshot({path:output+'/sent.png'})
  await scroll.evaluate(el => { el.scrollTop=el.scrollHeight })
  await sheet.getByText('岸边观察 21', { exact:true }).waitFor({ state:'attached' })
  assert.equal(nextReads,1)
  await sheet.getByRole('button', { name: '关闭钓位评论' }).click()
  await sheet.waitFor({ state:'hidden' })
  failLikes=true
  await page.goto(base+'/#/pages/post/detail?id='+post.id)
  const feed=page.locator('#comments')
  await aligned(feed,true)
  failLikes=false
  await feed.getByRole('button',{name:'重试',exact:true}).click()
  await aligned(feed)
  await multiline(feed)
  await feed.getByRole('button',{name:'更多点赞'}).click()
  const roster=page.getByRole('dialog',{name:'赞过的钓友',exact:true})
  const rosterScroll=roster.locator('.mobile-sheet__body .uni-scroll-view-scrollbar-hidden')
  await rosterScroll.evaluate(el=>{el.scrollTop=el.scrollHeight})
  await roster.getByRole('button',{name:'查看岸边钓友 18的主页'}).waitFor({state:'attached'})
  await roster.getByRole('button',{name:'关闭点赞名单'}).click()
  await roster.waitFor({state:'hidden'})
  const actions=page.locator('.post-card .discussion-action__icon')
  const positions=await actions.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return r.y+r.height/2}))
  assert.equal(positions.length,3)
  assert.ok(Math.max(...positions)-Math.min(...positions)<1)
  await feed.locator('.discussion-comment__message').first().click()
  await feed.getByRole('textbox',{name:'写一条回复'}).fill('刚刚在湖边看到。')
  await page.screenshot({path:output+'/feed-reply.png'})
  await page.goto(base+'/#/pages/notifications/index')
  await page.getByText(owner.nickname+'赞了你的动态',{exact:true}).waitFor()
  assert.equal(await page.locator('.inbox-row .discussion-avatar').count(),1)
  await page.screenshot({path:output+'/interaction-inbox.png'})
  await page.goto(base + '/#/pages/home/index?tab=spots')
  const medals = page.locator('.spot-card__medal')
  await page.getByRole('img', {name:'第3名', exact:true}).waitFor()
  assert.deepEqual(await medals.allTextContents(), ['🥇','🥈','🥉'])
  for (const [index, name] of ['凤凰湖', '松林水库', '芦苇湾'].entries()) {
    const card = page.locator('.spot-card').nth(index)
    await card.getByRole('button', {name:'查看钓位：' + name, exact:true}).waitFor()
    assert.equal(await card.getByText('推荐', {exact:true}).count(), index < 2 ? 1 : 0)
  }
  assert.equal(await page.locator('.spot-card--prohibited .spot-card__medal').count(), 0)
  for (const [label, width, height, dark, scale] of [
    ['320',320,740,false,16], ['375',375,812,false,16], ['440',440,956,false,16],
    ['landscape',844,390,false,16], ['wide',1024,768,false,16], ['dark-large',320,812,true,24]
  ]) {
    await page.setViewportSize({width,height})
    await page.emulateMedia({colorScheme:dark ? 'dark' : 'light'})
    await setH5TextScale(page,scale)
    const positions = await medals.evaluateAll(items => items.map(item => {
      const medal = item.getBoundingClientRect()
      const tags = item.closest('.spot-card__tags').getBoundingClientRect()
      const header = item.closest('.spot-card__header').getBoundingClientRect()
      const type = item.nextElementSibling.getBoundingClientRect()
      const distance = item.closest('.spot-card__header').querySelector('.spot-card__distance').getBoundingClientRect()
      const mid = rect => rect.y + rect.height / 2
      const sameLine = Math.abs(mid(distance)-mid(medal)) < 1.5 && type.right < distance.left
      const nextLine = distance.top >= tags.bottom && Math.abs(distance.right-header.right) < 1
      return { aligned:Math.abs(tags.x-medal.x) < 1 && type.x >= medal.right + 4 &&
        Math.abs(mid(type)-mid(medal)) < 1 && (sameLine || nextLine),
        medal:medal.toJSON(), type:type.toJSON(), distance:distance.toJSON(), tags:tags.toJSON(), header:header.toJSON() }
    }))
    assert.ok(positions.every(row => row.aligned), label + ' medal alignment ' + JSON.stringify(positions.find(row => !row.aligned)))
    await page.screenshot({path:output+'/ranking-'+label+'.png'})
  }
  console.log('PASS H5 discussion, photos, replies, paging, reaction alignment and leading rank medals across six viewports')
} catch (error) {
  if (page) {
    await page.screenshot({ path: output + '/failure.png' })
    console.error(errors, (await page.locator('body').innerText()).slice(-1200))
  }
  throw error
} finally {
  await browser.close()
}
