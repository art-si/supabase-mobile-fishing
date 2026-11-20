// Fixed local build avoids HMR from other ongoing work. No external service writes.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { spawn } from 'node:child_process'
const root=resolve(process.env.PROFILE_BUILD_DIR||'dist/test/profile')
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+(path==='/'?'/index.html':decodeURIComponent(path)))
  if(!file.startsWith(root+sep))throw Error('Invalid path')
  const body=await readFile(file)
  res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'})[extname(file)]||'application/octet-stream'})
  res.end(body)
}catch{res.writeHead(404);res.end()}})
await new Promise(done=>server.listen(0,'0.0.0.0',done))
try{
  for(const script of process.argv.slice(2).length?process.argv.slice(2):['scripts/test-profile-avatar.mjs','scripts/test-city-profile-ui.mjs']){
    const code=await new Promise((done,reject)=>{
      const child=spawn(process.execPath,[script],{stdio:'inherit',env:{...process.env,FISHING_H5_URL:`http://127.0.0.1:${server.address().port}`}})
      child.on('error',reject);child.on('exit',done)
    })
    if(code!==0){process.exitCode=code||1;break}
  }
}finally{await new Promise(done=>server.close(done))}
