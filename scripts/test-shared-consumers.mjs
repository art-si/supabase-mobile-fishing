// Local built-app rendering only. No external requests, login or business writes.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { chromium } from 'playwright'
const output=resolve('artifacts/shared-consumers')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true})
const results=[]
try{
  for(const app of ['supabase-mobile-tms-driver','supabase-mobile-tms-shipper','supabase-mobile-smis']){
    const root=resolve('../supabase-mobile-pro/modules',app,'dist/review/fishing-media')
    const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(path==='/'?'/index.html':decodeURIComponent(path)));assert.ok(file.startsWith(root+sep));res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'})[extname(file)]||'application/octet-stream'});res.end(await readFile(file))}catch{res.writeHead(404);res.end()}})
    await new Promise(done=>server.listen(0,'0.0.0.0',done))
    const base=`http://127.0.0.1:${server.address().port}`
    const context=await browser.newContext({viewport:{width:375,height:812},locale:'zh-CN',reducedMotion:'reduce'})
    const errors=[]
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort())
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
    try{
      await page.goto(base+'/#/pages/login/index',{waitUntil:'domcontentloaded'})
      const password=page.locator('input[type="password"]').first()
      await password.waitFor();await password.fill('Fixture-only-password')
      const show=page.getByRole('button',{name:'显示密码',exact:true})
      if(await show.count()){await show.click();await page.getByRole('button',{name:'隐藏密码',exact:true}).click();await password.waitFor()}
      for(const [width,dark] of [[320,false],[375,true]]){
        await page.setViewportSize({width,height:812});await page.emulateMedia({colorScheme:dark?'dark':'light'});await password.focus()
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
        const height=await password.evaluate(node=>(node.closest('.login-form__field')||node).getBoundingClientRect().height);assert.ok(height>=44)
        await page.screenshot({path:resolve(output,`${app}-${width}-${dark?'dark':'light'}.png`)})
      }
      assert.deepEqual(errors,[])
      results.push({app,scope:'built login, password visibility, focus, 320px and dark render; no authentication or business-flow claim',passed:true})
      console.log('PASS built shared form render:',app)
    }finally{await context.close();await new Promise(done=>server.close(done))}
  }
  await writeFile(resolve(output,'result.json'),JSON.stringify(results,null,2))
}finally{await browser.close()}
