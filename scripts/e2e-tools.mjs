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
  const captured = { tools: [], promptSections: [] }
  const ctx = {
    collaborationTeam: {
      roster: () => ROSTER,
      resolve: (id) => ROSTER.find((agent) => agent.id === id),
      configured: (agent) => agent.id === 'main' || (agent.provider !== undefined && agent.model !== undefined),
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
  team: { providerName: 'spawn', maxDepth: 0 },
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
  assert(captured.tools.length === 2, `registered two tools (${captured.tools.length})`)
  const names = captured.tools.map((tool) => tool.name).sort()
  assert(names.join(',') === 'roundtable,team_call', `tool names are team_call+roundtable (${names.join(',')})`)

  assert(captured.promptSections.length === 1, 'one system-prompt section registered')
  const section = captured.promptSections[0]
  if (section !== undefined) {
    assert(section.name !== undefined && section.order === 150, 'roster section at order 150')
    const text = typeof section.text === 'function' ? section.text({}) : section.text
    assert(text.includes('planner') && text.includes('未配置') && text.includes('looker'), 'roster text renders identities and unconfigured state')
  }

  const teamCall = captured.tools.find((tool) => tool.name === 'team_call')
  const exec = { signal: new AbortController().signal }

  const unknown = await teamCall.execute({ agent: 'nobody', task: 'x' }, exec).catch((e) => e)
  assert(unknown instanceof Error && /未知专家/.test(unknown.message) && unknown.message.includes('planner'), 'team_call: unknown id lists roster')

  const unconfigured = await teamCall.execute({ agent: 'looker', task: 'x' }, exec).catch((e) => e)
  assert(unconfigured instanceof Error && /尚未配置模型/.test(unconfigured.message) && unconfigured.message.includes('collaboration-team'), 'team_call: unconfigured identity names the settings fix')

  const noAgent = await teamCall.execute({ agent: 'planner', task: 'x' }, exec).catch((e) => e)
  assert(noAgent instanceof Error && /owning agent/.test(noAgent.message), 'team_call: missing agent guarded')

  const roundtable = captured.tools.find((tool) => tool.name === 'roundtable')
  const emptyPanel = await roundtable.execute({ topic: 't', agents: ['main'] }, exec).catch((e) => e)
  assert(emptyPanel instanceof Error && /未知专家/.test(emptyPanel.message), 'roundtable: main is not a panel member')

  const card = teamCall.presentCall?.({ agent: 'reviewer', task: 'x' })
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
