import { authenticate, cors, json, service, settings } from '../_shared/http.ts'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const user = await authenticate(request)
    if (!user) return json({ error: 'AUTH_REQUIRED' }, 401)
    const body = await request.json()
    if (body.confirmation !== 'DELETE_MY_ACCOUNT') return json({ error: 'CONFIRMATION_REQUIRED' }, 400)
    // The token was verified by Auth above. A refreshed iat is not proof of recent sign-in.
    const encoded = user.token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'='))) as { amr?: { method: string; timestamp: number }[] }
    const now = Date.now()/1000
    if (!claims.amr?.some(entry => ['otp','sms'].includes(entry.method) && entry.timestamp >= now-300 && entry.timestamp <= now+60)) return json({ error: 'RECENT_PHONE_VERIFICATION_REQUIRED' }, 403)
    // Revoke refresh sessions first. Business writes also require an extant profile, so the
    // still-unexpired JWT cannot keep writing after the auth-user/profile cascade.
    const { url, anonKey } = settings()
    const logout = await fetch(`${url}/auth/v1/logout?scope=global`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${user.token}` } })
    if (!logout.ok) return json({ error: 'SESSION_REVOCATION_FAILED' }, 502)
    // Paginate from zero because each successful batch is deleted; only this user's prefix.
    for (let batch=0; batch<100; batch++) {
      const response=await service('/storage/v1/object/list/fishing-media',{method:'POST',body:JSON.stringify({prefix:`${user.id}/`,limit:100,offset:0})})
      if(!response.ok)return json({error:'MEDIA_CLEANUP_FAILED'},502)
      const files=await response.json() as {name:string;id:string|null}[]
      const paths=files.filter(file=>file.id&&!file.name.includes('/')&&!file.name.includes('..')).map(file=>`${user.id}/${file.name}`)
      if(!paths.length)break
      const removed=await service('/storage/v1/object/fishing-media',{method:'DELETE',body:JSON.stringify({prefixes:paths})})
      if(!removed.ok)return json({error:'MEDIA_CLEANUP_FAILED'},502)
      if(batch===99)return json({error:'CLEANUP_REQUIRES_RETRY'},409)
    }
    const deleted=await service(`/auth/v1/admin/users/${user.id}`,{method:'DELETE'})
    if(!deleted.ok)return json({error:'ACCOUNT_DELETION_FAILED'},502)
    return json({deleted:true})
  }catch{return json({error:'ACCOUNT_DELETION_FAILED'},400)}
})
