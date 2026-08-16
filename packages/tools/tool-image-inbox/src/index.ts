/**
 * `@dsh-collaboration/tool-image-inbox` (host half): the image-upload seam for
 * TEXT-ONLY main agents.
 *
 * DeepSeek Harness rejects image attachments for models whose
 * `inputModalities` omit "image" (the api-proxy `prompt` admission gate), so a
 * collaboration session on a text-only main model cannot receive images
 * through the composer — even when a vision specialist (`looker`) is
 * configured. This row works INSIDE that policy instead of against it:
 *
 *   - the client half (this package's `./client` bundle, auto-mounted through
 *     the `dsh.client` scan) puts an "上传图片" button in the composer tool
 *     row (`conversation.input.left`);
 *   - the button sends the image through this service's @Remote `upload`
 *     method (typert gateway, session-scoped authorization);
 *   - the host saves the image as a FILE inside the session workspace
 *     (`.dsh-inbox/`) and delivers a plugin-sourced user message naming the
 *     path;
 *   - the main agent then routes the PATH to the `vision` tool or to `looker`
 *     via `team_call` — the text-only model never sees image content, and the
 *     image never reaches the wire adapter.
 *
 * Mount as a HOST-composition row (like `@dsh-collaboration/team`):
 *
 *   - id: collaboration-image-inbox
 *     name: '@dsh-collaboration/tool-image-inbox'
 *
 * @module @dsh-collaboration/tool-image-inbox
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const name = 'tool-image-inbox'

/** Hard cap for one upload, enforced before any disk write. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

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

export type UploadResult = { ok: true; path: string } | { ok: false; error: { code: string; message: string } }

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

export class ImageInboxService extends TypertRemoteService {
  static inject = ['agents']

  constructor(ctx: Context) {
    super(ctx, 'imageInbox')
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
    const message = createUserMessage({
      content: [
        {
          type: 'text',
          text:
            `[图片上传] 用户通过「上传图片」按钮把一张图片存到了会话工作区：${rel}\n` +
            `请立即处理：用 vision 工具分析这张图，或 team_call 雇佣观察员（looker）并把该路径交给它分析；完成后把结果告诉用户。`,
        },
      ],
      source: { kind: 'plugin', plugin: '@dsh-collaboration/tool-image-inbox' },
    })
    agent.followup(message)
    return { ok: true, path: rel }
  }
}

export function apply(ctx: Context) {
  new ImageInboxService(ctx)
}
