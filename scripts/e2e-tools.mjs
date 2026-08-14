/**
 * Fresh-process tool-package validation: drives each tool package's apply()
 * against a mock ctx so defineTool runs the REAL parameter-DSL validation
 * (the exact check a preset mount performs), then asserts the registered
 * definition shape, guard behavior, and the team-roster prompt section.
 * Run: node scripts/e2e-tools.mjs
 */
import { apply as applyVision, Config as visionConfig } from '../packages/tools/tool-vision/lib/index.js'
import { apply as applyTeam, Config as teamConfig } from '../packages/tools/tool-team/lib/index.js'
import { apply as applyCompare, Config as compareConfig } from '../packages/tools/tool-model-compare/lib/index.js'

let failures = 0
function assert(condition, label) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.error(`  FAIL: ${label}`)
  }
}

const ROSTER = [
  { id: 'main', name: '主代理', role: '统筹全局' },
  { id: 'planner', name: '规划师', role: '拆解任务', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  { id: 'reviewer', name: '审查员', role: '代码审查', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  { id: 'looker', name: '观察员', role: '看图' },
]

function makeMockCtx() {
  const captured = { tools: [], promptSections: [], hired: [], dismissed: new Set() }
  const known = () => captured.hired.map((entry) => entry.instanceId)
  const ctx = {
    collaborationTeam: {
      roster: () => ROSTER,
      resolve: (id) => ROSTER.find((agent) => agent.id === id),
      configured: (agent) => agent.id === 'main' || (agent.provider !== undefined && agent.model !== undefined),
      promptFor: (agent, task) => `prompt:${agent.id}:${task}`,
      spawn: async (_parent, identityId, task) => {
        const record = {
          instanceId: `${identityId}#${captured.hired.length + 1}`,
          identityId,
          name: identityId,
          childId: `child-${captured.hired.length + 1}`,
          label: `team:${identityId}#${captured.hired.length + 1}`,
          createdAt: 1,
        }
        captured.hired.push(record)
        return record
      },
      followup: async (_parent, instanceId) => {
        if (captured.dismissed.has(instanceId)) throw new Error(`专家实例 "${instanceId}" 已被解散，无法再发送消息。`)
        if (!known().includes(instanceId)) throw new Error(`未知的专家实例 "${instanceId}"。`)
        return { instanceId, messageId: 'm1' }
      },
      close: async (_parent, instanceId) => {
        if (!known().includes(instanceId)) throw new Error(`未知的专家实例 "${instanceId}"——用 team_status 查看当前在线实例。`)
        captured.dismissed.add(instanceId)
      },
      instances: async () =>
        captured.hired.map((entry) => ({
          ...entry,
          status: captured.dismissed.has(entry.instanceId) ? 'dismissed' : 'working',
        })),
      workingSet: () => captured.hired.filter((entry) => !captured.dismissed.has(entry.instanceId)),
    },
    subagents: {
      start: async () => ({
        result: Promise.resolve({ output: [{ type: 'text', text: 'ONESHOT' }], stopReason: 'completed' }),
        dispose: async () => {},
      }),
    },
    tools: {
      register(definition) {
        captured.tools.push(definition)
        return () => {}
      },
    },
    get(name) {
      if (name === 'systemPrompt') {
        return {
          section(section) {
            captured.promptSections.push(section)
            return () => {}
          },
        }
      }
      return undefined
    },
    inject(_names, _cb) {},
  }
  return { ctx, captured }
}

function checkTool(packageName, apply, config, toolName) {
  console.log(`== ${packageName} ==`)
  const { ctx, captured } = makeMockCtx()
  try {
    apply(ctx, config)
  } catch (error) {
    assert(false, `apply() threw: ${error.message}`)
    return
  }
  assert(captured.tools.length === 1, `registered exactly one tool (${captured.tools.length})`)
  const tool = captured.tools[0]
  if (tool === undefined) return
  assert(tool.name === toolName, `tool name is ${toolName} (${tool.name})`)
  assert(typeof tool.description === 'string' && tool.description.length > 40, 'description present')
  assert(tool.parameters !== undefined && tool.parameters.type === 'object', 'parameters object-rooted')
  assert(typeof tool.output?.render === 'function', 'output render present')
  assert(tool.output?.schema?.type === 'object', 'output schema object-rooted')
  assert(typeof tool.execute === 'function', 'execute present')
  assert(typeof tool.timeoutMs === 'number' && tool.timeoutMs > 0, 'cooperative timeout declared')
  return tool
}

const presetConfig = {
  team: { providerName: 'spawn', maxDepth: 1 },
  compare: {
    maxTokens: 3000,
    models: [
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
      { provider: 'zhipu', model: 'glm-4.5', label: 'GLM-4.5' },
    ],
  },
  vision: { provider: 'zhipu', model: 'glm-4v-flash', maxTokens: 4096 },
}

// Config schemas must accept the preset's own config payloads.
const teamSchema = teamConfig(presetConfig.team)
assert(teamSchema !== undefined, 'tool-team: Config accepts preset config')
const compareSchema = compareConfig(presetConfig.compare)
assert(compareSchema !== undefined && compareSchema.models.length === 2, 'model-compare: Config accepts preset models')
const visionSchema = visionConfig(presetConfig.vision)
assert(visionSchema !== undefined, 'vision: Config accepts preset profile')

checkTool('@dsh-collaboration/tool-vision', applyVision, presetConfig.vision, 'vision')
checkTool('@dsh-collaboration/tool-model-compare', applyCompare, presetConfig.compare, 'model_compare')

console.log('== @dsh-collaboration/tool-team ==')
{
  const { ctx, captured } = makeMockCtx()
  applyTeam(ctx, presetConfig.team)
  assert(captured.tools.length === 5, `registered five tools (${captured.tools.length})`)
  const names = captured.tools.map((tool) => tool.name).sort()
  assert(names.join(',') === 'roundtable,team_call,team_close,team_message,team_status', `tool names are the v0.2 console (${names.join(',')})`)

  assert(captured.promptSections.length === 1, 'one system-prompt section registered')
  const section = captured.promptSections[0]
  if (section !== undefined) {
    assert(section.name !== undefined && section.order === 150, 'team section at order 150')
    const text = typeof section.text === 'function' ? section.text({}) : section.text
    assert(text.includes('planner') && text.includes('跟随主模型') && text.includes('team_message'), 'team section renders roster, follow-model state and console guidance')
  }

  const teamCall = captured.tools.find((tool) => tool.name === 'team_call')
  const noAgentExec = { signal: new AbortController().signal }
  const agentExec = { agent: { session: { id: 's1' } }, signal: new AbortController().signal }

  const unknown = await teamCall.execute({ agent: 'nobody', task: 'x' }, agentExec).catch((e) => e)
  assert(unknown instanceof Error && /未知专家/.test(unknown.message) && unknown.message.includes('planner'), 'team_call: unknown id lists roster')

  const noAgent = await teamCall.execute({ agent: 'planner', task: 'x' }, noAgentExec).catch((e) => e)
  assert(noAgent instanceof Error && /owning agent/.test(noAgent.message), 'team_call: missing agent guarded')

  // Persistent mode hires instances through the service (multi-clone supported).
  const hired = await teamCall.execute({ agent: 'reviewer', task: '审查 X', instances: 3 }, agentExec)
  assert(hired.instances.length === 3 && hired.instances[0].instanceId === 'reviewer#1' && hired.instances[2].instanceId === 'reviewer#3', 'team_call: three clone instances hired')
  assert(captured.hired.length === 3, 'team_call: spawn called once per clone')

  const badRange = await teamCall.execute({ agent: 'reviewer', task: 'x', instances: 11 }, agentExec).catch((e) => e)
  assert(badRange instanceof Error && /1-10/.test(badRange.message), 'team_call: instance count bounded')

  const badWait = await teamCall.execute({ agent: 'reviewer', task: 'x', wait: true, instances: 2 }, agentExec).catch((e) => e)
  assert(badWait instanceof Error && /wait/.test(badWait.message), 'team_call: wait mode refuses clones')

  // F5: wait mode returns a one-shot marker (empty instances + answer), never an addressable instance id.
  const oneShot = await teamCall.execute({ agent: 'reviewer', task: 'x', wait: true }, agentExec)
  assert(oneShot.instances.length === 0 && oneShot.answer === 'ONESHOT', 'team_call: wait mode returns one-shot marker, not a persistent instance id')

  const teamMessage = captured.tools.find((tool) => tool.name === 'team_message')
  const msgNoAgent = await teamMessage.execute({ to: 'reviewer#1', message: 'hi' }, noAgentExec).catch((e) => e)
  assert(msgNoAgent instanceof Error && /owning agent/.test(msgNoAgent.message), 'team_message: missing agent guarded')

  const teamStatus = captured.tools.find((tool) => tool.name === 'team_status')
  const statusNoAgent = await teamStatus.execute({}, noAgentExec).catch((e) => e)
  assert(statusNoAgent instanceof Error && /owning agent/.test(statusNoAgent.message), 'team_status: missing agent guarded')

  const teamClose = captured.tools.find((tool) => tool.name === 'team_close')
  const closeNoAgent = await teamClose.execute({ instance: 'reviewer#1' }, noAgentExec).catch((e) => e)
  assert(closeNoAgent instanceof Error && /owning agent/.test(closeNoAgent.message), 'team_close: missing agent guarded')

  // Dismissal semantics: unknown ids fail loudly; dismissed instances refuse messages and show as dismissed.
  const closeUnknown = await teamClose.execute({ instance: 'reviewer#9' }, agentExec).catch((e) => e)
  assert(closeUnknown instanceof Error && /未知的专家实例/.test(closeUnknown.message), 'team_close: unknown id fails loudly (no fake success)')

  const closed = await teamClose.execute({ instance: 'reviewer#1' }, agentExec)
  assert(closed.closed === true, 'team_close: valid dismissal reports success')

  const msgToClosed = await teamMessage.execute({ to: 'reviewer#1', message: 'hi' }, agentExec).catch((e) => e)
  assert(msgToClosed instanceof Error && /已被解散/.test(msgToClosed.message), 'team_message: dismissed instance refuses delivery')

  const status = await teamStatus.execute({}, agentExec)
  assert(status.instances.some((entry) => entry.instanceId === 'reviewer#1' && entry.status === 'dismissed'), 'team_status: dismissed instance shows as dismissed')

  const roundtable = captured.tools.find((tool) => tool.name === 'roundtable')
  const emptyPanel = await roundtable.execute({ topic: 't', agents: ['main'] }, noAgentExec).catch((e) => e)
  assert(emptyPanel instanceof Error && /未知专家/.test(emptyPanel.message), 'roundtable: main is not a panel member')

  const card = teamCall.presentCall?.({ agent: 'reviewer', task: 'x', instances: 2 })
  assert(card !== undefined && card.card !== undefined, 'team_call: presentCall pure for valid args')
}

console.log('== execute guards ==')
{
  const { ctx, captured } = makeMockCtx()
  applyVision(ctx, presetConfig.vision)
  const tool = captured.tools[0]
  const exec = { signal: new AbortController().signal }
  const noImages = await tool.execute({ images: [], question: 'x' }, exec).catch((e) => e)
  assert(noImages instanceof Error && /at least one image path/.test(noImages.message), 'vision: empty images guarded')
  const badType = await tool.execute({ images: [{ path: 'x.bmp' }], question: 'x' }, exec).catch((e) => e)
  assert(badType instanceof Error && /unsupported image type/.test(badType.message), 'vision: unsupported type guarded before service use')
  const noServices = await tool.execute({ images: [{ path: 'x.png' }], question: 'x' }, exec).catch((e) => e)
  assert(noServices instanceof Error && /attachments/.test(noServices.message), 'vision: missing services reported')
  const card = tool.presentCall?.({ images: [{ path: 'x.png' }], question: 'x' })
  assert(card !== undefined && card.card !== undefined, 'vision: presentCall pure for valid args')

  const { ctx: ctx3, captured: captured3 } = makeMockCtx()
  applyCompare(ctx3, presetConfig.compare)
  const cmp = captured3.tools[0]
  const noModels = await cmp.execute({ prompt: 'p', models: [] }, { signal: new AbortController().signal }).catch((e) => e)
  assert(noModels instanceof Error && /no models/.test(noModels.message), 'model-compare: empty models guarded')
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll tool-package assertions passed.')
