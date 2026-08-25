import { useEffect, useMemo, useState } from 'react'
import { DiagnosticState, NetworkHealthSnapshot, NetworkMonitorSettings } from '../../../shared/diagnostics'
import { useAppStore } from '../../store/appStore'

const STATE_COLOR: Record<DiagnosticState, string> = {
  healthy: '#22c55e',
  degraded: '#f59e0b',
  offline: '#ef4444',
  unknown: '#64748b',
}

const STATE_LABEL: Record<DiagnosticState, string> = {
  healthy: '정상',
  degraded: '불안정',
  offline: '장애',
  unknown: '확인 중',
}

const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

function compactTimeline(snapshot: NetworkHealthSnapshot): Array<{ state: DiagnosticState; title: string }> {
  const samples = snapshot.samples24h
  if (samples.length === 0) return [{ state: snapshot.overallStatus, title: snapshot.summary }]
  const maxBars = 120
  const size = Math.max(1, Math.ceil(samples.length / maxBars))
  const result: Array<{ state: DiagnosticState; title: string }> = []
  for (let index = 0; index < samples.length; index += size) {
    const bucket = samples.slice(index, index + size)
    const state = bucket.some((sample) => sample.status === 'offline')
      ? 'offline'
      : bucket.some((sample) => sample.status === 'degraded')
        ? 'degraded'
        : bucket.some((sample) => sample.status === 'healthy') ? 'healthy' : 'unknown'
    result.push({
      state,
      title: new Date(bucket[0].timestamp).toLocaleString('ko-KR'),
    })
  }
  return result
}

export default function NetworkHealthCard() {
  const [snapshot, setSnapshot] = useState<NetworkHealthSnapshot | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  useEffect(() => {
    window.api.diagnostics.getNetworkHealth().then((result) => {
      if (result.success && result.data) setSnapshot(result.data)
    }).catch(() => {})
    const unsubscribe = window.api.diagnostics.onNetworkUpdate(setSnapshot)
    return () => { unsubscribe() }
  }, [])

  const stages = snapshot?.stages ?? []
  const chart = snapshot?.samples24h.slice(-36) ?? []
  const maxLatency = Math.max(1, ...chart.map((sample) => sample.latencyMs ?? 0))

  return (
    <>
      <section className="diag-card network-health-card">
        <div className="diag-card-header">
          <span className="diag-card-title">네트워크 감시</span>
          <span className="diag-status-pill" style={{ color: STATE_COLOR[snapshot?.overallStatus ?? 'unknown'] }}>
            <i style={{ background: STATE_COLOR[snapshot?.overallStatus ?? 'unknown'] }} />
            {STATE_LABEL[snapshot?.overallStatus ?? 'unknown']}
          </span>
        </div>

        <div className="network-stage-strip">
          {(stages.length > 0 ? stages : (['공유기', 'ISP 구간', 'DNS', '인터넷'].map((label) => ({ label, status: 'unknown' as const })))).map((stage, index) => (
            <div className="network-stage" key={stage.label}>
              <i style={{ background: STATE_COLOR[stage.status] }} />
              <span>{stage.label}</span>
              {index < 3 && <b />}
            </div>
          ))}
        </div>

        <div className="network-mini-chart" aria-label="최근 네트워크 지연 그래프">
          {chart.length === 0 ? <span className="diag-empty-line">측정 기록을 수집하고 있습니다.</span> : chart.map((sample) => (
            <i
              key={sample.timestamp}
              style={{
                height: `${Math.max(3, ((sample.latencyMs ?? maxLatency) / maxLatency) * 100)}%`,
                background: STATE_COLOR[sample.status],
              }}
              title={`${new Date(sample.timestamp).toLocaleTimeString('ko-KR')} · ${sample.latencyMs ?? '-'}ms`}
            />
          ))}
        </div>

        <div className="network-stat-grid">
          <div><span>가동률</span><strong>{snapshot ? `${snapshot.availabilityPercent.toFixed(snapshot.availabilityPercent === 100 ? 0 : 1)}%` : '-'}</strong></div>
          <div><span>손실</span><strong>{snapshot ? `${snapshot.lossPercent.toFixed(snapshot.lossPercent === 0 ? 0 : 1)}%` : '-'}</strong></div>
          <div><span>지연</span><strong>{snapshot?.averageLatencyMs == null ? '-' : `${snapshot.averageLatencyMs.toFixed(0)}ms`}</strong></div>
          <div><span>24h 장애</span><strong>{snapshot ? `${snapshot.outageCount24h}건` : '-'}</strong></div>
        </div>

        <div className="diag-card-footer">
          <span title={snapshot?.routeSummary}>{snapshot?.stages.find((stage) => stage.key === 'gateway')?.target ? `공유기 ${snapshot.stages.find((stage) => stage.key === 'gateway')?.target}` : '경로 확인 중'}</span>
          <button className="diag-outline-button" onClick={() => setShowDetail(true)}>상세 · 리포트</button>
        </div>
      </section>

      {showDetail && (
        <NetworkDetailModal
          snapshot={snapshot}
          onClose={() => setShowDetail(false)}
          onUpdate={setSnapshot}
        />
      )}
    </>
  )
}

function NetworkDetailModal({
  snapshot,
  onClose,
  onUpdate,
}: {
  snapshot: NetworkHealthSnapshot | null
  onClose: () => void
  onUpdate: (snapshot: NetworkHealthSnapshot) => void
}) {
  const currentUser = useAppStore((state) => state.currentUser)
  const [settings, setSettings] = useState<NetworkMonitorSettings>(snapshot?.settings ?? {
    enabled: true,
    intervalSeconds: 15,
    externalTarget: '1.1.1.1',
    retentionDays: 30,
    autoWeeklyReport: false,
    reportWeekday: 1,
  })
  const [rangeDays, setRangeDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const timeline = useMemo(() => snapshot ? compactTimeline(snapshot) : [], [snapshot])

  useEffect(() => {
    if (snapshot) setSettings(snapshot.settings)
  }, [snapshot])

  const run = async (task: () => Promise<{ success: boolean; data?: NetworkHealthSnapshot | null; error?: string; message?: string }>) => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await task()
      if (!result.success) setError(result.error ?? '작업을 완료하지 못했습니다.')
      else {
        if (result.data) onUpdate(result.data)
        if (result.message) setNotice(result.message)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = () => run(() => window.api.diagnostics.updateNetworkSettings(settings))
  const status = snapshot?.overallStatus ?? 'unknown'

  return (
    <div className="diag-modal-backdrop" onMouseDown={onClose}>
      <div className="diag-modal diag-modal-wide" onMouseDown={(event) => event.stopPropagation()}>
        <header className="diag-modal-header">
          <strong>네트워크 상세 감시</strong>
          <button onClick={onClose} aria-label="닫기">×</button>
        </header>
        <div className="diag-modal-scroll">
          <section className="diag-summary-banner" style={{ borderColor: `${STATE_COLOR[status]}66`, background: `${STATE_COLOR[status]}12` }}>
            <strong style={{ color: STATE_COLOR[status] }}>{STATE_LABEL[status]}</strong>
            <small>{snapshot ? `${new Date(snapshot.checkedAt).toLocaleTimeString('ko-KR')} 측정 기준` : '측정 준비 중'}</small>
            <p>{snapshot?.summary ?? '네트워크 상태를 측정하고 있습니다.'}</p>
          </section>

          <section className="diag-modal-section">
            <h3>구간별 상태</h3>
            <div className="network-stage-table">
              <div className="table-head"><span>구간</span><span>대상</span><span>응답</span><span>지연</span></div>
              {(snapshot?.stages ?? []).map((stage) => (
                <div key={stage.key}>
                  <strong>{stage.label}</strong>
                  <span>{stage.target ?? '-'}</span>
                  <span>{stage.successes}/{stage.attempts}</span>
                  <span>{stage.latencyMs == null ? '-' : `${stage.latencyMs}ms`}</span>
                </div>
              ))}
            </div>
            <p className="diag-help">중간 홉은 외부 도달이 정상일 때 응답을 생략할 수 있으며, 외부 도달까지 실패했을 때만 ISP 구간을 장애 원인으로 판단합니다.</p>
          </section>

          <section className="diag-modal-section">
            <h3>최근 24시간</h3>
            <div className="network-timeline">
              {timeline.map((item, index) => <i key={`${item.title}-${index}`} style={{ background: STATE_COLOR[item.state] }} title={item.title} />)}
            </div>
            <div className="timeline-labels"><span>24시간 전</span><span>12시간 전</span><span>지금</span></div>
            <p className="diag-metrics-line">
              가동률 <strong>{snapshot?.availabilityPercent.toFixed(2) ?? '-'}%</strong>
              손실 <strong>{snapshot?.lossPercent.toFixed(1) ?? '-'}%</strong>
              지연 <strong>{snapshot?.averageLatencyMs?.toFixed(0) ?? '-'}ms</strong>
              <span>(p95 {snapshot?.p95LatencyMs?.toFixed(0) ?? '-'}ms)</span>
            </p>
          </section>

          <section className="diag-modal-section">
            <h3>장애 내역 (최근 7일)</h3>
            {(snapshot?.outages7d.length ?? 0) === 0 ? <p className="diag-empty">기록된 장애가 없습니다.</p> : (
              <div className="outage-list">
                {snapshot?.outages7d.slice(-20).reverse().map((outage) => (
                  <div key={outage.startedAt}>
                    <strong>{new Date(outage.startedAt).toLocaleString('ko-KR')}</strong>
                    <span>{outage.endedAt ? `${Math.max(1, Math.round((outage.durationMs ?? 0) / 1000))}초` : '진행 중'}</span>
                    <p>{outage.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="diag-modal-section">
            <h3>증거 리포트</h3>
            <p className="diag-help">측정 기록을 Markdown 문서로 저장합니다. 통신사에 문의할 때 언제, 어느 구간이, 얼마나 불안정했는지 제시할 수 있습니다.</p>
            <div className="diag-inline-controls">
              <select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}>
                <option value={1}>최근 24시간</option><option value={7}>최근 7일</option><option value={30}>최근 30일</option>
              </select>
              <button className="diag-primary-button" disabled={busy} onClick={() => run(() => window.api.diagnostics.saveNetworkReport(rangeDays))}>리포트 저장</button>
            </div>
          </section>

          <section className="diag-modal-section">
            <h3>감시 설정</h3>
            <label className="diag-setting-row"><span>상시 감시</span><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} /></label>
            <label className="diag-setting-row"><span>측정 주기</span><select value={settings.intervalSeconds} onChange={(event) => setSettings({ ...settings, intervalSeconds: Number(event.target.value) as NetworkMonitorSettings['intervalSeconds'] })}><option value={15}>15초</option><option value={30}>30초</option><option value={60}>1분</option><option value={300}>5분</option></select></label>
            <label className="diag-setting-row"><span>외부 측정 대상</span><span className="diag-setting-input"><input value={settings.externalTarget} onChange={(event) => setSettings({ ...settings, externalTarget: event.target.value })} /><button className="diag-outline-button" disabled={busy} onClick={saveSettings}>적용</button></span></label>
            <label className="diag-setting-row"><span>기록 보관</span><select value={settings.retentionDays} onChange={(event) => setSettings({ ...settings, retentionDays: Number(event.target.value) as NetworkMonitorSettings['retentionDays'] })}><option value={7}>7일</option><option value={30}>30일</option><option value={90}>90일</option></select></label>
            <div className="diag-inline-controls">
              <button className="diag-muted-button" disabled={busy} onClick={() => run(() => window.api.diagnostics.measureNetworkNow())}>지금 다시 측정</button>
              <button className="diag-danger-button" disabled={busy} onClick={() => {
                if (window.confirm('저장된 네트워크 측정 기록과 장애 내역을 모두 삭제할까요?')) run(() => window.api.diagnostics.clearNetworkHistory())
              }}>기록 전체 삭제</button>
              <button className="diag-primary-button" disabled={busy} onClick={saveSettings}>설정 저장</button>
            </div>
          </section>

          <section className="diag-modal-section">
            <h3>자동 주간 리포트 <em className="pro-label">PRO</em></h3>
            <p className="diag-help">네트워크 7일 기록과 부팅 상태를 매주 Markdown 리포트로 저장합니다.</p>
            <label className="diag-setting-row"><span>자동 생성</span><input type="checkbox" disabled={currentUser?.plan !== 'pro'} checked={settings.autoWeeklyReport} onChange={(event) => setSettings({ ...settings, autoWeeklyReport: event.target.checked })} /></label>
            <label className="diag-setting-row"><span>생성 요일</span><select value={settings.reportWeekday} disabled={currentUser?.plan !== 'pro'} onChange={(event) => setSettings({ ...settings, reportWeekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
            <button className="diag-primary-button" disabled={busy || currentUser?.plan !== 'pro'} onClick={saveSettings}>자동 리포트 설정 저장</button>
          </section>

          {snapshot?.routeSummary && <p className="diag-route">경로 · {snapshot.routeSummary}</p>}
          {error && <p className="diag-error">{error}</p>}
          {notice && <p className="diag-success">저장 완료: {notice}</p>}
        </div>
      </div>
    </div>
  )
}
