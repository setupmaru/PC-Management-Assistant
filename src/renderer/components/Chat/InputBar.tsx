import { ClipboardEvent, DragEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import { ChatImageAttachment, ChatSendPayload } from '../../../shared/chat'

interface Props {
  onSend: (payload: ChatSendPayload) => void
  disabled: boolean
  hasApiKey: boolean
  allowWithoutApiKey?: boolean
  supportsImagePaste?: boolean
  onOpenSettings: () => void
}

const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024
const IMAGE_ONLY_MESSAGE = '이미지 파일만 채팅창에 첨부할 수 있습니다.'

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getFileExtension(file: File): string {
  const [, subtype = 'png'] = file.type.split('/')
  return subtype.replace(/[^a-z0-9]/gi, '') || 'png'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('이미지를 읽을 수 없습니다.'))
    reader.readAsDataURL(file)
  })
}

function hasFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.items).some((item) => item.kind === 'file')
}

async function fileToAttachment(file: File, index: number): Promise<ChatImageAttachment> {
  const dataUrl = await readFileAsDataUrl(file)
  return {
    id: createAttachmentId(),
    name: file.name || `pasted-image-${index + 1}.${getFileExtension(file)}`,
    mimeType: file.type || 'image/png',
    dataUrl,
    size: file.size,
  }
}

export default function InputBar({
  onSend,
  disabled,
  hasApiKey,
  allowWithoutApiKey = false,
  supportsImagePaste = true,
  onOpenSettings,
}: Props) {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragDepthRef = useRef(0)

  const handleSend = () => {
    const text = value.trim()
    if ((!text && attachments.length === 0) || disabled || (!hasApiKey && !allowWithoutApiKey)) return

    onSend({
      text,
      attachments,
    })

    setValue('')
    setAttachments([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const addImageFiles = async (
    files: File[],
    options?: {
      preventDefault?: () => void
      invalidMessage?: string
    },
  ) => {
    if (!supportsImagePaste || disabled) return

    const imageFiles = files.filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      if (files.length > 0 && options?.invalidMessage) {
        options.preventDefault?.()
        alert(options.invalidMessage)
      }
      return
    }

    options?.preventDefault?.()

    const baseAttachmentCount = attachments.length
    const remainingSlots = MAX_ATTACHMENTS - baseAttachmentCount
    if (remainingSlots <= 0) {
      alert(`이미지는 최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`)
      return
    }

    const validImageFiles = imageFiles
      .filter((file) => file.size <= MAX_ATTACHMENT_SIZE_BYTES)
      .slice(0, remainingSlots)

    if (validImageFiles.length < imageFiles.length) {
      alert(`5MB 이하 이미지 ${MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`)
    }

    if (validImageFiles.length === 0) return

    try {
      const nextAttachments = await Promise.all(
        validImageFiles.map((file, index) => fileToAttachment(file, baseAttachmentCount + index)),
      )
      setAttachments((prev) => [...prev, ...nextAttachments].slice(0, MAX_ATTACHMENTS))
    } catch (err) {
      alert(err instanceof Error ? err.message : '이미지를 첨부할 수 없습니다.')
    }
  }

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    await addImageFiles(imageFiles, {
      preventDefault: () => e.preventDefault(),
    })
  }

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!supportsImagePaste || disabled || !hasFileDrag(e.dataTransfer)) return

    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    setIsDragActive(true)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!supportsImagePaste || disabled || !hasFileDrag(e.dataTransfer)) return

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!supportsImagePaste || disabled || !hasFileDrag(e.dataTransfer)) return

    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    if (!supportsImagePaste || disabled || !hasFileDrag(e.dataTransfer)) return

    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setIsDragActive(false)

    await addImageFiles(Array.from(e.dataTransfer.files), {
      invalidMessage: IMAGE_ONLY_MESSAGE,
    })
  }

  useEffect(() => {
    if (!supportsImagePaste && attachments.length > 0) {
      setAttachments([])
    }
  }, [attachments.length, supportsImagePaste])

  useEffect(() => {
    if (!supportsImagePaste || disabled) {
      dragDepthRef.current = 0
      setIsDragActive(false)
    }
  }, [disabled, supportsImagePaste])

  useEffect(() => {
    if (!supportsImagePaste || disabled) return

    const handleWindowDragEnter = (event: globalThis.DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return
      event.preventDefault()
      dragDepthRef.current += 1
      setIsDragActive(true)
    }

    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
    }

    const handleWindowDragLeave = (event: globalThis.DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return
      event.preventDefault()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) {
        setIsDragActive(false)
      }
    }

    const handleWindowDrop = async (event: globalThis.DragEvent) => {
      if (!hasFileDrag(event.dataTransfer)) return
      event.preventDefault()
      dragDepthRef.current = 0
      setIsDragActive(false)
      await addImageFiles(Array.from(event.dataTransfer?.files ?? []), {
        invalidMessage: IMAGE_ONLY_MESSAGE,
      })
    }

    window.addEventListener('dragenter', handleWindowDragEnter)
    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('dragleave', handleWindowDragLeave)
    window.addEventListener('drop', handleWindowDrop)

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter)
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('dragleave', handleWindowDragLeave)
      window.removeEventListener('drop', handleWindowDrop)
    }
  }, [addImageFiles, disabled, supportsImagePaste])

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !disabled

  if (!hasApiKey && !allowWithoutApiKey) {
    return (
      <div style={styles.noKeyWrapper}>
        <span style={styles.noKeyText}>OpenAI API 키가 필요합니다.</span>
        <button style={styles.setKeyBtn} onClick={onOpenSettings}>
          API 키 설정
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        ...styles.wrapper,
        ...(isDragActive ? styles.wrapperDragActive : null),
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {attachments.length > 0 && (
        <div style={styles.attachmentList}>
          {attachments.map((attachment) => (
            <div key={attachment.id} style={styles.attachmentItem}>
              <img
                src={attachment.dataUrl}
                alt={attachment.name}
                style={styles.attachmentPreview}
              />
              <button
                type="button"
                style={styles.removeAttachmentBtn}
                onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
                title="첨부 이미지 제거"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={styles.composerRow}>
        <textarea
          ref={textareaRef}
          style={styles.textarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder={
            disabled
              ? '응답을 기다리는 중입니다...'
              : supportsImagePaste
                ? '질문을 입력하세요... (Enter: 전송, Shift+Enter: 줄바꿈, Ctrl+V/드래그 앤 드롭: 이미지 첨부)'
                : '질문을 입력하세요... (Enter: 전송, Shift+Enter: 줄바꿈)'
          }
          disabled={disabled}
          rows={1}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: canSend ? 1 : 0.4,
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
          onClick={handleSend}
          disabled={!canSend}
          title="전송 (Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>

      {supportsImagePaste && (
        <div style={styles.helperText}>
          클립보드 이미지는 Ctrl+V로, 파일은 드래그 앤 드롭으로 바로 첨부할 수 있습니다.
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '12px 16px',
    borderTop: '1px solid #334155',
    background: '#0f172a',
    transition: 'background 0.15s, box-shadow 0.15s',
  },
  wrapperDragActive: {
    background: '#10203a',
    boxShadow: 'inset 0 0 0 1px rgba(96,165,250,0.55)',
  },
  composerRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
  },
  attachmentList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  attachmentItem: {
    position: 'relative',
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #334155',
    background: '#1e293b',
  },
  attachmentPreview: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  removeAttachmentBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(15,23,42,0.88)',
    color: '#fff',
    fontSize: 14,
    lineHeight: 1,
    cursor: 'pointer',
  },
  textarea: {
    flex: 1,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 10,
    color: '#f1f5f9',
    fontSize: 14,
    padding: '10px 14px',
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    minHeight: 42,
    maxHeight: 160,
    overflowY: 'auto',
    transition: 'border-color 0.15s',
  },
  helperText: {
    fontSize: 11,
    color: '#64748b',
    paddingLeft: 2,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    background: '#3b82f6',
    border: 'none',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'opacity 0.15s, transform 0.1s',
  },
  noKeyWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: '14px 16px',
    borderTop: '1px solid #334155',
    background: '#0f172a',
  },
  noKeyText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  setKeyBtn: {
    background: '#3b82f6',
    border: 'none',
    color: '#fff',
    padding: '7px 16px',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
}
