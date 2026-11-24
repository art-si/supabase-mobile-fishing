import { createServer } from 'node:http'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const applicationRoot = resolve(import.meta.dirname, '..')

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pbf': 'application/octet-stream',
  '.md': 'text/plain; charset=utf-8'
}

// A plain file server: no Vite proxy or SPA fallback can conceal Pages failures.
export function createDocsServer({
  directory = resolve(applicationRoot, 'docs'),
  base = '/supabase-mobile-fishing/'
} = {}) {
  const root = realpathSync(directory)
  if (!/^\/(?:[\w-]+\/)*$/.test(base)) throw new Error('Invalid static base path')
  if (!existsSync(resolve(root, 'index.html'))) throw new Error('请先运行 pnpm build:docs。')
  return createServer((req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405).end()
        return
      }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      if (base !== '/' && (pathname === '/' || pathname === base.slice(0, -1))) {
        res.writeHead(302, { Location: base }).end()
        return
      }
      if (!pathname.startsWith(base) || pathname.includes('\\')) throw new Error('outside root')
      const relative = pathname.slice(base.length)
      const file = realpathSync(
        resolve(root, relative + (pathname.endsWith('/') ? 'index.html' : ''))
      )
      if (!file.startsWith(`${root}${sep}`) || !statSync(file).isFile())
        throw new Error('outside root')
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      })
      res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found')
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 5182)
  const server = createDocsServer()
  server.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  server.listen(port, '0.0.0.0', () => {
    console.log(
      `静态预览：http://localhost:${port}/supabase-mobile-fishing/（监听 0.0.0.0，无地图代理）`
    )
  })
}
