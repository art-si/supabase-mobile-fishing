import test from 'node:test'
import assert from 'node:assert/strict'
import { createUploadQueue } from '../src/_mobile-core/upload-queue'
import { trackUpload } from '../src/_mobile-core/upload-progress'
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
test('shared media queue caps actual concurrency, deduplicates work and starts waiting items as slots free', async () => {
  let active = 0,
    maximum = 0
  const started: string[] = [],
    finish = new Map<string, () => void>()
  const queue = createUploadQueue<{ key: string }>(async (item) => {
    active++
    maximum = Math.max(maximum, active)
    started.push(item.key)
    await new Promise<void>((done) => finish.set(item.key, done))
    active--
  }, 3)
  for (const key of ['a', 'b', 'c', 'd', 'a']) queue.enqueue({ key })
  await tick()
  assert.deepEqual(started, ['a', 'b', 'c'])
  assert.equal(maximum, 3)
  finish.get('a')!()
  await tick()
  assert.deepEqual(started, ['a', 'b', 'c', 'd'])
  assert.equal(maximum, 3)
  for (const done of finish.values()) done()
  await tick()
})
test('shared media queue cancels active and waiting entries, pauses authentication failures and survives reuse of the same key', async () => {
  const seen: string[] = [],
    cancelled: string[] = []
  const queue = createUploadQueue<{ key: string }>(async (item, signal) => {
    seen.push(item.key)
    await new Promise<void>((done) =>
      signal.addEventListener('abort', () => {
        cancelled.push(item.key)
        done()
      })
    )
  }, 1)
  queue.enqueue({ key: 'old' })
  queue.enqueue({ key: 'waiting' })
  await tick()
  queue.pause()
  queue.remove('old')
  await tick()
  assert.deepEqual(seen, ['old'])
  queue.clear()
  queue.enqueue({ key: 'old' })
  await tick()
  assert.deepEqual(seen, ['old', 'old'])
  queue.clear()
  await tick()
  assert.deepEqual(cancelled, ['old', 'old'])
  assert.ok(!seen.includes('waiting'))
})
test('transport progress forwards actual percentages and cleanup removes progress and cancellation listeners', () => {
  let report: (value: { progress: number }) => void = () => {},
    aborts = 0,
    ended = 0,
    detached = 0
  const listeners = new Set<() => void>(),
    values: number[] = []
  const cleanup = trackUpload(
    {
      onProgressUpdate(cb: typeof report) {
        report = cb
      },
      offProgressUpdate() {
        detached++
      },
      abort() {
        aborts++
      }
    } as any,
    {
      onProgress: (value) => values.push(value),
      signal: {
        aborted: false,
        addEventListener(_type, cb) {
          listeners.add(cb)
        },
        removeEventListener(_type, cb) {
          listeners.delete(cb)
        }
      }
    },
    () => ended++
  )
  report({ progress: 27 })
  report({ progress: 100 })
  assert.deepEqual(values, [27, 100])
  for (const cb of listeners) cb()
  assert.equal(aborts, 1)
  assert.equal(ended, 1)
  cleanup()
  assert.equal(listeners.size, 0)
  assert.equal(detached, 1)
})
