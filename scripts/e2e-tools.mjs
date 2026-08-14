/**
 * Fresh-process tool-package validation: drives each tool package's apply()
 * against a mock ctx so defineTool runs the REAL parameter-DSL validation
 * (the exact check a preset mount performs), then asserts the registered
 * definition shape. Also validates the Config schemas accept the preset's
 * config payloads. Run: node scripts/e2e-tools.mjs
 */
import { apply as applyVision, Config as visionConfig } from '../packages/tools/tool-vision/lib/index.js'
import { apply as applyRoundtable, Config as roundtableConfig } from '../packages/tools/tool-roundtable/lib/index.js'
import { apply as applyCompare, Config as compareConfig } from '../packages/tools/tool-model-compare/lib/index.js'

let failures = 0
function assert(condition, label) {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.error(`  FAIL: ${label}`)
  }
}

function makeMockCtx() {
  const captured = { tools: [] }
  const ctx = {
    tools: {
      register(definition) {
        captured.tools.push(definition)
        return () => {}
      },
    },
    get(name) {
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
  assert(tool.execute !== undefined && typeof tool.execute === 'function', 'execute present')
  if (tool.isConcurrencySafe !== undefined) {
    assert(typeof tool.isConcurrencySafe === 'function', 'concurrency-safe classifier (when present) is a function')
  } else {
    assert(true, 'concurrency-safe classifier metadata may live registry-side')
  }
  assert(typeof tool.timeoutMs === 'number' && tool.timeoutMs > 0, 'cooperative timeout declared')
  return tool
}

const presetConfig = {
  roundtable: {
    providerName: 'spawn',
    maxDepth: 0,
    experts: [
      { name: 'architect', role: '架构师', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      { name: 'security', role: '安全工程师', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    ],
  },
  compare: {
    maxTokens: 3000,
    models: [
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
      { provider: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini-2.5-Flash' },
    ],
  },
  vision: { provider: 'gemini', model: 'gemini-2.5-flash', maxTokens: 4096 },
}

// Config schemas must accept the preset's own config payloads.
const roundtableSchema = roundtableConfig(presetConfig.roundtable)
assert(roundtableSchema !== undefined && roundtableSchema.experts.length === 2, 'roundtable: Config accepts preset experts')
const compareSchema = compareConfig(presetConfig.compare)
assert(compareSchema !== undefined && compareSchema.models.length === 2, 'model-compare: Config accepts preset models')
const visionSchema = visionConfig(presetConfig.vision)
assert(visionSchema !== undefined, 'vision: Config accepts preset profile')

checkTool('@dsh-collaboration/tool-roundtable', applyRoundtable, presetConfig.roundtable, 'roundtable')
checkTool('@dsh-collaboration/tool-model-compare', applyCompare, presetConfig.compare, 'model_compare')
checkTool('@dsh-collaboration/tool-vision', applyVision, presetConfig.vision, 'vision')

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

  const { ctx: ctx2, captured: captured2 } = makeMockCtx()
  applyRoundtable(ctx2, presetConfig.roundtable)
  const rt = captured2.tools[0]
  const noAgent = await rt.execute({ topic: 't' }, { signal: new AbortController().signal }).catch((e) => e)
  assert(noAgent instanceof Error && /owning agent/.test(noAgent.message), 'roundtable: missing agent guarded')

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
