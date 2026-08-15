/**
 * Fresh-process host-package validation: drives @dsh-collaboration/team's
 * apply() against a mock ctx (settings.register for the roster,
 * subagents.listChildren/startContinuable/interrupt/followup, agents.get,
 * provide) and asserts the two v0.3.2 high-severity instance-lifecycle fixes:
 *
 *   1. cold-state concurrent first hires of the same identity never collide
 *      on a label (shared counter-recovery promise via recoveryLocks);
 *   2. workingSet only reports LIVE instances and close() removes the record
 *      from the live registry while the dismissal survives (followup refused,
 *      instances() shows dismissed via label recovery, re-hiring never
 *      collides with a dismissed id).
 *
 * v0.4 adds: the continuable-setup contribution installs a child-scoped
 * `team_help` tool that relays specialist → specialist requests to the main
 * agent as a waking `[team-relay]` report, with requester identity recovered
 * from the live registry or (cold resume) from durable labels.
 *
 * Run: node scripts/e2e-team-host.mjs
 */
import { apply as applyHost } from '../packages/host/team/lib/index.js'

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
  { id: 'reviewer', name: '审查员', role: '代码审查' },
  { id: 'planner', name: '规划师', role: '拆解任务' },
]

function makeHostMockCtx() {
  const state = {
    children: [], // what listChildren returns (durable child labels)
    listDelayMs: 0, // artificial latency for listChildren (race window)
    listCalls: 0,
    live: new Set(), // childIds that agents.get resolves (live); absent = settled
    hired: [], // startContinuable records { label, childId }
    interrupted: [],
    setups: [], // registerContinuableSetup contributions
    reports: [], // reportFrom records { childId, text, delivery }
  }
  let provided
  const ctx = {
    settings: {
      register(_ns, _schema, _opts) {
        return { get: () => ({ agents: ROSTER }) }
      },
    },
    subagents: {
      listChildren: async () => {
        state.listCalls++
        if (state.listDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.listDelayMs))
        return state.children
      },
      startContinuable: async ({ label }) => {
        const childId = `child-${state.hired.length + 1}`
        state.hired.push({ label, childId })
        state.live.add(childId)
        // The child is durable: it keeps appearing in listChildren (interrupt
        // only cancels the current turn, the subagent stays resident).
        state.children.push({ id: childId, label })
        return { childId }
      },
      followup: async () => 'm1', // MessageId (a string; the host wraps it)
      interrupt: async (childId) => {
        state.interrupted.push(childId)
      },
      registerContinuableSetup: (contribution) => {
        state.setups.push(contribution)
        return () => {}
      },
      reportFrom: async (child, content, options) => {
        state.reports.push({
          childId: String(child.session.id),
          text: content[0]?.text ?? '',
          delivery: options?.delivery,
        })
        return 'r1'
      },
    },
    agents: {
      get: (childId) => (state.live.has(childId) ? { id: childId, session: { id: childId } } : undefined),
    },
    provide(name, service) {
      if (name === 'collaborationTeam') provided = service
    },
  }
  return { ctx, state, getService: () => provided }
}

const parent = { session: { id: 's1' } }

console.log('== @dsh-collaboration/team: cold-state concurrent spawn ==')
{
  const { ctx, state, getService } = makeHostMockCtx()
  // Persisted labels from a previous run: reviewer#1, reviewer#2.
  state.children = [
    { id: 'child-1', label: 'team:reviewer#1' },
    { id: 'child-2', label: 'team:reviewer#2' },
  ]
  state.listDelayMs = 50 // widen the race window both spawns would hit
  applyHost(ctx)
  const service = getService()
  const [a, b] = await Promise.all([
    service.spawn(parent, 'reviewer', 'T1'),
    service.spawn(parent, 'reviewer', 'T2'),
  ])
  const ids = [a.instanceId, b.instanceId].sort()
  assert(ids[0] === 'reviewer#3' && ids[1] === 'reviewer#4', `cold-state concurrent hires get distinct ids reviewer#3/reviewer#4 (${a.instanceId}, ${b.instanceId})`)
  assert(a.instanceId !== b.instanceId, 'the two instances do not share an id')
  assert(state.listCalls === 1, `counter recovery is shared: listChildren called once (${state.listCalls})`)
  assert(a.childId !== b.childId, 'the two instances get distinct child sessions')
}

console.log('== @dsh-collaboration/team: workingSet live filter ==')
{
  const { ctx, state, getService } = makeHostMockCtx()
  applyHost(ctx)
  const service = getService()
  const one = await service.spawn(parent, 'reviewer', 'T1')
  assert(service.workingSet('s1').some((entry) => entry.instanceId === 'reviewer#1'), 'workingSet includes a live instance right after spawn')
  state.live.delete(one.childId) // child settles: agents.get(childId) becomes undefined
  assert(!service.workingSet('s1').some((entry) => entry.instanceId === 'reviewer#1'), 'workingSet excludes a settled instance (agents.get undefined)')
  await service.spawn(parent, 'reviewer', 'T2')
  assert(service.workingSet('s1').some((entry) => entry.instanceId === 'reviewer#2'), 'workingSet includes the second live instance')
  await service.close(parent, 'reviewer#2')
  assert(!service.workingSet('s1').some((entry) => entry.instanceId === 'reviewer#2'), 'workingSet excludes a dismissed instance')
}

console.log('== @dsh-collaboration/team: close removes from registry, dismissal survives ==')
{
  // Label-recovered dismissal: persisted children never spawned in this
  // process — close resolves the child via listChildren, and the dismissal
  // mark lives in dismissedRecovered (the in-process bucket-close path is
  // already covered by the workingSet block above).
  const { ctx, state, getService } = makeHostMockCtx()
  state.children = [
    { id: 'child-1', label: 'team:reviewer#1' },
    { id: 'child-2', label: 'team:reviewer#2' },
  ]
  applyHost(ctx)
  const service = getService()
  await service.close(parent, 'reviewer#1')
  assert(state.interrupted.length === 1 && state.interrupted[0] === 'child-1', 'close interrupts the label-recovered child')
  assert(!service.workingSet('s1').some((entry) => entry.instanceId === 'reviewer#1'), 'close removes the instance from the working set')
  const rejected = await service.followup(parent, 'reviewer#1', 'hi').catch((e) => e)
  assert(rejected instanceof Error && /已被解散/.test(rejected.message), 'followup to a closed instance is rejected')
  const views = await service.instances(parent)
  const dismissedView = views.find((entry) => entry.instanceId === 'reviewer#1')
  assert(dismissedView !== undefined && dismissedView.status === 'dismissed', 'instances() shows the closed instance as dismissed via label recovery')
  const again = await service.spawn(parent, 'reviewer', 'T2')
  assert(again.instanceId === 'reviewer#3', 're-hiring after the dismissal recovers from labels and gets reviewer#3, no collision with reviewer#1/#2')
  assert(service.workingSet('s1').some((entry) => entry.instanceId === 'reviewer#3'), 'the re-hired instance is live in the working set')
  const msg = await service.followup(parent, 'reviewer#3', 'hi')
  assert(msg.messageId === 'm1', 'followup to the re-hired instance works (stale dismissal mark cleared)')
}

console.log('== @dsh-collaboration/team: team_help relay (v0.4) ==')
{
  const { ctx, state, getService } = makeHostMockCtx()
  applyHost(ctx)
  const service = getService()
  assert(state.setups.length === 1, 'registers exactly one continuable setup contribution')
  const hired = await service.spawn(parent, 'reviewer', 'T1')
  let registeredTool
  let sectionText = ''
  const childCtx = {
    systemPrompt: { section: ({ text }) => { sectionText = text; return () => {} } },
    tools: { register: (tool) => { registeredTool = tool; return () => {} } },
  }
  const dispose = state.setups[0](childCtx)
  assert(typeof dispose === 'function', 'the setup contribution returns a disposer')
  assert(registeredTool?.name === 'team_help', 'installs the team_help tool into the child scope')
  assert(sectionText.includes('team_help'), 'installs the team_help prompt guidance into the child scope')
  const result = await registeredTool.execute(
    { to: 'planner#1', task: '帮我把这个任务拆开' },
    { agent: { session: { id: hired.childId, header: { parentSession: 's1' } } }, signal: undefined },
  )
  assert(result.messageId === 'r1', 'team_help executes via reportFrom and returns a message id')
  const report = state.reports.at(-1)
  assert(report.delivery === 'wakeup', 'the relay notice uses waking delivery (one new parent turn)')
  assert(report.text.includes('[team-relay] reviewer#1 请求 planner#1'), `the relay notice names requester and target (${report.text})`)
}
{
  // Cold resume: the live registry is empty (restart), so the requester
  // identity must be recovered from the durable child label.
  const { ctx, state } = makeHostMockCtx()
  state.children = [{ id: 'child-9', label: 'team:looker#2' }]
  applyHost(ctx)
  const [setup] = state.setups
  let registeredTool
  const childCtx = {
    systemPrompt: { section: () => () => {} },
    tools: { register: (tool) => { registeredTool = tool; return () => {} } },
  }
  setup(childCtx)
  await registeredTool.execute(
    { to: 'researcher#1', task: '查一下这个接口的文档' },
    { agent: { session: { id: 'child-9', header: { parentSession: 's1' } } }, signal: undefined },
  )
  const report = state.reports.at(-1)
  assert(report.text.includes('[team-relay] looker#2 请求 researcher#1'), `cold-resumed child resolves its identity from the durable label (${report.text})`)
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll team-host assertions passed.')
