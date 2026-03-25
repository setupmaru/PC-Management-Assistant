import { useState } from 'react'
import { useAppStore } from '../../store/appStore'

const SEVERITY_COLOR: Record<string, string> = {
  Critical:    '#ef4444',
  Important:   '#f97316',
  Moderate:    '#eab308',
  Low:         '#22c55e',
  Unspecified: '#64748b',
}

function severityOrder(s: string): number {
  return { Critical: 0, Important: 1, Moderate: 2, Low: 3, Unspecified: 4 }[s] ?? 5
}

export default function WindowsUpdateCard() {
  const windowsUpdate = useAppStore((s) => s.windowsUpdate)
  const [expanded, setExpanded] = useState(false)
  const [requesting, setRequesting] = useState(false)

  const handleCheck = async () => {
    if (requesting || windowsUpdate.isChecking) return
    setRequesting(true)
    try {
      const res = await window.api.checkWindowsUpdates() as {
        success: boolean
        data?: { count: number }
      }
      if (!res.success || !res.data || res.data.count <= 0) return
      await window.api.startWindowsUpdateConflictFlow()
    } finally {
      setRequesting(false)
    }
  }

  const isChecking = windowsUpdate.isChecking || requesting
  const { count, updates, error, checkedAt } = windowsUpdate

  const checkedTimeStr = checkedAt
    ? new Date(checkedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null

  // 심각도별 집계
  const severityCounts = updates.reduce<Record<string, number>>((acc, u) => {
    acc[u.Severity] = (acc[u.Severity] ?? 0) + 1
    return acc
  }, {})
  const severityEntries = Object.entries(severityCounts).sort(
    ([a], [b]) => severityOrder(a) - severityOrder(b)
  )

  // 상태 색상
  let statusColor = '#64748b'
  let statusLabel = '알 수 없음'
  if (isChecking) {
    statusColor = '#3b82f6'
    statusLabel = '검사 중...'
  } else if (error && count === -1) {
    statusColor = '#64748b'
    statusLabel = '확인 실패'
  } else if (count === 0) {
    statusColor = '#22c55e'
    statusLabel = '최신 상태'
  } else if (count > 0) {
    const hasCritical = severityCounts['Critical'] > 0
    const hasImportant = severityCounts['Important'] > 0
    statusColor = hasCritical ? '#ef4444' : hasImportant ? '#f97316' : '#eab308'
    statusLabel = `${count}개 업데이트 대기`
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.row}>
        <div style={styles.left}>
          {/* 아이콘 */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
          </svg>
          <div style={styles.labelGroup}>
            <span style={styles.label}>WINDOWS UPDATE</span>
            <span style={{ ...styles.status, color: statusColor }}>
              {isChecking ? (
                <span style={styles.spinner} />
              ) : null}
              {statusLabel}
            </span>
          </div>
        </div>
        <div style={styles.right}>
          {!isChecking && count > 0 && (
            <button style={styles.expandBtn} onClick={() => setExpanded((v) => !v)} title="목록 보기">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
          )}
          <button
            style={{ ...styles.checkBtn, opacity: isChecking ? 0.5 : 1 }}
            onClick={handleCheck}
            disabled={isChecking}
            title="업데이트 다시 확인"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ animation: isChecking ? 'spin 0.8s linear infinite' : undefined }}>
              <path d="M23 4v6h-6"/>
              <path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 심각도 뱃지 요약 */}
      {!isChecking && count > 0 && (
        <div style={styles.badgeRow}>
          {severityEntries.map(([sev, cnt]) => (
            <span key={sev} style={{ ...styles.badge, borderColor: SEVERITY_COLOR[sev] ?? '#64748b', color: SEVERITY_COLOR[sev] ?? '#64748b' }}>
              {sev === 'Unspecified' ? '기타' : sev} {cnt}
            </span>
          ))}
        </div>
      )}

      {/* 펼친 목록 */}
      {expanded && !isChecking && count > 0 && (
        <div style={styles.list}>
          {updates.slice(0, 8).map((u, i) => (
            <div key={i} style={styles.listItem}>
              <span style={{ ...styles.dot, background: SEVERITY_COLOR[u.Severity] ?? '#64748b' }} />
              <span style={styles.updateTitle}>{u.Title}</span>
            </div>
          ))}
          {updates.length > 8 && (
            <div style={styles.moreLabel}>외 {updates.length - 8}개...</div>
          )}
        </div>
      )}

      {/* 마지막 확인 시각 */}
      {checkedTimeStr && !isChecking && (
        <div style={styles.checkedAt}>마지막 확인 {checkedTimeStr}</div>
      )}

      {/* 오류 메시지 */}
      {error && count === -1 && !isChecking && (
        <div style={styles.errorText} title={error}>확인 불가 — 다시 시도</div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
  },
  labelGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    minWidth: 0,
  },
  label: {
    fontSize: 9,
    fontWeight: 700,
    color: '#64748b',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  status: {
    fontSize: 11,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  spinner: {
    display: 'inline-block',
    width: 8,
    height: 8,
    border: '1.5px solid #334155',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
    flexShrink: 0,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  checkBtn: {
    background: 'rgba(59,130,246,0.12)',
    border: '1px solid rgba(59,130,246,0.3)',
    borderRadius: 4,
    color: '#60a5fa',
    width: 22,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    color: '#475569',
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  badge: {
    fontSize: 9,
    fontWeight: 700,
    padding: '2px 5px',
    borderRadius: 3,
    border: '1px solid',
    letterSpacing: '0.04em',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    marginTop: 2,
    maxHeight: 150,
    overflowY: 'auto' as const,
  },
  listItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 5,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: 4,
  },
  updateTitle: {
    fontSize: 10,
    color: '#94a3b8',
    lineHeight: 1.4,
    wordBreak: 'break-word' as const,
  },
  moreLabel: {
    fontSize: 10,
    color: '#475569',
    paddingLeft: 10,
  },
  checkedAt: {
    fontSize: 9,
    color: '#334155',
    textAlign: 'right' as const,
  },
  errorText: {
    fontSize: 9,
    color: '#64748b',
    cursor: 'default',
  },
}
