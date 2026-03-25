import { useAppStore } from '../../store/appStore'

function fmtMem(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)}G` : `${mb.toFixed(0)}M`
}

function getCpuColor(cpu: number): string {
  if (cpu >= 50) return '#ef4444'
  if (cpu >= 20) return '#f97316'
  if (cpu >= 10) return '#eab308'
  return '#94a3b8'
}

export default function ProcessTable() {
  const processes = useAppStore((s) => s.processes)

  return (
    <div style={styles.wrapper}>
      <div style={styles.tableHeader}>
        <span style={{ flex: 1 }}>프로세스</span>
        <span style={styles.colNum}>CPU</span>
        <span style={styles.colNum}>MEM</span>
        <span style={styles.colNum}>RSS</span>
      </div>
      <div style={styles.tableBody}>
        {processes.length === 0 ? (
          <div style={styles.empty}>프로세스 정보 로딩 중...</div>
        ) : (
          processes.slice(0, 8).map((p) => (
            <div key={p.pid} style={styles.row}>
              <span style={styles.name} title={`${p.name} (PID: ${p.pid})`}>
                {p.name}
              </span>
              <span style={{ ...styles.colNum, color: getCpuColor(p.cpu) }}>
                {p.cpu.toFixed(1)}%
              </span>
              <span style={styles.colNum}>{p.mem.toFixed(1)}%</span>
              <span style={styles.colNum}>{fmtMem(p.memRss)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '7px 12px',
    background: '#263249',
    fontSize: 10,
    fontWeight: 700,
    color: '#64748b',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    borderBottom: '1px solid #334155',
  },
  tableBody: {
    maxHeight: 200,
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    borderBottom: '1px solid #1e293b',
    fontSize: 12,
    transition: 'background 0.1s',
  },
  name: {
    flex: 1,
    color: '#cbd5e1',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  colNum: {
    width: 52,
    textAlign: 'right' as const,
    color: '#94a3b8',
    fontFamily: 'monospace',
    fontSize: 11,
    flexShrink: 0,
  },
  empty: {
    padding: '16px 12px',
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center' as const,
  },
}
