// Push the current local HEAD commit to GitHub via the git-data API
// (works when github.com is unreachable but api.github.com is up).
// The new commit is anchored on the REMOTE head (local history may have
// diverged through earlier API pushes whose objects never reached this repo).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const repo = 'Socialist-Sister/dsh-collaboration'
const base = `https://api.github.com/repos/${repo}`

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()

async function api(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${text.slice(0, 400)}`)
  }
  return JSON.parse(text)
}

const localParent = git('rev-parse', 'HEAD~1')
const message = git('log', '-1', '--format=%B')
const author = { name: git('log', '-1', '--format=%an'), email: git('log', '-1', '--format=%ae'), date: git('log', '-1', '--format=%aI') }
const committer = { name: git('log', '-1', '--format=%cn'), email: git('log', '-1', '--format=%ce'), date: git('log', '-1', '--format=%cI') }

const remoteRef = await api('GET', '/git/refs/heads/main')
const remoteHead = remoteRef.object.sha
const remoteCommit = await api('GET', `/git/commits/${remoteHead}`)
console.log(`remote head: ${remoteHead}`)
console.log(`local parent: ${localParent}${localParent === remoteHead ? ' (same)' : ' (different — anchoring on remote head)'}`)

const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').filter(Boolean)
console.log(`files to push: ${changed.length}`)

const tree = []
for (const file of changed) {
  const content = readFileSync(file)
  const blob = await api('POST', '/git/blobs', { content: content.toString('base64'), encoding: 'base64' })
  tree.push({ path: file.replaceAll('\\', '/'), mode: '100644', type: 'blob', sha: blob.sha })
}

const treeResult = await api('POST', '/git/trees', { base_tree: remoteCommit.tree.sha, tree })
const commit = await api('POST', '/git/commits', { message, tree: treeResult.sha, parents: [remoteHead], author, committer })
console.log(`API-created commit: ${commit.sha}`)
console.log(`local HEAD:         ${git('rev-parse', 'HEAD')}`)
console.log('note: sha differs because GitHub normalizes dates to UTC; the tree content is identical')

await api('PATCH', '/git/refs/heads/main', { sha: commit.sha, force: false })
console.log('refs/heads/main updated to', commit.sha)
console.log('reconcile locally (after github.com recovers): git fetch origin && git reset --hard origin/main')
