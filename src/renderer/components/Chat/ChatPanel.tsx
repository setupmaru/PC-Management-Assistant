import { useEffect, useRef } from 'react'
import { useChat } from '../../hooks/useChat'
import MessageBubble from './MessageBubble'
import InputBar from './InputBar'
import { useAppStore } from '../../store/appStore'

const FREE_DAILY_LIMIT = 10

interface Props {
  onOpenSettings: () => void
}

export default function ChatPanel({ onOpenSettings }: Props) {
  const {
    messages,
    isStreaming,
    sendMessage,
    clearChat,
    hasApiKey,
    pendingWindowsUpdateConflictSessionId,
  } = useChat()
  const { currentUser } = useAppStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  const isPro = currentUser?.plan === 'pro'

  const todayUserMessages = messages.filter((m) => {
    if (m.role !== 'user') return false
    const msgDate = new Date(m.timestamp)
    const today = new Date()
    return (
      msgDate.getFullYear() === today.getFullYear() &&
      msgDate.getMonth() === today.getMonth() &&
      msgDate.getDate() === today.getDate()
    )
  }).length

  const isFreeLimitReached = !isPro && todayUserMessages >= FREE_DAILY_LIMIT

  const lastContent = messages[messages.length - 1]?.content ?? ''
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, lastContent])

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.dot} />
          <span style={styles.headerTitle}>CHAT</span>
          {isStreaming && <span style={styles.streamingBadge}>답변 중...</span>}
          {!isPro && (
            <span style={styles.limitBadge}>
              {todayUserMessages}/{FREE_DAILY_LIMIT}
            </span>
          )}
        </div>
        <button
          style={styles.clearBtn}
          onClick={clearChat}
          title="대화 초기화"
          disabled={isStreaming || messages.length === 0}
        >
          초기화
        </button>
      </div>

      {isFreeLimitReached && (
        <div style={styles.limitBanner}>
          <span style={styles.limitBannerText}>
            오늘 무료 채팅 {FREE_DAILY_LIMIT}회를 모두 사용했습니다.
          </span>
          <button
            style={styles.upgradeLinkBtn}
            onClick={async () => {
              const res = await window.api.subscription.openCheckout('pro')
              if (!res.success) alert(`결제 페이지를 열 수 없습니다.\n\n${res.error ?? '알 수 없는 오류'}`)
            }}
          >
            Pro 업그레이드
          </button>
        </div>
      )}

      <div style={styles.messageList}>
        {messages.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <p style={styles.emptyTitle}>PC Management Assistant</p>
            <p style={styles.emptyDesc}>
              {hasApiKey
                ? '시스템 상태 분석, 에러 진단, 최적화 방법을 물어보세요.'
                : '시작하려면 OpenAI API 키를 설정하세요.'}
            </p>
            {hasApiKey && !isFreeLimitReached && (
              <div style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    style={styles.suggestionBtn}
                    onClick={() => sendMessage({ text: s, attachments: [] })}
                    disabled={isStreaming}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={styles.messages}>
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <InputBar
        onSend={sendMessage}
        disabled={isStreaming || isFreeLimitReached}
        hasApiKey={hasApiKey}
        allowWithoutApiKey={!!pendingWindowsUpdateConflictSessionId}
        supportsImagePaste={!pendingWindowsUpdateConflictSessionId}
        onOpenSettings={onOpenSettings}
      />
    </div>
  )
}

const SUGGESTIONS = [
  '현재 시스템 상태를 분석해줘',
  '최근 에러 이벤트를 요약해줘',
  'CPU 사용률이 높은 원인을 찾아줘',
  '디스크 공간 확보 방법 알려줘',
]

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0f172a',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    height: 44,
    borderBottom: '1px solid #334155',
    background: '#0f172a',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#3b82f6',
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.1em',
    color: '#94a3b8',
    textTransform: 'uppercase' as const,
  },
  streamingBadge: {
    fontSize: 11,
    color: '#3b82f6',
    background: 'rgba(59,130,246,0.1)',
    padding: '2px 8px',
    borderRadius: 10,
    border: '1px solid rgba(59,130,246,0.3)',
  },
  limitBadge: {
    fontSize: 11,
    color: '#64748b',
    background: 'rgba(100,116,139,0.1)',
    padding: '2px 7px',
    borderRadius: 10,
    border: '1px solid rgba(100,116,139,0.2)',
  },
  clearBtn: {
    background: 'none',
    border: '1px solid #334155',
    color: '#64748b',
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  },
  limitBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 16px',
    background: 'rgba(245,158,11,0.07)',
    borderBottom: '1px solid rgba(245,158,11,0.2)',
    flexShrink: 0,
  },
  limitBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#94a3b8',
  },
  upgradeLinkBtn: {
    background: 'none',
    border: '1px solid rgba(245,158,11,0.4)',
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 5,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
  },
  messages: {
    display: 'flex',
    flexDirection: 'column',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 12,
    minHeight: 300,
  },
  emptyIcon: {
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#f1f5f9',
  },
  emptyDesc: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center' as const,
    maxWidth: 320,
    lineHeight: 1.6,
  },
  suggestions: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
    maxWidth: 400,
  },
  suggestionBtn: {
    background: '#1e293b',
    border: '1px solid #334155',
    color: '#94a3b8',
    fontSize: 12,
    padding: '7px 12px',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    textAlign: 'left' as const,
  },
}
