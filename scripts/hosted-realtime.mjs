// Real hosted sessions from stdin only. No request/response/socket mocking.
// Business polling is disabled by the parent to prove the private-channel path.
import { randomUUID } from 'node:crypto'

export async function realtime({
  page,
  data,
  project,
  accountPage,
  button,
  field,
  go,
  replyFor,
  shot,
  fits,
  check,
  setPhase
}) {
  const b = await accountPage('b')
  const account = (label) => data.accounts.find((a) => a.label === label).session
  const path = `/pages/chat/index?id=${data.conversation}`
  const stats = { joined: 0, notices: 0, unsafe: false, closed: 0 }
  for (const tab of [page, b])
    tab.on('websocket', (socket) => {
      if (new URL(socket.url()).hostname !== new URL(project).hostname) return
      socket.on('close', () => stats.closed++)
      socket.on('framereceived', (frame) => {
        try {
          const value = JSON.parse(String(frame.payload))
          if (value.event === 'phx_reply' && value.payload?.status === 'ok') stats.joined++
          if (value.event === 'broadcast') {
            stats.notices++
            const payload = value.payload?.payload || {}
            // Realtime adds a random event ID, not a business record ID.
            if (
              value.payload?.event !== 'invalidate' ||
              payload.v !== 1 ||
              Object.keys(payload).some((k) => !['v', 'id'].includes(k))
            )
              stats.unsafe = true
          }
        } catch {
          /* No frame contents or credentials enter logs. */
        }
      })
    })
  setPhase('realtime-open')
  const initial = replyFor(page, 'social')
  await Promise.all([go(page, path), go(b, '/pages/home/index?tab=messages')])
  const first = await initial
  const publicKey = (await first.request().allHeaders()).apikey
  check(
    first.status() === 200 && publicKey?.startsWith('sb_publishable_'),
    'Realtime test reads with ordinary user sessions and public key'
  )
  async function api(label, action, payload = {}, kind = 'write') {
    return page.evaluate(
      async ({ project, publicKey, token, kind, action, payload }) => {
        const response = await fetch(`${project}/rest/v1/rpc/fishing_${kind}`, {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          headers: {
            apikey: publicKey,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ action, payload }),
          signal: AbortSignal.timeout(20000)
        })
        return { status: response.status, body: await response.json() }
      },
      { project, publicKey, token: account(label).access_token, kind, action, payload }
    )
  }
  setPhase('realtime-channel-policy')
  async function probe(label, target, forge = false) {
    return page.evaluate(
      async ({ project, publicKey, token, target, forge }) => {
        const { RealtimeClient } = await import('/node_modules/.vite/deps/@supabase_realtime-js.js')
        const client = new RealtimeClient(`${project}/realtime/v1`, {
          params: { apikey: publicKey },
          vsn: '1.0.0',
          timeout: 8000
        })
        let status = 'pending',
          forged = 0,
          sending = ''
        try {
          if (token) await client.setAuth(token)
          const channel = client
            .channel(`fishing:user:${target}`, {
              config: {
                private: true,
                broadcast: { ack: true, self: true },
                presence: { enabled: false }
              }
            })
            .on('broadcast', { event: 'client-forgery' }, () => forged++)
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 12000)
            channel.subscribe((value) => {
              if (value === 'SUBSCRIBED' || value === 'CHANNEL_ERROR' || value === 'TIMED_OUT') {
                status = value
                clearTimeout(timer)
                resolve()
              }
            })
          })
          if (forge && status === 'SUBSCRIBED') {
            sending = await channel.send({
              type: 'broadcast',
              event: 'client-forgery',
              payload: { v: 999 }
            })
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
          return { status, forged, sending }
        } finally {
          await client.removeAllChannels()
          await client.disconnect()
        }
      },
      { project, publicKey, token: label ? account(label).access_token : null, target, forge }
    )
  }
  const own = await probe('a', account('a').user.id, true)
  setPhase(`realtime-own-channel-${own.status.toLowerCase().replaceAll('_', '-')}`)
  check(own.status === 'SUBSCRIBED', 'Own authenticated private channel joins the real service')
  setPhase(`realtime-client-forgery-${own.sending.replace(/[^a-z]/g, '-')}`)
  check(
    own.forged === 0 && own.sending !== 'ok',
    'Client cannot forge server broadcasts on its own private topic'
  )
  for (const label of ['b', 'outsider', null]) {
    const denied = await probe(label, account('a').user.id)
    setPhase(
      `realtime-denied-${label || 'anonymous'}-${denied.status.toLowerCase().replaceAll('_', '-')}`
    )
    check(
      denied.status === 'CHANNEL_ERROR',
      'Other account and anonymous private channel joins are denied'
    )
  }
  // A public channel with the same name is a separate broadcast namespace.
  // Keep it open across an actual private event; don't infer isolation from RLS alone.
  setPhase('realtime-public-namespace')
  const publicStatus = await page.evaluate(
    async ({ project, publicKey, token, target }) => {
      const { RealtimeClient } = await import('/node_modules/.vite/deps/@supabase_realtime-js.js')
      const client = new RealtimeClient(`${project}/realtime/v1`, {
        params: { apikey: publicKey },
        vsn: '1.0.0',
        timeout: 8000
      })
      let received = 0
      window.fishingPublicProbe = {
        received: () => received,
        close: async () => {
          await client.removeAllChannels()
          await client.disconnect()
        }
      }
      await client.setAuth(token)
      const channel = client
        .channel(`fishing:user:${target}`, {
          config: { private: false, presence: { enabled: false } }
        })
        .on('broadcast', { event: '*' }, () => received++)
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve('pending'), 12000)
        channel.subscribe((status) => {
          if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
            clearTimeout(timer)
            resolve(status)
          }
        })
      })
    },
    { project, publicKey, token: account('outsider').access_token, target: account('a').user.id }
  )
  check(
    ['SUBSCRIBED', 'CHANNEL_ERROR'].includes(publicStatus),
    'Public namespace probe completes without a connection timeout'
  )
  setPhase('realtime-unread')
  const text = '实时消息验收：只通知变化，正文另行鉴权读取。'
  await field(page, '发送给钓友的消息').fill(text)
  const sent = replyFor(page, 'send_message')
  await button(page, '发送').click()
  const response = await sent
  check(response.status() === 200, 'Sender persists the message through normal user RPC')
  await b.getByText(text, { exact: true }).waitFor()
  await page.getByText('已发送', { exact: true }).waitFor()
  check(
    stats.notices > 0,
    'Message list updates from real broadcast with business polling disabled'
  )
  check(!stats.unsafe, 'Observed broadcasts contain only version and random event id')
  await page.waitForTimeout(600)
  check(
    (await page.evaluate(() => window.fishingPublicProbe.received())) === 0,
    'Same-name public channel receives no actual private invalidation'
  )
  await page.evaluate(() => window.fishingPublicProbe.close())
  const beforeRead = (await api('a', 'social', {}, 'read')).body.conversations.find(
    (c) => c.id === data.conversation
  )
  check(
    beforeRead.peer_read_sequence === 0,
    'Connection and inbox preview alone never mark the message read'
  )
  await shot('realtime-inbox-375', b)
  setPhase('realtime-read-receipt')
  await go(b, path)
  await b.getByText(text, { exact: true }).waitFor()
  await page.getByText('已读', { exact: true }).waitFor()
  check(
    true,
    'Visible recipient message advances server cursor and sender receives read receipt without polling'
  )
  await shot('realtime-read-375', page, false)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() =>
    document.documentElement.style.setProperty('font-size', '24px', 'important')
  )
  await fits('Read receipt fits dark 320px large text', page)
  await shot('realtime-read-dark-320', page, false)
  await page.setViewportSize({ width: 440, height: 956 })
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'))
  await page.emulateMedia({ colorScheme: 'light' })
  await shot('realtime-read-440', page, false)
  setPhase('realtime-background')
  await go(b, '/pages/home/index?tab=messages')
  const closes = stats.closed
  await b.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(800)
  check(stats.closed > closes, 'Background transition closes the real account socket')
  const secondText = '恢复前台后补取的第二条验收消息。'
  check(
    (
      await api('a', 'send_message', {
        conversation_id: data.conversation,
        client_id: randomUUID(),
        body: secondText
      })
    ).status === 200,
    'Second message persists while recipient is backgrounded'
  )
  await b.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await b.getByText(secondText, { exact: true }).waitFor()
  check(true, 'Foreground rejoin catches missed data without business polling')
  setPhase('realtime-block')
  await go(b, path)
  await b.getByText(secondText, { exact: true }).waitFor()
  check(
    (await api('a', 'block', { id: account('b').user.id, enabled: true })).status === 200,
    'Block uses the real relationship command'
  )
  await button(b, '照片').waitFor()
  await b.waitForFunction(() =>
    [...document.querySelectorAll('button,[role="button"]')].some(
      (el) =>
        el.textContent?.trim() === '照片' &&
        (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true')
    )
  )
  const social = (await api('b', 'social', {}, 'read')).body.conversations.find(
    (c) => c.id === data.conversation
  )
  check(
    social.can_send === false && social.peer_read_sequence === null,
    'Blocked peer cannot read receipt or send new messages'
  )
  check(
    (
      await api('b', 'send_message', {
        conversation_id: data.conversation,
        client_id: randomUUID(),
        body: '应被拒绝'
      })
    ).status >= 400,
    'RPC rejects blocked sends independently of socket state'
  )
  check(!stats.unsafe, 'No message content or location appeared in any received broadcast')
}
