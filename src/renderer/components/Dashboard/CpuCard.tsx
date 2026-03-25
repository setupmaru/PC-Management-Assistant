import { useAppStore } from '../../store/appStore'

function getColor(pct: number) {
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f97316'
  if (pct >= 50) return '#eab308'
  return '#22c55e'
}

export default function CpuCard() {
  const metrics = useAppStore((s) => s.metrics)
  const cpu = metrics?.cpu

  const usage = cpu?.usage ?? 0
  const color = getColor(usage)

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" style={styles.icon}>
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <rect x="9" y="9" width="6" height="6"/>
          <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>
        </svg>
        <div style={styles.titleWrap}>
          <span style={styles.label}>CPU</span>
          {cpu?.model ? <span style={styles.model}>{cpu.model}</span> : null}
        </div>
      </div>

      <div style={styles.value} title={`${usage}%`}>
        <span style={{ color }}>{usage}</span>
        <span style={styles.unit}>%</span>
      </div>

      {/* 게이지 바 */}
      <div style={styles.barBg}>
        <div style={{ ...styles.barFill, width: `${usage}%`, background: color }} />
      </div>

      <div style={styles.footer}>
        {cpu && (
          <>
            <span style={styles.meta}>{cpu.cores}코어 · {cpu.speed.toFixed(1)}GHz</span>
            {cpu.temperature && (
              <span style={{ ...styles.meta, color: cpu.temperature > 80 ? '#ef4444' : '#94a3b8' }}>
                {cpu.temperature}°C
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
  },
  icon: {
    marginTop: 2,
    flexShrink: 0,
  },
  titleWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
  },
  model: {
    fontSize: 10,
    color: '#64748b',
    lineHeight: 1.3,
    wordBreak: 'break-word' as const,
  },
  value: {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1,
  },
  unit: {
    fontSize: 14,
    color: '#64748b',
    marginLeft: 2,
  },
  barBg: {
    height: 4,
    background: '#0f172a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.5s ease',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  meta: {
    fontSize: 11,
    color: '#94a3b8',
  },
}
