import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { RealtimeClient } from '@supabase/realtime-js'
import { createUniWebSocket, type MobileSocketTask } from '../src/_mobile-core/uni-websocket'

function fixture() {
  let opened = () => {},
    message = (_event: { data: string | ArrayBuffer }) => {},
    closed = (_event: { code?: number }) => {},
    error = () => {}
  const sent: string[] = []
  let closeCount = 0
  const task: MobileSocketTask = {
    onOpen: (callback) => {
      opened = callback
    },
    onMessage: (callback) => {
      message = callback
    },
    onClose: (callback) => {
      closed = callback
    },
    onError: (callback) => {
      error = callback
    },
    send: (options) => {
      sent.push(String(options.data))
      options.success()
    },
    close: (options) => {
      closeCount++
      closed({ code: options.code })
    }
  }
  const Socket = createUniWebSocket((options) => {
    assert.equal(typeof options.success, 'function')
    return task
  })
  return {
    Socket,
    task,
    sent,
    open: () => opened(),
    message: (data: string) => message({ data }),
    error: () => error(),
    closed: () => closeCount
  }
}
test('Uni task adapter sends, receives, closes once and ignores post-close events', async () => {
  const f = fixture(),
    socket = new f.Socket('wss://example.invalid/socket')
  let messages = 0,
    closes = 0,
    errors = 0
  socket.onmessage = (event) => {
    assert.equal(event.data, 'hello')
    messages++
  }
  socket.onclose = () => closes++
  socket.onerror = () => errors++
  assert.throws(() => socket.send('early'), /not open/)
  f.open()
  socket.send('sent')
  f.message('hello')
  assert.equal(socket.bufferedAmount, 0)
  assert.deepEqual(f.sent, ['sent'])
  socket.close()
  socket.close()
  f.message('late')
  f.error()
  await Promise.resolve()
  assert.deepEqual([messages, closes, errors], [1, 1, 0])
  assert.equal(f.closed(), 1)
})
test('early cancellation cannot reopen a task and synchronous failures are observable', async () => {
  const f = fixture(),
    socket = new f.Socket('wss://example.invalid/socket')
  let opened = 0
  socket.onopen = () => opened++
  socket.close()
  f.open()
  assert.equal(opened, 0)
  assert.equal(socket.readyState, socket.CLOSED)
  const Broken = createUniWebSocket(() => {
    throw new Error('sensitive provider URL')
  })
  const broken = new Broken('wss://example.invalid/socket')
  let errors = 0,
    closes = 0
  broken.onerror = (event) => {
    assert.equal(JSON.stringify(event).includes('sensitive provider'), false)
    errors++
  }
  broken.onclose = () => closes++
  await Promise.resolve()
  assert.deepEqual([errors, closes], [1, 1])
})
test('native send and cleanup exceptions become one sanitized abnormal close', async () => {
  const f = fixture(),
    socket = new f.Socket('wss://example.invalid/socket')
  const events: { type: string; code?: number }[] = []
  socket.onerror = (event) => {
    assert.equal(JSON.stringify(event).includes('provider-secret'), false)
    events.push({ type: event.type })
  }
  socket.onclose = (event) => events.push({ type: event.type, code: event.code })
  f.task.send = () => {
    throw new Error('provider-secret send bridge failure')
  }
  f.task.close = () => {
    throw new Error('provider-secret cleanup bridge failure')
  }
  f.open()
  assert.doesNotThrow(() => socket.send('message'))
  assert.equal(socket.bufferedAmount, 0)
  assert.equal(socket.readyState, socket.CLOSED)
  // Neither a late native error nor a late open may reopen or leak an exception.
  f.error()
  assert.doesNotThrow(() => f.open())
  await Promise.resolve()
  assert.deepEqual(events, [{ type: 'error' }, { type: 'close', code: 1006 }])
})
test('native close exceptions settle the socket instead of leaving it closing', () => {
  const f = fixture(),
    socket = new f.Socket('wss://example.invalid/socket')
  let closes = 0
  socket.onclose = (event) => {
    assert.equal(event.code, 1006)
    closes++
  }
  f.task.close = () => {
    throw new Error('provider-secret close bridge failure')
  }
  assert.doesNotThrow(() => socket.close())
  socket.close()
  assert.equal(socket.readyState, socket.CLOSED)
  assert.equal(closes, 1)
})
test('mini-program URL polyfill constructs SDK channels without browser globals', () => {
  // A plain Node child avoids tsx's own dependency on native URL during module resolution.
  execFileSync(process.execPath, ['--input-type=module'], {
    timeout: 15000,
    input: `
      import assert from 'node:assert/strict';
      globalThis.URL = globalThis.URLSearchParams = undefined;
      // Node lazily constructs its Fetch classes with TextEncoder; Uni has no such browser API.
      for (const name of ['fetch', 'Request', 'Response', 'Headers', 'WebSocket']) {
        Object.defineProperty(globalThis, name, { value: undefined, configurable: true, writable: true });
      }
      globalThis.TextEncoder = globalThis.TextDecoder = undefined;
      await import('core-js/actual/url/index.js');
      const { RealtimeClient } = await import('@supabase/realtime-js');
      const client = new RealtimeClient('wss://example.invalid/realtime/v1', {
        params: { apikey: 'fixture-public-key' }, vsn: '1.0.0',
        transport: class IsolatedSocket {},
        fetch: async () => { throw new Error('Unexpected HTTP fallback'); }
      });
      assert.equal(client.channel('fishing:user:fixture').topic, 'realtime:fishing:user:fixture');
      assert.equal(new URL('https://example.invalid/?a=b').searchParams.get('a'), 'b');
      assert.equal(typeof TextEncoder, 'undefined');
    `
  })
})
async function withoutTextCodecs(action: () => Promise<void>) {
  const names = ['TextEncoder', 'TextDecoder'] as const
  const descriptors = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name))
  try {
    for (const name of names)
      Object.defineProperty(globalThis, name, {
        value: undefined,
        configurable: true,
        writable: true
      })
    assert.equal(typeof globalThis.TextEncoder, 'undefined')
    assert.equal(typeof globalThis.TextDecoder, 'undefined')
    await action()
  } finally {
    names.forEach((name, index) => {
      const descriptor = descriptors[index]
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
}
test('pinned SDK joins, receives and heartbeats over Uni without text codecs', () =>
  withoutTextCodecs(async () => {
    const f = fixture()
    const frames: { event: string; payload: unknown }[] = []
    f.task.send = (options) => {
      const frame = JSON.parse(String(options.data))
      frames.push(frame)
      options.success()
      queueMicrotask(() =>
        f.message(
          JSON.stringify({
            topic: frame.topic,
            ref: frame.ref,
            event: 'phx_reply',
            payload: { status: 'ok', response: { postgres_changes: [] } }
          })
        )
      )
    }
    const client = new RealtimeClient('wss://example.invalid/realtime/v1', {
      transport: f.Socket,
      params: { apikey: 'fixture-public-key' },
      vsn: '1.0.0',
      timeout: 500,
      heartbeatIntervalMs: 30,
      accessToken: async () => 'fixture-auth-token',
      fetch: async () => {
        throw new Error('HTTP fallback must not run')
      }
    })
    let notifications = 0
    let joinTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      await client.setAuth('fixture-auth-token')
      const subscribed = new Promise<void>((resolve) =>
        client
          .channel('fishing:user:fixture', {
            config: { private: true, presence: { enabled: false } }
          })
          .on('broadcast', { event: 'invalidate' }, () => notifications++)
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') resolve()
          })
      )
      f.open()
      await Promise.race([
        subscribed,
        new Promise((_, reject) => {
          joinTimeout = setTimeout(() => reject(new Error('join timeout')), 1500)
        })
      ])
      clearTimeout(joinTimeout)
      f.message(
        JSON.stringify({
          topic: 'realtime:fishing:user:fixture',
          event: 'broadcast',
          payload: { event: 'invalidate', payload: { v: 1 } }
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 90))
      assert.equal(notifications, 1)
      assert.ok(frames.some((frame) => frame.event === 'heartbeat'))
      assert.ok(frames.some((frame) => frame.event === 'phx_join'))
      assert.ok(!frames.some((frame) => frame.event === 'presence' || frame.event === 'broadcast'))
    } finally {
      clearTimeout(joinTimeout)
      await client.removeAllChannels()
      await client.disconnect()
    }
  }))
