/**
 * `@dsh-collaboration/tool-image-inbox` (client half): the composer upload
 * button, auto-mounted through the package's `dsh.client` declaration.
 *
 * Registers one `conversation.input.left` list entry — a small always-visible
 * control beside the resident composer chrome (access mode, plan, attach).
 * Picking a file reads it as base64 and calls the host service's
 * `imageInbox/upload` Remote method; the host stores the image in the session
 * workspace and delivers the path to the main agent.
 *
 * @module @dsh-collaboration/tool-image-inbox/client
 */
import { createElement, useRef, useState } from 'react'

export const name = 'tool-image-inbox-client'
export const inject = ['slots', 'remote', 'remote.imageInbox']

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

function readAsBase64(file: File): Promise<string> {
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

type ButtonProps = {
  onUpload: (file: File) => Promise<{ ok: boolean; path?: string; error?: { message?: string } }>
}

function UploadButton(props: ButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [hint, setHint] = useState('')

  const pick = () => {
    if (state === 'busy') return
    const input = inputRef.current
    if (input !== null) input.click()
  }

  const onChange = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file === undefined) return
    setState('busy')
    try {
      const result = await props.onUpload(file)
      if (result.ok) {
        setHint(result.path ?? '')
        setState('done')
      } else {
        setHint(result.error?.message ?? '上传失败。')
        setState('error')
      }
    } catch (error) {
      setHint(error instanceof Error ? error.message : '上传失败。')
      setState('error')
    }
  }

  const label = state === 'busy' ? '上传中…' : state === 'done' ? '已保存' : state === 'error' ? '失败' : '上传图片'

  return createElement(
    'button',
    {
      type: 'button',
      onClick: pick,
      title:
        state === 'done'
          ? `已保存到工作区：${hint}`
          : state === 'error'
            ? hint
            : '把图片存到会话工作区，交给主代理转给观察员（looker）或 vision 分析——纯文本主模型也能用',
      style: {
        background: 'none',
        border: state === 'error' ? '1px solid #b91c1c' : '1px solid transparent',
        borderRadius: '6px',
        cursor: state === 'busy' ? 'default' : 'pointer',
        fontSize: '12px',
        opacity: state === 'busy' ? 0.6 : 1,
        padding: '2px 8px',
      },
    },
    [
      label,
      createElement('input', {
        key: 'file',
        ref: inputRef,
        type: 'file',
        accept: ACCEPT,
        style: { display: 'none' },
        onChange,
      }),
    ],
  )
}

export function apply(ctx: any) {
  ctx.slots.inject(
    'conversation.input.left',
    () =>
      ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: 'image-inbox',
          order: 20,
          inject: (sessionId: string) => ({
            onUpload: async (file: File) => {
              const data = await readAsBase64(file)
              return await ctx.remote.imageInbox.upload(sessionId, {
                name: file.name,
                mediaType: file.type,
                data,
              })
            },
          }),
        },
        UploadButton,
      ),
  )
}
