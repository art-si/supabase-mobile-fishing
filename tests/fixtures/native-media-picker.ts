import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveMobileProRoot } from '../../scripts/mobile-pro.mjs'

/** Exercise the installed Pro picker and its real page owner against the WeChat callback API. */
export function nativePicker() {
  const root = resolve(resolveMobileProRoot(), 'packages/mobile-core/src')
  const calls: any[] = []
  const listeners = new Set<() => void>()
  let page = { route: 'pages/post/detail' }
  const uni = {
    chooseMedia: (options: any) => calls.push(options),
    onAppHide: (fn: () => void) => listeners.add(fn),
    offAppHide: (fn: () => void) => listeners.delete(fn)
  }
  function load(file: string, dependencies: Record<string, unknown> = {}) {
    const source = readFileSync(resolve(root, file), 'utf8').replace(/\/\/ #ifdef H5[\s\S]*?\/\/ #endif/g, '')
    const exports: Record<string, any> = {}
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    })
    runInNewContext(outputText, {
      exports, uni, getCurrentPages: () => [page],
      require(id: string) { assert.ok(id in dependencies, id); return dependencies[id] }
    })
    return exports
  }
  const session = load('media-picker-session.ts')
  const picker = load('media-choose.ts', { './media-picker-session': session })
  return {
    choose: picker.chooseMediaFiles, calls, session,
    setPage(next: { route: string }) { page = next },
    hide() { for (const notify of listeners) notify() },
    listeners: () => listeners.size
  }
}
