/**
 * Rebuild the temp verification environment for image-inbox (profile + home
 * + tarballs). Run: node scripts/setup-verify-env.mjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const ENV_DIR = join(process.env.TEMP ?? '/tmp', 'dsh-inbox-e2e')
const HOME_DIR = join(ENV_DIR, 'home')
const PROFILE = join(HOME_DIR, 'profiles', 'e2e')
const DIST = join(ENV_DIR, 'dist')
const UTF8 = { encoding: 'utf8' }

rmSync(ENV_DIR, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })
mkdirSync(join(HOME_DIR, '.agent-presets'), { recursive: true })
mkdirSync(DIST, { recursive: true })

const sh = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', shell: process.platform === 'win32' })
const run = (cmd, args, cwd) => {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  try {
    return sh(cmd, args, cwd).toString()
  } catch (error) {
    console.error('command failed:', error.message)
    console.error(error.stdout?.toString() ?? '', error.stderr?.toString() ?? '')
    process.exit(1)
  }
}

const packages = [
  ['packages/host/team', 'dsh-collaboration-team-0.4.1.tgz'],
  ['packages/tools/tool-team', 'dsh-collaboration-tool-team-0.4.1.tgz'],
  ['packages/tools/tool-model-compare', 'dsh-collaboration-tool-model-compare-0.1.0.tgz'],
  ['packages/tools/tool-vision', 'dsh-collaboration-tool-vision-0.2.0.tgz'],
  ['packages/tools/tool-image-inbox', 'dsh-collaboration-tool-image-inbox-0.2.2.tgz'],
]
for (const [dir, name] of packages) {
  run('pnpm', ['pack'], join(ROOT, dir))
  // pnpm pack prints the tarball name on the last line; move the newest tgz
  const { readdirSync } = await import('node:fs')
  const tgz = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.tgz')).sort().pop()
  if (!tgz) throw new Error(`no tarball produced in ${dir}`)
  copyFileSync(join(ROOT, dir, tgz), join(DIST, name))
  rmSync(join(ROOT, dir, tgz), { force: true })
}

writeFileSync(join(PROFILE, 'pnpm-workspace.yaml'), 'packages:\n  - .\n', UTF8)
writeFileSync(join(PROFILE, '.npmrc'), 'nodeLinker: hoisted\nautoInstallPeers: false\n', UTF8)
const fileRef = (name) => `file:${DIST.replaceAll('\\', '/')}/${name}`
writeFileSync(
  join(PROFILE, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-profile-e2e',
      private: true,
      dependencies: {
        '@dsh-collaboration/team': fileRef('dsh-collaboration-team-0.4.1.tgz'),
        '@dsh-collaboration/tool-team': fileRef('dsh-collaboration-tool-team-0.4.1.tgz'),
        '@dsh-collaboration/tool-model-compare': fileRef('dsh-collaboration-tool-model-compare-0.1.0.tgz'),
        '@dsh-collaboration/tool-vision': fileRef('dsh-collaboration-tool-vision-0.2.0.tgz'),
        '@dsh-collaboration/tool-image-inbox': fileRef('dsh-collaboration-tool-image-inbox-0.2.2.tgz'),
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    },
    null,
    2,
  ),
  UTF8,
)
writeFileSync(
  join(PROFILE, 'cordis.patch.yml'),
  "- insert:\n    - id: collaboration-team\n      name: '@dsh-collaboration/team'\n    - id: collaboration-image-inbox\n      name: '@dsh-collaboration/tool-image-inbox'\n",
  UTF8,
)
writeFileSync(join(PROFILE, 'cordis.yml'), '[]\n', UTF8)
writeFileSync(
  join(HOME_DIR, 'settings.yaml'),
  [
    'agent-presets:',
    '  default: collaboration',
    'agent-default-model:',
    '  provider: deepseek-official',
    '  model: deepseek-v4-pro',
    '  reasoningEffort: max',
    'collaboration-team:',
    '  agents:',
    "    - { id: main, name: 主代理, role: 你是本会话的团队主协调者：接到任务先做简短的结构分析、明确分工，然后立即用 team_call 派活；你负责调度与综合决策，不亲自动手执行专家的本职工作。 }",
    "    - { id: looker, name: 观察员, role: 看图、截图与 UI 的多模态分析, provider: zai, model: glm-5v-turbo, toolFilter: { allow: [read, read_image, vision] } }",
    "    - { id: researcher, name: 研究员, role: 检索资料、调研技术、核实事实, provider: deepseek-official, model: deepseek-v4-flash, toolFilter: { allow: [read, glob, grep, web_search] } }",
    '',
  ].join('\n'),
  UTF8,
)
const userHome = process.env.USERPROFILE
const credSrc = join(userHome, '.dsh', '.credentials.yaml')
if (existsSync(credSrc)) copyFileSync(credSrc, join(HOME_DIR, '.credentials.yaml'))
// preset copy (with the machine-specific vision route aligned to zai)
const presetDir = join(HOME_DIR, '.agent-presets', 'collaboration')
mkdirSync(presetDir, { recursive: true })
let preset = execFileSync('node', ['-e', 'console.log(process.argv[1])', 'x'], { cwd: ROOT }).toString() // noop
const { readFileSync } = await import('node:fs')
preset = readFileSync(join(ROOT, 'config', 'agent-presets', 'collaboration', 'agent.cordis.yml'), 'utf8')
preset = preset
  .replace('provider: zhipu\n    model: glm-4v-flash\n    maxTokens: 4096', 'provider: zai\n    model: glm-5v-turbo\n    maxTokens: 4096')
  .replaceAll('provider: zhipu, model: glm-4.5, label: GLM-4.5', 'provider: zai, model: glm-5.2, label: GLM-5.2')
  .replaceAll('provider: zhipu, model: glm-4-flash, label: GLM-4-Flash', 'provider: zai, model: glm-5v-turbo, label: GLM-5V-Turbo')
writeFileSync(join(presetDir, 'agent.cordis.yml'), preset, UTF8)
copyFileSync(join(ROOT, 'config', 'agent-presets', 'collaboration', 'preset.yml'), join(presetDir, 'preset.yml'))

run('pnpm', ['install', '--prefer-offline'], PROFILE)
console.log(`\ntemp env ready: ${ENV_DIR}`)
console.log(`start:  DSH_HOME=${HOME_DIR} dsh --profile e2e --port 3081`)
