import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { setH5TextScale } from './h5-text-scale.mjs'

// Isolated local UI fixtures. No remote login, SMS, upload, or publication.
export async function componentParityContract({ page, go, screenshot, pass, overflow }) {
  const metrics = []
  await go('/pages/home/index')
  await page.getByRole('heading', { name: '钓友集', exact: true }).waitFor()
  for (const [name, width, height, dark, scale] of [
    ['375',375,812,false,16], ['320',320,740,false,16], ['440',440,956,false,16],
    ['landscape',844,390,false,16], ['wide',1280,900,false,16], ['dark-large',320,812,true,24]
  ]) {
    await page.setViewportSize({width,height})
    await page.emulateMedia({colorScheme:dark?'dark':'light'})
    await setH5TextScale(page,scale)
    await go('/pages/mine/profile')
    await page.reload()
    const avatar=page.getByRole('button',{name:'更换头像',exact:true})
    await avatar.waitFor()
    const row=await avatar.evaluate(node=>{
      const rect=x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
      return {button:rect(node),avatar:rect(node.querySelector('.mobile-avatar')),copy:rect(node.querySelector('.mobile-avatar-editor__copy')),icon:rect(node.querySelector('.mobile-icon'))}
    })
    assert.ok(row.button.height>=88 && row.copy.x>=row.avatar.right+12,'avatar, description, and camera stay in one aligned row')
    assert.ok(row.icon.x>=row.copy.right-1,'camera stays after the description')
    metrics.push({name,avatar:row})
    await overflow(`profile ${name}`)
    await screenshot(`parity-profile-${name}.png`,name!=='landscape')
    await page.getByRole('button',{name:'选择常驻城市',exact:true}).click()
    const city=page.getByRole('dialog',{name:'选择常驻城市',exact:true})
    await city.waitFor()
    const provinceRects=await city.locator('.mobile-city-picker__province').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})))
    assert.ok(provinceRects.length>=30 && provinceRects.every(r=>r.height>=48 && r.width>80))
    await screenshot(`parity-city-${name}.png`,false)
    await city.getByRole('button',{name:'江苏省',exact:true}).click()
    await city.getByRole('button',{name:'选择南京市',exact:true}).waitFor()
    await screenshot(`parity-city-list-${name}.png`,false)
    await city.getByRole('button',{name:'选择南京市',exact:true}).click()
    await city.waitFor({state:'hidden'})
    await page.getByRole('button',{name:'选择喜欢的钓法',exact:true}).click()
    const methods=page.getByRole('dialog',{name:'选择喜欢的钓法',exact:true})
    await methods.waitFor()
    const optionRects=await methods.locator('.mobile-multi-choice__option').evaluateAll(nodes=>nodes.map(n=>{
      const r=n.getBoundingClientRect(),label=n.querySelector('.mobile-multi-choice__name').getBoundingClientRect()
      const mark=n.querySelector('.wd-checkbox').getBoundingClientRect()
      return {height:r.height,labelRight:label.right,markLeft:mark.left,delta:Math.abs((label.top+label.bottom-mark.top-mark.bottom)/2)}
    }))
    assert.ok(optionRects.length>=7 && optionRects.every(r=>r.height>=52 && r.markLeft>=r.labelRight && r.delta<=2),'each method and its checkbox share one row')
    const lure=methods.getByRole('checkbox',{name:'路亚',exact:true})
    assert.equal(await lure.getAttribute('aria-checked'),'false')
    await lure.focus();await page.keyboard.press('Space')
    await page.waitForTimeout(100)
    assert.equal(await lure.getAttribute('aria-checked'),'true')
    await lure.dispatchEvent('keyup',{key:' '})
    assert.equal(await lure.getAttribute('aria-checked'),'true','a stray key release must not toggle twice')
    await screenshot(`parity-methods-${name}.png`,false)
    await methods.getByRole('button',{name:/^确定/}).focus()
    await page.keyboard.press('Enter')
    await methods.waitFor({state:'hidden'})
    assert.ok((await page.getByRole('button',{name:'选择喜欢的钓法',exact:true}).innerText()).includes('路亚'))
    metrics.push({name,methods:optionRects,provinces:provinceRects.slice(0,4)})
    pass(`profile avatar, city selection, multi-choice and keyboard ${name}`)
  }
  await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'light'});await setH5TextScale(page,16)
  await go('/pages/post/compose')
  await page.getByRole('button',{name:'分享范围',exact:true}).click()
  const audience=page.getByRole('dialog',{name:'分享范围',exact:true})
  await audience.waitFor();await screenshot('parity-share-sheet.png',false)
  await page.keyboard.press('Escape');await audience.waitFor({state:'hidden'})
  await go('/pages/water-report/index')
  await page.getByRole('button',{name:'选择事发日期',exact:true}).click()
  const date=page.getByRole('dialog',{name:'选择事发日期',exact:true})
  await date.waitFor();await screenshot('parity-calendar.png',false)
  await date.getByRole('button',{name:'取消',exact:true}).click();await date.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'选择事发时间',exact:true}).click()
  const time=page.getByRole('dialog',{name:'选择事发时间',exact:true})
  await time.waitFor();await screenshot('parity-time.png',false)
  await time.getByRole('button',{name:'取消',exact:true}).click();await time.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'选择事发地区',exact:true}).click()
  await page.getByRole('dialog',{name:'选择事发地区',exact:true}).waitFor()
  await screenshot('parity-region.png',false);await page.keyboard.press('Escape')
  pass('share, date, time, and administrative-region sheets')
  await go('/pages/post/detail?id=a1111111-1111-4111-8111-111111111111')
  await page.locator('#comments').waitFor()
  await page.evaluate(()=>{
    const comments=document.getElementById('comments')
    comments.style.minHeight='1150px'
  })
  for(const [label,width,height] of [['375',375,812],['320',320,740],['short',375,480]]){
    await page.setViewportSize({width,height})
    const send=page.getByRole('button',{name:'发表评论',exact:true})
    await send.scrollIntoViewIfNeeded()
    const composer=await page.locator('#post-comment-composer').evaluate(node=>{
      const rect=node.getBoundingClientRect(),button=node.querySelector('.mobile-comment-composer__send').getBoundingClientRect()
      return {height:rect.height,top:rect.top,bottom:rect.bottom,sendTop:button.top,sendBottom:button.bottom,viewport:innerHeight}
    })
    assert.ok(composer.height>=140,'the page owns the full composer box')
    assert.ok(composer.sendTop>=0 && composer.sendBottom<=composer.viewport+1,'send stays inside the visible viewport')
    assert.ok(composer.sendBottom<=composer.bottom+1,'the toolbar participates in the composer height')
    await screenshot(`parity-post-composer-${label}.png`,false)
  }
  await page.setViewportSize({width:375,height:812})
  pass('post comment container includes its toolbar at narrow and keyboard-size viewports')
  const emoji=page.getByRole('button',{name:'表情',exact:true})
  await emoji.waitFor();await emoji.scrollIntoViewIfNeeded()
  await screenshot('parity-comment-toolbar.png',false)
  await emoji.click()
  const picker=page.getByRole('dialog',{name:'选择表情',exact:true})
  await picker.waitFor();await screenshot('parity-emoji.png',false)
  const choice=picker.locator('.mobile-emoji-picker__choice').first()
  await choice.focus();await page.keyboard.press('Enter');await picker.waitFor({state:'hidden'})
  await page.waitForFunction(()=>[...document.querySelectorAll('.mobile-comment-composer textarea')].some(n=>n.value.length>0))
  await page.locator('.mobile-comment-composer textarea').focus()
  const focus=await page.locator('.mobile-comment-composer').evaluate(node=>{
    const field=node.querySelector('.mobile-field__control'), style=getComputedStyle(field)
    return {outer:getComputedStyle(node).boxShadow,inner:style.boxShadow,outline:style.outlineStyle,border:style.borderTopWidth}
  })
  assert.notEqual(focus.outer,'none')
  assert.equal(focus.inner,'none');assert.equal(focus.outline,'none');assert.equal(focus.border,'0px')
  await screenshot('parity-comment-one-focus-ring.png',false)
  pass('comment tools and emoji selection retain alignment and update input')
  await go('/pages/mine/library?type=posts')
  await page.getByRole('heading',{name:'我的记录',exact:true}).waitFor()
  await screenshot('parity-library-posts.png',false)
  await go('/pages/content-report/detail')
  await page.getByText('缺少举报编号',{exact:true}).waitFor()
  await screenshot('parity-content-report-missing.png',false)
  pass('library and report detail use matching H5 and WeChat route states')
  writeFileSync('artifacts/h5/component-parity-metrics.json',JSON.stringify(metrics,null,2))
}
