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
  if (wu.isChecking) return '  현재 확인 중입니다.'
  if (wu.count === -1) return `  확인 실패${wu.error ? `: ${wu.error}` : ''}`
  if (wu.count === 0) return '  최신 상태입니다. 대기 중인 업데이트가 없습니다.'

  const lines: string[] = [`  대기 중인 업데이트: ${wu.count}개`]
  const severityMap: Record<string, number> = {}

  for (const update of wu.updates) {
    severityMap[update.Severity] = (severityMap[update.Severity] ?? 0) + 1
  }

  const severitySummary = Object.entries(severityMap)
    .map(([severity, count]) => `${severity} ${count}개`)
    .join(', ')

  lines.push(`  심각도: ${severitySummary}`)

  for (const update of wu.updates.slice(0, 5)) {
    lines.push(`  - [${update.Severity}] ${update.Title}`)
  }

  if (wu.updates.length > 5) {
    lines.push(`  ... 외 ${wu.updates.length - 5}개`)
  }

  return lines.join('\n')
}

function buildCpuSection(snapshot: FullSnapshot): string {
  const { cpu } = snapshot.metrics
  const hasHybridCores = (cpu.performanceCores ?? 0) > 0 && (cpu.efficiencyCores ?? 0) > 0
  const coreLine = hasHybridCores
    ? `  코어 수: 총 ${cpu.cores}코어 (P ${cpu.performanceCores ?? 0} / E ${cpu.efficiencyCores ?? 0})`
    : `  코어 수: ${cpu.cores}`

  return [
    `  전체 사용률: ${cpu.usage}%`,
    coreLine,
    `  클럭: ${cpu.speed} GHz`,
    cpu.temperature ? `  온도: ${cpu.temperature}°C` : null,
  ].filter(Boolean).join('\n')
}

export function buildSystemPrompt(snapshot: FullSnapshot): string {
  const { metrics, processes, events, windowsUpdate } = snapshot
  const { memory, disks, network } = metrics
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

  const memSection = [
    `  전체: ${formatBytes(memory.total)}`,
    `  사용: ${formatBytes(memory.used)} (${memory.usagePercent}%)`,
    `  여유: ${formatBytes(memory.free)}`,
  ].join('\n')

  const diskSection = disks.length > 0
    ? disks.map((disk) => `  ${disk.mount} (${disk.fs}): ${formatBytes(disk.used)} / ${formatBytes(disk.size)} (${disk.usagePercent}%)`).join('\n')
    : '  정보 없음'

  const netSection = network.length > 0
    ? network.map((item) => `  ${item.iface}: ↓ ${formatBytes(item.rxSec)}/s ↑ ${formatBytes(item.txSec)}/s`).join('\n')
    : '  연결된 네트워크 없음'

  const procSection = processes.length > 0
    ? processes.slice(0, 10).map((process, index) =>
        `  ${index + 1}. ${process.name} (PID:${process.pid}) CPU:${process.cpu}% MEM:${process.mem}% (${formatBytes(process.memRss)})`
      ).join('\n')
    : '  정보 없음'

  let eventSection = ''
  if (events.error) {
    eventSection = `  [오류] ${events.error}`
  } else if (events.events.length === 0) {
    eventSection = '  최근 24시간 내 경고/오류 이벤트가 없습니다.'
  } else {
    const critical = events.events.filter((event) => event.LevelDisplayName === 'Critical' || event.LevelDisplayName === '중요')
    const errors = events.events.filter((event) => event.LevelDisplayName === 'Error' || event.LevelDisplayName === '오류')
    const warnings = events.events.filter((event) => event.LevelDisplayName === 'Warning' || event.LevelDisplayName === '경고')

    const lines: string[] = []
    if (critical.length > 0) lines.push(`  [중요] ${critical.length}건`)
    if (errors.length > 0) lines.push(`  [오류] ${errors.length}건`)
    if (warnings.length > 0) lines.push(`  [경고] ${warnings.length}건`)

    lines.push('\n  최근 이벤트')
    for (const event of events.events.slice(0, 5)) {
      const time = new Date(event.TimeCreated).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
      const message = (event.Message || '').substring(0, 100)
      lines.push(`  - [${event.LevelDisplayName}] ${time} | ${event.ProviderName} (ID:${event.Id}): ${message}`)
    }

    eventSection = lines.join('\n')
  }

  const securityNote = events.hasSecurityLog
    ? '  보안 로그: 접근 가능'
    : '  보안 로그: 관리자 권한 없음 (접근 불가)'

  return `당신은 Windows PC 관리 전문 AI 어시스턴트입니다.
사용자의 PC 상태를 실시간으로 모니터링하고, 문제 진단과 최적화 방안을 이해하기 쉽게 안내하세요.

현재 시각: ${now}

=== 현재 시스템 상태 (수집 시각: ${now}) ===

[CPU]
${buildCpuSection(snapshot)}

[메모리]
${memSection}

[디스크]
${diskSection}

[네트워크]
${netSection}

[실행 중인 주요 프로세스 (CPU 기준)]
${procSection}

[Windows 이벤트 로그 (최근 24시간)]
${eventSection}
${securityNote}

[Windows Update]
${buildWindowsUpdateSection(windowsUpdate)}

=== 지침 ===
- 위 데이터를 기반으로 사용자의 질문에 답변하세요.
- 답변에는 현재 시각(${now})을 명확히 표시하세요. 예: "**[${now}] 기준**"
- 이상 징후가 있으면 먼저 강조하세요. 예: CPU 90% 이상, 디스크 95% 이상, 중요 이벤트 다수.
- 해결책은 구체적인 단계별 조치로 제시하세요.
- Markdown 형식을 사용해 가독성을 높이세요.`
}
