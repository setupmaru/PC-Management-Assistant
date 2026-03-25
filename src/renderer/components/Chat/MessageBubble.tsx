import { useMemo } from 'react'
import { marked, Tokens } from 'marked'
import { ChatMessage } from '../../store/appStore'

const renderer = new marked.Renderer()
const escapeAttr = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

renderer.link = ({ href, title, tokens }: Tokens.Link): string => {
  const safeHref = (href ?? '').trim()
  const text = marked.Parser.parseInline(tokens)
  if (!safeHref || safeHref.toLowerCase().startsWith('javascript:')) {
    return text
  }
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
  return `<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`
}

marked.setOptions({ breaks: true, gfm: true, renderer })

interface Props {
  message: ChatMessage
}

export default function MessageBubble({ message }: Props) {
  const html = useMemo(() => {
    if (message.role === 'assistant' && !message.streaming) {
      return marked.parse(message.content || '') as string
    }
    return null
  }, [message.content, message.role, message.streaming])

  const time = new Date(message.timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (message.role === 'user') {
    return (
      <div style={styles.userWrapper}>
        <div style={styles.userBubble}>
          {message.attachments && message.attachments.length > 0 && (
            <div style={styles.attachmentGrid}>
              {message.attachments.map((attachment) => (
                <img
                  key={attachment.id}
                  src={attachment.dataUrl}
                  alt={attachment.name}
                  style={styles.attachmentImage}
                  title={attachment.name}
                />
              ))}
            </div>
          )}
          {message.content && <span style={styles.userText}>{message.content}</span>}
        </div>
        <span style={styles.time}>{time}</span>
      </div>
    )
  }

  return (
    <div style={styles.assistantWrapper}>
      <div style={styles.assistantAvatar}>AI</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.assistantBubble}>
          {message.streaming ? (
            <>
              <span style={styles.streamingText}>{message.content}</span>
              <span style={styles.cursor}>▍</span>
            </>
          ) : (
            message.content ? (
              <div
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: html || '' }}
              />
            ) : null
          )}
        </div>
        <span style={styles.time}>{time}</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  userWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
    marginBottom: 16,
  },
  userBubble: {
    background: '#3b82f6',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '18px 18px 4px 18px',
    maxWidth: '80%',
    wordBreak: 'break-word',
  },
  attachmentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 8,
    marginBottom: 8,
    minWidth: 180,
  },
  attachmentImage: {
    width: '100%',
    maxWidth: 220,
    borderRadius: 12,
    display: 'block',
    objectFit: 'cover',
    background: 'rgba(255,255,255,0.15)',
  },
  userText: {
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  assistantWrapper: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  assistantAvatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
    marginTop: 4,
  },
  assistantBubble: {
    background: '#1e293b',
    border: '1px solid #334155',
    padding: '10px 14px',
    borderRadius: '4px 18px 18px 18px',
    maxWidth: '100%',
    wordBreak: 'break-word',
    fontSize: 14,
    color: '#f1f5f9',
  },
  time: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  streamingText: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.6,
  },
  cursor: {
    display: 'inline-block',
    color: '#3b82f6',
    animation: 'blink 1s step-end infinite',
  },
}
