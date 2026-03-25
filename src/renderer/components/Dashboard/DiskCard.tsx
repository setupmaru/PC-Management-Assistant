import { useAppStore } from '../../store/appStore'

function getColor(pct: number) {
  if (pct >= 95) return '#ef4444'
  if (pct >= 85) return '#f97316'
  if (pct >= 70) return '#eab308'
  return '#8b5cf6'
}

function fmt(bytes: number): string {
  const gb = bytes / (1024 ** 3)
  return gb >= 1 ? `${gb.toFixed(0)}GB` : `${(bytes / (1024 ** 2)).toFixed(0)}MB`
}

export default function DiskCard() {
  const metrics = useAppStore((s) => s.metrics)
  const disks = metrics?.disks ?? []

  const mainDisk = disks.find(d => d.mount === 'C:') ?? disks[0]
  const usage = mainDisk?.usagePercent ?? 0
  const color = getColor(usage)

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
        <span style={styles.label}>디스크</span>
      </div>

      <div style={styles.value}>
        <span style={{ color }}>{usage}</span>
        <span style={styles.unit}>%</span>
      </div>

      <div style={styles.barBg}>
        <div style={{ ...styles.barFill, width: `${usage}%`, background: color }} />
      </div>

      <div style={styles.footer}>
        <span style={styles.meta}>{mainDisk?.mount ?? ''}</span>
        <span style={styles.meta}>{mainDisk ? `${fmt(mainDisk.used)} / ${fmt(mainDisk.size)}` : ''}</span>
      </div>

      {/* 추가 드라이브 */}
      {disks.length > 1 && (
        <div style={styles.extraDisks}>
          {disks.slice(1, 4).map(d => (
            <div key={d.mount} style={styles.extraDisk}>
              <span style={styles.extraLabel}>{d.mount}</span>
              <div style={styles.extraBarBg}>
                <div style={{
                  ...styles.extraBarFill,
                  width: `${d.usagePercent}%`,
                  background: getColor(d.usagePercent),
                }} />
              </div>
              <span style={styles.extraPct}>{d.usagePercent}%</span>
            </div>
          ))}
        </div>
      )}
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
  extraDisks: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginTop: 4,
    paddingTop: 8,
    borderTop: '1px solid #334155',
  },
  extraDisk: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  extraLabel: {
    fontSize: 11,
    color: '#64748b',
    width: 24,
    flexShrink: 0,
  },
  extraBarBg: {
    flex: 1,
    height: 3,
    background: '#0f172a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  extraBarFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.5s ease',
  },
  extraPct: {
    fontSize: 10,
    color: '#94a3b8',
    width: 28,
    textAlign: 'right' as const,
  },
}
