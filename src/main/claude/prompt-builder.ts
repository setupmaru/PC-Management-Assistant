import { FullSnapshot } from '../collectors'
import { WindowsUpdateResult } from '../collectors/windows-update-collector'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function buildWindowsUpdateSection(wu: WindowsUpdateResult): string {
  if (wu.isChecking) return '  현재 확인 중...'
  if (wu.count === -1) return `  확인 실패${wu.error ? `: ${wu.error}` : ''}`
  if (wu.count === 0) return '  최신 상태 (대기 중인 업데이트 없음)'

  const lines: string[] = [`  대기 중인 업데이트: ${wu.count}개`]
  const severityMap: Record<string, number> = {}
  for (const u of wu.updates) {
    severityMap[u.Severity] = (severityMap[u.Severity] ?? 0) + 1
  }
  const severitySummary = Object.entries(severityMap)
    .map(([s, n]) => `${s} ${n}개`)
    .join(', ')
  lines.push(`  심각도: ${severitySummary}`)
  const top5 = wu.updates.slice(0, 5)
  for (const u of top5) {
    lines.push(`  - [${u.Severity}] ${u.Title}`)
  }
  if (wu.updates.length > 5) {
    lines.push(`  ... 외 ${wu.updates.length - 5}개`)
  }
  return lines.join('\n')
}

export function buildSystemPrompt(snapshot: FullSnapshot): string {
  const { metrics, processes, events, windowsUpdate } = snapshot
  const { cpu, memory, disks, network } = metrics

  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

  // CPU 섹션
  const cpuSection = [
    `  전체 사용률: ${cpu.usage}%`,
    `  코어 수: ${cpu.cores}`,
    `  클럭: ${cpu.speed} GHz`,
    cpu.temperature ? `  온도: ${cpu.temperature}°C` : null,
  ].filter(Boolean).join('\n')

  // 메모리 섹션
  const memSection = [
    `  전체: ${formatBytes(memory.total)}`,
    `  사용: ${formatBytes(memory.used)} (${memory.usagePercent}%)`,
    `  여유: ${formatBytes(memory.free)}`,
  ].join('\n')

  // 디스크 섹션
  const diskSection = disks.length > 0
    ? disks.map(d => `  ${d.mount} (${d.fs}): ${formatBytes(d.used)} / ${formatBytes(d.size)} (${d.usagePercent}%)`).join('\n')
    : '  정보 없음'

  // 네트워크 섹션
  const netSection = network.length > 0
    ? network.map(n => `  ${n.iface}: ↓${formatBytes(n.rxSec)}/s ↑${formatBytes(n.txSec)}/s`).join('\n')
    : '  연결된 네트워크 없음'

  // 프로세스 TOP 10
  const procSection = processes.length > 0
    ? processes.slice(0, 10).map((p, i) =>
        `  ${i + 1}. ${p.name} (PID:${p.pid}) CPU:${p.cpu}% MEM:${p.mem}% (${formatBytes(p.memRss)})`
      ).join('\n')
    : '  정보 없음'

  // 이벤트 로그
  let eventSection = ''
  if (events.error) {
    eventSection = `  [오류] ${events.error}`
  } else if (events.events.length === 0) {
    eventSection = '  최근 24시간 내 경고/오류 이벤트 없음'
  } else {
    const critical = events.events.filter(e => e.LevelDisplayName === 'Critical' || e.LevelDisplayName === '중요')
    const errors = events.events.filter(e => e.LevelDisplayName === 'Error' || e.LevelDisplayName === '오류')
    const warnings = events.events.filter(e => e.LevelDisplayName === 'Warning' || e.LevelDisplayName === '경고')

    const lines: string[] = []
    if (critical.length > 0) lines.push(`  [중요] ${critical.length}건`)
    if (errors.length > 0) lines.push(`  [오류] ${errors.length}건`)
    if (warnings.length > 0) lines.push(`  [경고] ${warnings.length}건`)

    // 최근 5개 이벤트 상세
    const recent = events.events.slice(0, 5)
    lines.push('\n  최근 이벤트:')
    for (const ev of recent) {
      const time = new Date(ev.TimeCreated).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
      const msg = (ev.Message || '').substring(0, 100)
      lines.push(`  - [${ev.LevelDisplayName}] ${time} | ${ev.ProviderName} (ID:${ev.Id}): ${msg}`)
    }
    eventSection = lines.join('\n')
  }

  const securityNote = events.hasSecurityLog
    ? '  보안 로그: 접근 가능'
    : '  보안 로그: 관리자 권한 없음 (접근 불가)'

  return `당신은 Windows PC 관리 전문가 AI 어시스턴트입니다.
사용자의 PC 상태를 실시간으로 모니터링하고, 문제 진단 및 최적화 방안을 한국어로 안내합니다.
전문적이지만 이해하기 쉬운 설명을 제공하세요.

현재 시각: ${now}

=== 현재 시스템 상태 (수집 시각: ${now}) ===

[CPU]
${cpuSection}

[메모리]
${memSection}

[디스크]
${diskSection}

[네트워크]
${netSection}

[실행 중인 주요 프로세스 (CPU 순)]
${procSection}

[Windows 이벤트 로그 (최근 24시간)]
${eventSection}
${securityNote}

[Windows Update]
${buildWindowsUpdateSection(windowsUpdate)}

=== 지침 ===
- 위 데이터를 기반으로 사용자 질문에 답변하세요.
- 답변 시 현재 시각(${now})을 함께 표시하세요. 예: "**[${now}]** 기준으로..."
- 이상 징후가 있으면 먼저 언급하세요 (예: CPU 90% 이상, 디스크 95% 이상, 중요 이벤트 등).
- 구체적인 해결책을 단계별로 제시하세요.
- 마크다운 형식을 사용하여 가독성을 높이세요.`
}
