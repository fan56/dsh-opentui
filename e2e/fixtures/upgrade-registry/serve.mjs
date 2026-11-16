#!/usr/bin/env node
// serve.mjs — the offline registry scenario 11-upgrade points both the query
// path (DSH_UPGRADE_REGISTRY -> `npm view`) and the install path (the scratch
// profile's .npmrc -> pnpm) at.
//
// It serves exactly what build-fixture.mjs produced and nothing else:
//   GET /<package name>            packument JSON (percent-encoded scoped names
//                                  and the raw "a/b" spelling both work)
//   GET /<tarball path>            the tarball bytes
//   anything else                  404 {"error":"not found"}
//
// No network access is needed or attempted: the server only reads files from
// the fixture directory. It listens on 127.0.0.1 with port 0 (ephemeral) and
// prints one line to stdout as soon as it is ready:
//
//   REGISTRY http://127.0.0.1:<port>
//
// The scenario polls that line for the port. Every request is logged to stderr
// so a failed leg can be diagnosed from the captured log.
//
// Usage: node serve.mjs <fixture-dir>

import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'

const fixtureDir = process.argv[2]
if (!fixtureDir) {
  console.error('serve.mjs: usage: serve.mjs <fixture-dir>')
  process.exit(2)
}

const root = resolve(fixtureDir)
const meta = JSON.parse(readFileSync(join(root, 'meta.json'), 'utf8'))
const packuments = new Map()
for (const plugin of meta.plugins) {
  const file = join(root, 'packuments', `${plugin.name.replace(/^@/, '').replace(/\//g, '-')}.json`)
  packuments.set(plugin.name, JSON.parse(readFileSync(file, 'utf8')))
}
const tarballFiles = new Map(
  Object.entries(meta.tarballs).map(([urlPath, relPath]) => [urlPath, join(root, relPath)]),
)

const sendJson = (res, status, body) => {
  const text = `${JSON.stringify(body)}\n`
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

const server = createServer((req, res) => {
  const origin = `http://${req.headers.host ?? '127.0.0.1'}`
  let pathname
  try {
    pathname = decodeURIComponent((req.url ?? '/').split('?')[0])
  } catch {
    sendJson(res, 400, { error: 'bad path encoding' })
    return
  }
  console.error(`serve.mjs: ${req.method} ${pathname}`)
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'GET only' })
    return
  }

  if (tarballFiles.has(pathname)) {
    const file = tarballFiles.get(pathname)
    const size = statSync(file).size
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file).pipe(res)
    return
  }

  // Packument lookup: "/@aiwayds/dsh-cron" or the percent-encoded single
  // segment "/@aiwayds%2Fdsh-cron" (npm's install-v1 request).
  const name = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  const document = packuments.get(name)
  if (document === undefined) {
    sendJson(res, 404, { error: `not found: ${name}` })
    return
  }
  // The packument on disk carries tarball PATHS; the absolute origin is only
  // known once the server is listening, so it is filled in per request.
  const withOrigin = {
    ...document,
    versions: Object.fromEntries(
      Object.entries(document.versions).map(([version, manifest]) => [
        version,
        { ...manifest, dist: { ...manifest.dist, tarball: `${origin}${manifest.dist.tarball}` } },
      ]),
    ),
  }
  sendJson(res, 200, withOrigin)
})

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  console.log(`REGISTRY http://127.0.0.1:${port}`)
})

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
