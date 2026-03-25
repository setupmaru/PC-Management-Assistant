import { useAppStore } from '../../store/appStore'

function getColor(pct: number) {
  if (pct >= 90) return '#ef4444'
  if (pct >= 75) return '#f97316'
  if (pct >= 60) return '#eab308'
  return '#3b82f6'
}

function fmt(bytes: number): string {
  const gb = bytes / (1024 ** 3)
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / (1024 ** 2)).toFixed(0)}MB`
}

export default function MemoryCard() {
  const metrics = useAppStore((s) => s.metrics)
  const memory = metrics?.memory

  const usage = memory?.usagePercent ?? 0
  const color = getColor(usage)

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <path d="M6 19v-3M10 19v-5M14 19v-3M18 19v-7M6 5a1 1 0 011-1h10a1 1 0 011 1v3H6V5z"/>
          <rect x="2" y="8" width="20" height="8" rx="2"/>
        </svg>
        <span style={styles.label}>메모리</span>
      </div>

      <div style={styles.value}>
        <span style={{ color }}>{usage}</span>
        <span style={styles.unit}>%</span>
      </div>

      <div style={styles.barBg}>
        <div style={{ ...styles.barFill, width: `${usage}%`, background: color }} />
      </div>

      <div style={styles.footer}>
        <span style={styles.meta}>{memory?.total ? `사용: ${fmt(memory.used)}` : ''}</span>
        <span style={styles.meta}>{memory?.total ? `전체: ${fmt(memory.total)}` : ''}</span>
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
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: '#94a3b8',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
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
  },
  meta: {
    fontSize: 11,
    color: '#94a3b8',
  },
}
