import { useAppStore } from '../../store/appStore'

const LEVEL_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  'Critical': { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' },
  '중요':     { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.3)' },
  'Error':    { bg: 'rgba(239,68,68,0.08)', color: '#f87171', border: 'rgba(239,68,68,0.2)' },
  '오류':     { bg: 'rgba(239,68,68,0.08)', color: '#f87171', border: 'rgba(239,68,68,0.2)' },
  'Warning':  { bg: 'rgba(234,179,8,0.08)', color: '#fbbf24', border: 'rgba(234,179,8,0.25)' },
  '경고':     { bg: 'rgba(234,179,8,0.08)', color: '#fbbf24', border: 'rgba(234,179,8,0.25)' },
}

export default function AlertBanner() {
  const eventLog = useAppStore((s) => s.eventLog)
  const { events, error } = eventLog

  if (error) {
    return (
      <div style={{ ...styles.banner, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)' }}>
        <span style={styles.icon}>⚠</span>
        <span style={{ ...styles.text, color: '#94a3b8' }}>이벤트 로그 수집 실패 (권한 부족 가능)</span>
      </div>
    )
  }

  const critical = events.filter(e =>
    e.LevelDisplayName === 'Critical' || e.LevelDisplayName === '중요'
  )
  const errors = events.filter(e =>
    e.LevelDisplayName === 'Error' || e.LevelDisplayName === '오류'
  )
  const warnings = events.filter(e =>
    e.LevelDisplayName === 'Warning' || e.LevelDisplayName === '경고'
  )

  if (critical.length === 0 && errors.length === 0 && warnings.length === 0) {
    return (
      <div style={{ ...styles.banner, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
        <span style={styles.icon}>✓</span>
        <span style={{ ...styles.text, color: '#4ade80' }}>최근 24시간 내 중요 이벤트 없음</span>
      </div>
    )
  }

  const mostSevere = critical[0] ?? errors[0] ?? warnings[0]
  const levelStyle = LEVEL_STYLES[mostSevere.LevelDisplayName] ?? LEVEL_STYLES['Warning']

  const summary = [
    critical.length > 0 && `중요 ${critical.length}건`,
    errors.length > 0 && `오류 ${errors.length}건`,
    warnings.length > 0 && `경고 ${warnings.length}건`,
  ].filter(Boolean).join(' · ')

  return (
    <div style={{ ...styles.banner, background: levelStyle.bg, border: `1px solid ${levelStyle.border}` }}>
      <span style={{ ...styles.icon, color: levelStyle.color }}>!</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ ...styles.text, color: levelStyle.color, fontWeight: 600 }}>{summary} </span>
        <span style={{ ...styles.text, color: levelStyle.color, opacity: 0.8 }}>
          최근: {mostSevere.ProviderName} (ID:{mostSevere.Id})
        </span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    lineHeight: 1.4,
  },
  icon: {
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
    width: 16,
    textAlign: 'center' as const,
  },
  text: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
}
