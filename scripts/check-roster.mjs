// One-off check: the user's settings.yaml collaboration-team section must
// parse as YAML and satisfy the team package's schema. (dev utility)
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { TeamSchema } from '../packages/host/team/lib/index.js'

// Locate the user settings.yaml: $DSH_SETTINGS wins, then $DSH_HOME/settings.yaml,
// then the platform default (~/.dsh on POSIX, %USERPROFILE%\.dsh on Windows).
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const settingsPath = process.env.DSH_SETTINGS ?? join(dshHome, 'settings.yaml')
const doc = yaml.load(readFileSync(settingsPath, 'utf8'))
const section = doc?.['collaboration-team']
if (section === undefined) {
  console.log('no collaboration-team section (defaults apply)')
  process.exit(0)
}
const parsed = TeamSchema(section)
const agents = parsed.agents ?? []
console.log(`roster OK: ${agents.length} agents -> ${agents.map((a) => a.id).join(', ')}`)
const unconfigured = agents.filter((a) => a.id !== 'main' && !a.provider && !a.model).map((a) => a.id)
console.log(`unconfigured: ${unconfigured.length > 0 ? unconfigured.join(', ') : '(none)'}`)
