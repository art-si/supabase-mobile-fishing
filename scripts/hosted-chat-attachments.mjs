// Invoked only by the isolated hosted runner. All business and Storage responses
// are real. setOffline is explicit failure injection, not a fake API response.
import { randomUUID } from 'node:crypto'

export async function chatAttachments({
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
  const receiver = await accountPage('b')
  const chatPath = `/pages/chat/index?id=${data.conversation}`
  const photoButton = (tab) => button(tab, '聊天照片，查看大图，第1张')
  const draft = '图片发送时保留这段未发送文字（隔离验收）'
  setPhase('attachment-open')
  await Promise.all([go(page, chatPath), go(receiver, chatPath)])
  const composer = field(page, '发送给钓友的消息')
  await composer.fill(draft)
  await button(page, '照片').click()
  const chooser = page.waitForEvent('filechooser')
  await button(page, '从相册选择').click()
  await (
    await chooser
  ).setFiles({
    name: 'isolated-chat-acceptance.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data.photo, 'base64')
  })
  await button(page, '发送这张照片').waitFor()
  await shot('attachment-confirm-375')
  check(
    (await photoButton(receiver).count()) === 0,
    'H5 selecting a photo does not send it before confirmation'
  )

  setPhase('attachment-offline')
  await page.context().setOffline(true)
  await button(page, '发送这张照片').click()
  await button(page, '重试这条消息').waitFor()
  check(
    (await composer.inputValue()) === draft,
    'H5 offline photo failure preserves the unsent text draft'
  )
  await shot('attachment-offline-375')
  await page.context().setOffline(false)

  setPhase('attachment-retry-upload')
  const uploadResponse = page.waitForResponse(
    (r) => r.url() === `${project}/functions/v1/media-upload`,
    { timeout: 55000 }
  )
  const sentResponse = replyFor(page, 'send_message')
  await button(page, '重试这条消息').click()
  const [uploaded, sent] = await Promise.all([uploadResponse, sentResponse])
  check(uploaded.status() === 200, 'H5 photo retry uploads through the real media service')
  const asset = await uploaded.json()
  check(sent.status() === 200, 'H5 photo message is persisted by the real user RPC')
  const message = await sent.json()
  const input = sent.request().postDataJSON()
  // Capture only an ordinary public key and test-user request. Do not persist headers.
  const publicKey = (await sent.request().allHeaders()).apikey
  check(
    message.kind === 'image' &&
      message.media?.[0]?.id === asset.id &&
      asset.path.startsWith(`${data.accounts.find((a) => a.label === 'a').session.user.id}/`),
    'H5 photo message references the uploaded asset owned by the sender'
  )
  await button(page, '重试这条消息').waitFor({ state: 'hidden' })
  check(
    (await composer.inputValue()) === draft,
    'H5 successful photo send also preserves the separate text draft'
  )

  // API assertions use normal temporary-user JWTs, not a service key. A successful
  // Storage URL is never written to a log/artifact; only the downloaded bytes are checked.
  async function api(label, path, body) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API scope')
    const headers = { apikey: publicKey }
    if (label)
      headers.Authorization = `Bearer ${data.accounts.find((a) => a.label === label).session.access_token}`
    // Use the actual browser/CORS/network path, not Playwright's Node HTTP stack
    // (which does not share Chrome's system proxy settings on this machine).
    return page.evaluate(
      async ({ url, headers, body }) => {
        const abort = new AbortController()
        const timeout = setTimeout(() => abort.abort(), 30000)
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abort.signal,
            redirect: 'error',
            credentials: 'omit'
          })
          return { status: response.status, json: await response.json() }
        } finally {
          clearTimeout(timeout)
        }
      },
      { url: `${project}${path}`, headers, body }
    )
  }
  const rpc = (label, kind, action, payload) =>
    api(label, `/rest/v1/rpc/fishing_${kind}`, { action, payload })
  async function waitPhoto(tab) {
    await photoButton(tab).waitFor({ timeout: 30000 })
    await photoButton(tab).scrollIntoViewIfNeeded()
    await tab.waitForFunction(
      () => {
        const img = document.querySelector('.chat-image .photo-action img')
        return img?.complete && img.naturalWidth > 0
      },
      undefined,
      { timeout: 35000 }
    )
  }
  setPhase('attachment-receiver-storage')
  await waitPhoto(receiver)
  setPhase('attachment-receiver-download')
  const actualImage = await photoButton(receiver).locator('img').getAttribute('src')
  const downloaded = await receiver.evaluate(async (url) => {
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 30000)
    try {
      const response = await fetch(url, {
        signal: abort.signal,
        redirect: 'error',
        credentials: 'omit'
      })
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { status: response.status, jpeg: bytes[0] === 255 && bytes[1] === 216 }
    } finally {
      clearTimeout(timeout)
    }
  }, actualImage)
  check(
    downloaded.status === 200 && downloaded.jpeg,
    'H5 recipient displays and downloads the real private reencoded JPEG'
  )
  for (const actor of ['outsider', null]) {
    setPhase(`attachment-denied-${actor || 'anonymous'}`)
    const denied = await api(actor, `/storage/v1/object/sign/fishing-media/${asset.path}`, {
      expiresIn: 60
    })
    check(
      denied.status >= 400 && !denied.json.signedURL,
      `H5 ${actor || 'anonymous'} cannot sign the private chat photo`
    )
  }
  setPhase('attachment-denied-metadata')
  const deniedHistory = await rpc('outsider', 'read', 'message_content', {
    id: data.conversation,
    ids: [message.id]
  })
  check(
    deniedHistory.status === 400 && deniedHistory.json.message === 'FORBIDDEN',
    'H5 outsider cannot refresh private attachment metadata'
  )

  setPhase('attachment-idempotence')
  const receipt = await api('a', '/rest/v1/rpc/fishing_write', input)
  check(
    receipt.status === 200 && receipt.json.id === message.id,
    'H5 repeated image request returns the original real message receipt'
  )
  const reused = await rpc('a', 'write', 'send_message', {
    ...input.payload,
    client_id: randomUUID()
  })
  check(
    reused.status === 400 && reused.json.message === 'PHOTO_NOT_AVAILABLE',
    'H5 another message cannot steal an already attached photo'
  )
  await receiver.reload()
  await waitPhoto(receiver)
  check(
    (await photoButton(receiver).count()) === 1,
    'H5 receiver reload shows exactly one photo after request retry'
  )
  await shot('attachment-received-375', receiver)

  const sentCards = []
  for (const type of ['post', 'spot']) {
    setPhase(`attachment-share-${type}`)
    const card = data.cards[type]
    await go(page, `/pages/${type}/detail?id=${card.id}`)
    await button(page, '发给钓友').click()
    await button(page, '界面验收钓友B').waitFor()
    check(
      await button(page, '确认发送').isDisabled(),
      `H5 ${type} share requires choosing a recipient`
    )
    await button(page, '界面验收钓友B').click()
    if (type === 'spot') {
      await page.setViewportSize({ width: 320, height: 812 })
      await page.emulateMedia({ colorScheme: 'dark' })
      const large = await page.addStyleTag({ content: 'html{font-size:24px!important}' })
      await fits('H5 real share selection fits dark 320 with large text')
      await shot('attachment-share-dark-large-320', page, false)
      await large.evaluate((node) => node.remove())
      await page.emulateMedia({ colorScheme: 'light' })
      await page.setViewportSize({ width: 375, height: 812 })
    }
    const sharedResponse = replyFor(page, 'send_message')
    await button(page, '确认发送').click()
    const shared = await sharedResponse
    check(shared.status() === 200, `H5 ${type} card is shared through the real service`)
    const record = await shared.json()
    check(
      record.card?.id === card.id &&
        record.card.title === card.title &&
        Object.keys(record.card).sort().join(',') === 'detail,id,title,type',
      `H5 ${type} card returns only its current authorized summary`
    )
    if (type === 'spot') {
      check(
        record.card.detail.includes('大致水域') &&
          !JSON.stringify(record).includes('120.51234') &&
          !JSON.stringify(record).includes('到达说明'),
        'H5 real spot card includes neither precise coordinates nor arrival notes'
      )
    }
    sentCards.push(record)
    await button(page, '已发送 · 查看聊天').waitFor()
    await button(page, '已发送 · 查看聊天').click()
    await page.locator('.chat-composer').waitFor()
    const openName = `查看${type === 'post' ? '鱼情' : '钓位'}：${card.title}`
    await button(receiver, openName).waitFor({ timeout: 30000 })
    await button(receiver, openName).click()
    await receiver.getByText(card.title, { exact: true }).first().waitFor()
    check(
      receiver.url().includes(`/pages/${type}/detail?id=${card.id}`),
      `H5 recipient opens the original ${type} from its card`
    )
    await go(receiver, chatPath)
    await button(receiver, openName).waitFor()
  }

  setPhase('attachment-layout')
  for (const [width, height] of [
    [320, 812],
    [375, 812],
    [440, 956],
    [844, 390],
    [1280, 800]
  ]) {
    await receiver.setViewportSize({ width, height })
    await receiver.waitForFunction(() => {
      const composer = document.querySelector('.chat-composer')?.getBoundingClientRect()
      return composer && Math.abs(composer.bottom - window.innerHeight) < 3
    })
    await fits(`H5 real attachment chat fits ${width} viewport`, receiver)
    await shot(`attachments-${width}`, receiver)
  }
  await receiver.setViewportSize({ width: 320, height: 812 })
  await receiver.emulateMedia({ colorScheme: 'dark' })
  await receiver.addStyleTag({ content: 'html{font-size:24px!important}' })
  await fits('H5 real attachment chat fits dark 320 with large text', receiver)
  await shot('attachments-dark-large-320', receiver)

  // Both changes below use the author's normal UI/RPC. Published status was only
  // fixture setup; this actually checks the production withdrawal/reauthorization path.
  for (const type of ['post', 'spot']) {
    setPhase(`attachment-withdraw-${type}`)
    const card = data.cards[type]
    await go(page, `/pages/${type}/detail?id=${card.id}`)
    await button(page, '撤回分享').click()
    const dialog = page.getByRole('dialog', { name: '改为仅自己可见？' })
    await dialog.waitFor()
    const withdrawn = replyFor(page, 'withdraw_content')
    await dialog.getByRole('button', { name: '撤回分享', exact: true }).click()
    check(
      (await withdrawn).status() === 200,
      `H5 author withdraws the ${type} through the real UI and RPC`
    )
    const openName = `查看${type === 'post' ? '鱼情' : '钓位'}：${card.title}`
    await button(receiver, openName).waitFor({ state: 'hidden', timeout: 30000 })
    const neutral = receiver.locator(`#message-${sentCards.find((m) => m.kind === type).id}`)
    await neutral.getByText('内容已不可用', { exact: true }).waitFor()
    check(
      !(await neutral.innerText()).includes(card.title),
      `H5 ${type} withdrawal removes the old card title without a new message`
    )
    const retry = await rpc('a', 'write', 'send_message', {
      conversation_id: data.conversation,
      client_id: randomUUID(),
      kind: type,
      reference_id: card.id
    })
    check(
      retry.status === 400 && retry.json.message === 'CHAT_CONTENT_UNAVAILABLE',
      `H5 withdrawn ${type} cannot be newly shared even by its owner`
    )
  }
  await shot('attachments-withdrawn-dark-large-320', receiver)

  setPhase('attachment-block-retention')
  const blocked = await rpc('a', 'write', 'block', {
    id: data.accounts.find((a) => a.label === 'b').session.user.id,
    enabled: true
  })
  check(blocked.status === 200, 'H5 isolated block succeeds without contacting real users')
  const social = await rpc('b', 'read', 'social', {})
  check(
    social.status === 200 &&
      social.json.conversations.find((c) => c.id === data.conversation)?.can_send === false,
    'H5 real server reports the blocked conversation as read only'
  )
  await receiver
    .getByText('当前不能发送新消息，重新成为好友后可继续。', { exact: true })
    .waitFor({ timeout: 30000 })
  check(
    await button(receiver, '照片').isDisabled(),
    'H5 block disables new photo composition for the former friend'
  )
  const newMessage = await rpc('b', 'write', 'send_message', {
    conversation_id: data.conversation,
    client_id: randomUUID(),
    body: '隔离验收：此消息必须被拒绝'
  })
  check(
    newMessage.status === 400 && newMessage.json.message === 'NOT_FRIENDS',
    'H5 blocked member cannot bypass the UI to send a new message'
  )
  const retained = await api('b', `/storage/v1/object/sign/fishing-media/${asset.path}`, {
    expiresIn: 60
  })
  check(
    retained.status === 200 && !!retained.json.signedURL,
    'H5 conversation members retain authorized historic photo access after blocking'
  )
  const repeated = await api('a', '/rest/v1/rpc/fishing_write', input)
  check(
    repeated.status === 200 && repeated.json.id === message.id,
    'H5 original committed photo receipt remains idempotent after blocking'
  )
}
