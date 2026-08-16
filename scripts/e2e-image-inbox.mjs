/**
 * Fresh-process host validation for @dsh-collaboration/tool-image-inbox:
 * drives apply() against a mock ctx and asserts the upload path:
 *
 *   1. the imageInbox service is provided with an upload method;
 *   2. a valid upload writes the file into <cwd>/.dsh-inbox/ and delivers a
 *      plugin-sourced user message naming the path (agent.followup);
 *   3. size cap, malformed input, missing workspace, and path traversal in
 *      the file name all fail loudly without touching the disk.
 *
 * Run: node scripts/e2e-image-inbox.mjs
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../packages/tools/tool-image-inbox/lib/index.js'

let failures = 0
function assert(condition, label) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.error(`  FAIL: ${label}`)
  }
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function makeMockCtx(cwd) {
  const state = { delivered: [] }
  const ctx = {
    agents: {
      get: () => undefined,
    },
    // Cordis Service constructor publishes itself through ctx.reflect.provide.
    reflect: {
      provide(name, service) {
        ctx[name] = service
      },
    },
  }
  apply(ctx)
  const agent = {
    session: { id: 's1', header: { cwd } },
    followup(message) {
      state.delivered.push(message)
    },
  }
  return { ctx, state, service: ctx.imageInbox, agent }
}

let dir
try {
  dir = await mkdtemp(join(tmpdir(), 'dsh-image-inbox-'))
  console.log('== @dsh-collaboration/tool-image-inbox ==')
  {
    const { state, service, agent } = makeMockCtx(dir)
    assert(typeof service?.upload === 'function', 'apply() provides the imageInbox service with upload')
    const result = await service.upload(agent, {
      name: '屏幕 截图.png',
      mediaType: 'image/png',
      data: PNG_BYTES.toString('base64'),
    })
    assert(result.ok === true, 'valid upload resolves ok')
    assert(typeof result.path === 'string' && result.path.startsWith('.dsh-inbox/'), `upload returns a workspace-relative path (${result.path})`)
    const written = await readFile(join(dir, result.path))
    assert(written.equals(PNG_BYTES), 'the image bytes land in <cwd>/.dsh-inbox/ verbatim')
    assert(state.delivered.length === 1, 'exactly one message is delivered to the agent')
    const message = state.delivered[0]
    assert(message.role === 'user' && message.source.kind === 'plugin', 'the delivered message is plugin-sourced user content')
    assert(message.content[0].text.includes('[图片上传]') && message.content[0].text.includes(result.path), 'the delivered message names the workspace path')
    assert(/\.png$/i.test(result.path), 'the file extension follows the media type')
  }
  {
    const { service, agent } = makeMockCtx(dir)
    const big = Buffer.alloc(21 * 1024 * 1024, 1).toString('base64')
    const result = await service.upload(agent, { name: 'big.png', mediaType: 'image/png', data: big })
    assert(result.ok === false && result.error.code === 'too-large', 'images over 20MB are rejected before disk write')
  }
  {
    const { state, service, agent } = makeMockCtx(dir)
    const result = await service.upload(agent, { name: '', mediaType: 'image/png', data: '' })
    assert(result.ok === false && result.error.code === 'invalid-input', 'malformed input is rejected')
    assert(state.delivered.length === 0, 'rejected uploads deliver nothing')
  }
  {
    const { service } = makeMockCtx(dir)
    const result = await service.upload(
      { session: { id: 's2', header: {} }, followup: () => {} },
      { name: 'x.png', mediaType: 'image/png', data: PNG_BYTES.toString('base64') },
    )
    assert(result.ok === false && result.error.code === 'no-workspace', 'a session without a workspace directory is rejected')
  }
  {
    const { service, agent } = makeMockCtx(dir)
    const result = await service.upload(agent, {
      name: '..\\..\\evil.png',
      mediaType: 'image/png',
      data: PNG_BYTES.toString('base64'),
    })
    assert(result.ok === true && !result.path.includes('..') && result.path.startsWith('.dsh-inbox/'), `file names are sanitized into one workspace segment (${result.path})`)
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll image-inbox assertions passed.')
