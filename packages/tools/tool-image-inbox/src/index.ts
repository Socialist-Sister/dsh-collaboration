/**
 * `@dsh-collaboration/tool-image-inbox` (host half): invisible image-paste
 * routing for TEXT-ONLY main agents in collaboration mode.
 *
 * DeepSeek Harness rejects image attachments for models whose adapter-owned
 * `inputModalities` omit "image" (the api-proxy `prompt` admission gate), so a
 * collaboration session on a text-only main model cannot receive pasted
 * images. This row works INSIDE that policy:
 *
 *   - the client half (this package's `./client` bundle, auto-mounted through
 *     the `dsh.client` scan) intercepts image PASTES in collaboration sessions
 *     and sends them to the `imageInbox/upload` Remote method — no visible UI;
 *   - the host saves each image as a FILE inside the session workspace
 *     (`.dsh-inbox/`) and returns the path (plus a short note when the roster
 *     lacks a configured vision identity). It NEVER injects a message: the
 *     path lands in the composer DRAFT, so the main agent acts only when the
 *     user presses Enter — its persona/roster guidance routes image paths to
 *     looker/vision, and the text-only model never sees image content.
 *
 * The `capability` Remote method tells the client whether to intercept: it
 * intercepts ONLY when the session's composed preset is `collaboration`
 * (everywhere else the native attach path is left untouched).
 *
 * Mount as a HOST-composition row (like `@dsh-collaboration/team`):
 *
 *   - id: collaboration-image-inbox
 *     name: '@dsh-collaboration/tool-image-inbox'
 *
 * @module @dsh-collaboration/tool-image-inbox
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const name = 'tool-image-inbox'

/** Hard cap for one upload, enforced before any disk write. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const SESSION_ID_SCHEMA = z.intersection(z.string(), z.unknown())
const UPLOAD_INPUT_SCHEMA = z.object({ name: z.string(), mediaType: z.string(), data: z.string() })
const UPLOAD_RESULT_SCHEMA = z.union([
  z.object({ ok: z.literal(true), path: z.string(), note: z.string() }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
])
const CAPABILITY_RESULT_SCHEMA = z.object({ intercept: z.boolean() })

/**
 * Register STRICT typert invocations with the host gateway. The SRC
 * fallback (scanning `@Remote` markers through `remoteMethods`) reads a
 * module-local WeakMap of the DEPLOYMENT's typert-protocol copy, which a
 * third-party package's own copy can never populate — so third-party host
 * services must register strict descriptors, exactly like the generated
 * `typert.host` artifacts of official packages do.
 */
function registerTypertInvocations(ctx: Context) {
  const typert = (ctx as any).typert as
    | {
        register(contribution: unknown): () => void
      }
    | undefined
  if (typert === undefined) return
  const agentParameter = {
    name: 'agent',
    wire: 'agentId',
    source: 'lookup',
    lookup: 'agent',
    codec: {
      mode: 'strict',
      typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
      schema: SESSION_ID_SCHEMA,
    },
  }
  typert.register({
    package: '@dsh-collaboration/tool-image-inbox',
    face: 'host',
    schemas: [],
    invocations: [
      {
        id: '@dsh-collaboration/tool-image-inbox#imageInbox/capability',
        service: 'imageInbox',
        namespace: 'imageInbox',
        method: 'capability',
        invocation: { kind: 'direct' },
        scope: { context: 'agent', wire: 'agentId' },
        parameters: [agentParameter],
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
          agentParameter,
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
  })
}

const MEDIA_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/** One upload request crossing the wire (lossless JSON only). */
export interface UploadInput {
  name: string
  mediaType: string
  data: string
}

export type UploadResult = { ok: true; path: string; note: string } | { ok: false; error: { code: string; message: string } }

export type CapabilityResult = { intercept: boolean }

/** Keep the on-disk name inside one workspace-safe path segment. */
function sanitizeName(rawName: string, mediaType: string): string {
  const stem =
    basename(rawName)
      .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 80) || 'image'
  const ext = MEDIA_EXT[mediaType] ?? '.bin'
  return /\.(png|jpe?g|webp|gif)$/i.test(stem) ? stem : `${stem}${ext}`
}

/** True when the roster has a vision identity with its own provider/model. */
function visionConfigured(ctx: Context): boolean {
  const team = ctx.get('collaborationTeam')
  if (team === undefined) return false
  try {
    const roster: { id: string }[] = team.roster()
    const looker = roster.find((agent) => agent.id === 'looker')
    return looker !== undefined && team.configured(looker) === true
  } catch {
    return false
  }
}

export default class ImageInboxService extends TypertRemoteService {
  static inject = ['agents', 'agentPresets', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'imageInbox')
    registerTypertInvocations(ctx)
  }

  /** Client-side paste gate: intercept only in collaboration sessions. */
  @Remote('capability')
  capability(agent: Agent): CapabilityResult {
    let intercept = false
    try {
      const agentPresets = (this.ctx as any).agentPresets as
        | { composedPreset(agentCtx: unknown): string | undefined }
        | undefined
      intercept = agentPresets?.composedPreset(agent.ctx) === 'collaboration'
    } catch {
      /* agentPresets unavailable — leave the native paste path untouched */
    }
    return { intercept }
  }

  @Remote('upload')
  async upload(agent: Agent, input: UploadInput): Promise<UploadResult> {
    if (typeof input?.name !== 'string' || typeof input?.data !== 'string' || input.data.length === 0) {
      return { ok: false, error: { code: 'invalid-input', message: '图片上传参数不完整。' } }
    }
    const mediaType = typeof input.mediaType === 'string' && input.mediaType in MEDIA_EXT ? input.mediaType : 'image/png'
    let data: Buffer
    try {
      data = Buffer.from(input.data, 'base64')
    } catch {
      return { ok: false, error: { code: 'invalid-data', message: '图片数据不是有效的 base64。' } }
    }
    if (data.byteLength === 0) return { ok: false, error: { code: 'invalid-data', message: '图片数据为空。' } }
    if (data.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, error: { code: 'too-large', message: '图片超过 20MB 上限。' } }
    }
    const cwd = agent.session.header?.cwd
    if (cwd === undefined || cwd.length === 0) {
      return { ok: false, error: { code: 'no-workspace', message: '会话没有工作目录，无法保存图片。' } }
    }
    const rel = `.dsh-inbox/${Date.now()}-${sanitizeName(input.name, mediaType)}`
    await mkdir(join(cwd, '.dsh-inbox'), { recursive: true })
    await writeFile(join(cwd, rel), data)
    // The image must NOT start a turn: uploading only returns the path (and,
    // when the roster lacks a configured vision identity, a short note the
    // client folds into the draft). The main agent acts when the USER sends
    // the draft — its persona/roster guidance routes image paths to looker.
    const note = visionConfigured(this.ctx)
      ? ''
      : '观察员未配置视觉模型：请先提示用户在 settings.yaml 给 looker 配置，或把会话切到视觉路由'
    return { ok: true, path: rel, note }
  }
}
