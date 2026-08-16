/**
 * `@dsh-collaboration/tool-image-inbox` (client half): invisible image-paste
 * bridge, auto-mounted through the package's `dsh.client` declaration.
 *
 * No visible UI. Three pieces:
 *
 *  1. a typert Remote contribution for the host `imageInbox` service, mounted
 *     through `ctx.remote.$mount(...)` (the same shape official host packages
 *     ship as their generated `typert.remote-client.js`);
 *  2. a null-rendering `conversation.input.left` entry that only wires the
 *     active session id into the bridge (and refreshes the interception flag
 *     through `imageInbox/capability`);
 *  3. a capture-phase window `paste` listener: when the clipboard carries
 *     image files AND the active session is a collaboration session, it
 *     stops the shell's own image intake, uploads the files through
 *     `imageInbox/upload`, and inserts `[图片: <path>]` text into the draft —
 *     the user then sends a plain text prompt that the host admits, and the
 *     main agent routes the path to looker/vision.
 *
 * Text-only pastes and non-collaboration sessions are passed through
 * untouched.
 *
 * @module @dsh-collaboration/tool-image-inbox/client
 */
import { useEffect } from 'react'
import { z } from 'zod'

export const name = 'tool-image-inbox-client'
export const inject = ['slots', 'remote']

const SESSION_ID_SCHEMA = z.intersection(z.string(), z.unknown())

const UPLOAD_INPUT_SCHEMA = z.object({
  name: z.string(),
  mediaType: z.string(),
  data: z.string(),
})

const UPLOAD_RESULT_SCHEMA = z.union([
  z.object({ ok: z.literal(true), path: z.string(), note: z.string() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
])

const CAPABILITY_RESULT_SCHEMA = z.object({ intercept: z.boolean() })

/**
 * The typert Remote contribution for the host `imageInbox` service.
 * `scope: agent` means the `agent` parameter is a session lookup: callers
 * pass the session id as the FIRST argument (`capability(sessionId)` /
 * `upload(sessionId, input)`), matching the `remote.goals.*` convention.
 */
const CONTRIBUTION = {
  package: '@dsh-collaboration/tool-image-inbox',
  descriptors: [
    {
      id: '@dsh-collaboration/tool-image-inbox#imageInbox/capability',
      service: 'imageInbox',
      namespace: 'imageInbox',
      method: 'capability',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            schema: SESSION_ID_SCHEMA,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@dsh-collaboration/tool-image-inbox#imageInbox/capability:result',
        schema: CAPABILITY_RESULT_SCHEMA,
      },
    },
    {
      id: '@dsh-collaboration/tool-image-inbox#imageInbox/upload',
      service: 'imageInbox',
      namespace: 'imageInbox',
      method: 'upload',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        {
          name: 'agent',
          wire: 'agentId',
          source: 'lookup',
          lookup: 'agent',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
            schema: SESSION_ID_SCHEMA,
          },
        },
        {
          name: 'input',
          wire: 'input',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@dsh-collaboration/tool-image-inbox#imageInbox/upload:input',
            schema: UPLOAD_INPUT_SCHEMA,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@dsh-collaboration/tool-image-inbox#imageInbox/upload:result',
        schema: UPLOAD_RESULT_SCHEMA,
      },
    },
  ],
}

/** Bridge state shared between the (per-session) slot entry and the (once) window listener. */
const runtime: {
  imageInbox: any
  sessionId?: string
  intercept: boolean
  ready: boolean
} = {
  imageInbox: undefined,
  sessionId: undefined,
  intercept: true, // bias: until the first capability refresh lands, prefer interception
  ready: false,
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('读取文件失败。'))
    reader.readAsDataURL(file)
  })
}

async function refreshCapability() {
  if (runtime.imageInbox === undefined || runtime.sessionId === undefined) {
    runtime.intercept = true
    runtime.ready = true
    return
  }
  try {
    const rpc = await runtime.imageInbox.capability(runtime.sessionId)
    runtime.intercept = !rpc.ok || rpc.value.intercept === true
  } catch {
    runtime.intercept = true
  }
  runtime.ready = true
}

async function uploadFile(file: File): Promise<{ ok: boolean; path?: string; note?: string; error?: { code: string; message: string } }> {
  const data = await fileToBase64(file)
  const rpc = await runtime.imageInbox.upload(runtime.sessionId, {
    name: file.name,
    mediaType: file.type,
    data,
  })
  if (!rpc.ok) return { ok: false, error: { code: rpc.error.code, message: rpc.error.message } }
  return rpc.value
}

/** Insert text at the caret of a focused textarea and let the draft store follow. */
function insertText(el: HTMLTextAreaElement, text: string) {
  const viaExec = (() => {
    try {
      return document.execCommand('insertText', false, text)
    } catch {
      return false
    }
  })()
  if (viaExec) return
  // Fallback: rewrite the value and dispatch a real input event so React's
  // onChange keeps the draft store in sync.
  const start = el.selectionStart ?? el.value.length
  el.value = el.value.slice(0, start) + text + el.value.slice(start)
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
}

async function handleImagePaste(target: HTMLTextAreaElement, files: File[]) {
  for (const file of files) {
    let line: string
    try {
      const result = await uploadFile(file)
      line = result.ok
        ? `[图片: ${result.path}]${result.note ? `（${result.note}）` : ''}`
        : `[图片上传失败: ${result.error?.message ?? '未知错误'}]`
    } catch (error) {
      line = `[图片上传失败: ${error instanceof Error ? error.message : String(error)}]`
    }
    insertText(target, `${line}\n`)
  }
}

function onWindowPaste(event: ClipboardEvent) {
  if (runtime.sessionId === undefined) return
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLElement && target.isContentEditable)) return
  const items = event.clipboardData?.items
  if (items === undefined) return
  const files = Array.from(items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null && file.type.startsWith('image/'))
  if (files.length === 0) return
  if (!runtime.intercept) return
  event.preventDefault()
  event.stopPropagation()
  void handleImagePaste(target as HTMLTextAreaElement, files)
}

/** Null-rendering bridge entry: wires the active session into the paste listener. */
function PasteBridge(props: { sessionId: string }) {
  const sessionId = props.sessionId
  useEffect(() => {
    runtime.sessionId = sessionId
    runtime.intercept = true
    runtime.ready = false
    void refreshCapability()
    return () => {
      if (runtime.sessionId === sessionId) {
        runtime.sessionId = undefined
        runtime.intercept = true
        runtime.ready = false
      }
    }
  }, [sessionId])
  return null
}

export async function apply(ctx: any) {
  await ctx.remote.$mount(CONTRIBUTION)
  // The mount installs the namespace as a provided service under the
  // `remote.imageInbox` key; resolve it through the optional-service
  // accessor (the traced ctx.remote proxy would trip the inject guard).
  const imageInbox = ctx.get('remote.imageInbox')
  if (imageInbox === undefined) throw new Error('image-inbox: Remote namespace imageInbox did not mount')
  runtime.imageInbox = imageInbox
  ctx.effect(
    () => {
      window.addEventListener('paste', onWindowPaste, { capture: true })
      return () => window.removeEventListener('paste', onWindowPaste, { capture: true })
    },
    'image-inbox: window paste listener',
  )
  ctx.slots.inject(
    'conversation.input.left',
    () =>
      ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: 'image-inbox-paste',
          order: 40,
        },
        PasteBridge,
      ),
  )
}
