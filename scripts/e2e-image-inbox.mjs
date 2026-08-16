/**
 * Fresh-process host validation for @dsh-collaboration/tool-image-inbox:
 *
 *   1. the imageInbox service (default-export Service class) is constructible
 *      and provides `capability` + `upload`;
 *   2. capability gates on the session's composed preset (collaboration
 *      only; agentPresets failures fall back to false);
 *   3. a valid upload writes the file into <cwd>/.dsh-inbox/, delivers a
 *      plugin-sourced user message naming the path, and adapts the routing
 *      text to whether a vision identity (looker) is configured;
 *   4. size cap, malformed input, missing workspace, and path traversal in
 *      the file name all fail loudly without touching the disk.
 *
 * Run: node scripts/e2e-image-inbox.mjs
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ImageInboxService from '../packages/tools/tool-image-inbox/lib/index.js'

let failures = 0
function assert(condition, label) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.error(`  FAIL: ${label}`)
  }
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function makeCtx(cwd, { preset = 'collaboration', lookerConfigured = true } = {}) {
  const state = { delivered: [], typert: [] }
  const ctx = {
    reflect: {
      provide(name, service) {
        ctx[name] = service
      },
    },
    get: (name) => ctx[name],
    agents: { get: () => undefined },
    agentPresets: {
      composedPreset: () => preset,
    },
    typert: {
      register(contribution) {
        state.typert.push(contribution)
      },
    },
    collaborationTeam: {
      roster: () => [
        { id: 'main', name: '主代理' },
        { id: 'looker', name: '观察员', provider: lookerConfigured ? 'zai' : undefined, model: lookerConfigured ? 'glm-5v-turbo' : undefined },
      ],
      configured: (agent) => agent.provider !== undefined && agent.model !== undefined,
    },
  }
  const service = new ImageInboxService(ctx)
  const agent = {
    ctx: {}, // agentPresets.composedPreset receives agent.ctx
    session: { id: 's1', header: { cwd } },
    followup(message) {
      state.delivered.push(message)
    },
  }
  return { ctx, state, service, agent }
}

let dir
try {
  dir = await mkdtemp(join(tmpdir(), 'dsh-image-inbox-'))
  console.log('== @dsh-collaboration/tool-image-inbox (v0.2) ==')
  {
    const { state, service, agent } = makeCtx(dir)
    assert(typeof service?.capability === 'function' && typeof service?.upload === 'function', 'service provides capability + upload')
    assert(service.capability(agent).intercept === true, 'capability: collaboration session intercepts')
    const other = makeCtx(dir, { preset: 'standard' })
    assert(other.service.capability(other.agent).intercept === false, 'capability: non-collaboration session passes through')
    assert(state.typert.length === 1, 'strict typert invocations registered once')
    const contribution = state.typert[0]
    assert(contribution.package === '@dsh-collaboration/tool-image-inbox' && contribution.face === 'host', 'typert contribution names the package on the host face')
    assert(contribution.invocations.length === 2, 'two invocations registered (capability + upload)')
    const endpoints = contribution.invocations.map((i) => `${i.namespace}/${i.method}`).sort()
    assert(endpoints.join(',') === 'imageInbox/capability,imageInbox/upload', `invocation endpoints correct (${endpoints.join(', ')})`)
    for (const invocation of contribution.invocations) {
      assert(invocation.result.mode === 'strict' && typeof invocation.result.schema.parse === 'function', `${invocation.method}: strict result codec with a zod schema`)
      const agentParam = invocation.parameters.find((p) => p.source === 'lookup')
      assert(agentParam?.lookup === 'agent' && agentParam?.wire === 'agentId', `${invocation.method}: agent lookup parameter declared`)
    }
  }
  {
    const { ctx, state, service, agent } = makeCtx(dir)
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
    assert(message.content[0].text.includes('looker') && !message.content[0].text.includes('尚未配置'), 'looker configured: the message routes to the specialist')
    assert(/\.png$/i.test(result.path), 'the file extension follows the media type')
    ctx.name = 'unused'
  }
  {
    const { state, service, agent } = makeCtx(dir, { lookerConfigured: false })
    const result = await service.upload(agent, {
      name: 'x.png',
      mediaType: 'image/png',
      data: PNG_BYTES.toString('base64'),
    })
    assert(result.ok === true, 'upload still succeeds without a configured looker')
    const text = state.delivered[0].content[0].text
    assert(text.includes('尚未配置') && text.includes('settings.yaml'), 'looker unconfigured: the message instructs the agent to hint the user')
  }
  {
    const { service, agent } = makeCtx(dir)
    const big = Buffer.alloc(21 * 1024 * 1024, 1).toString('base64')
    const result = await service.upload(agent, { name: 'big.png', mediaType: 'image/png', data: big })
    assert(result.ok === false && result.error.code === 'too-large', 'images over 20MB are rejected before disk write')
  }
  {
    const { state, service, agent } = makeCtx(dir)
    const result = await service.upload(agent, { name: '', mediaType: 'image/png', data: '' })
    assert(result.ok === false && result.error.code === 'invalid-input', 'malformed input is rejected')
    assert(state.delivered.length === 0, 'rejected uploads deliver nothing')
  }
  {
    const { service } = makeCtx(dir)
    const result = await service.upload(
      { ctx: {}, session: { id: 's2', header: {} }, followup: () => {} },
      { name: 'x.png', mediaType: 'image/png', data: PNG_BYTES.toString('base64') },
    )
    assert(result.ok === false && result.error.code === 'no-workspace', 'a session without a workspace directory is rejected')
  }
  {
    const { service, agent } = makeCtx(dir)
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
