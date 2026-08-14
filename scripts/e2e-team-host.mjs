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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll team-host assertions passed.')
