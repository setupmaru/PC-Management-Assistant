import { useEffect, useMemo, useState } from 'react'
import { BootOptimizationSnapshot, StartupItem, StartupItemType } from '../../../shared/diagnostics'

type ItemFilter = 'measured' | 'all' | 'startup' | 'task' | 'service'

const IMPACT_COLOR: Record<StartupItem['impact'], string> = {
  high: '#f97316',
  medium: '#f59e0b',
  low: '#3b82f6',
  unknown: '#64748b',
}

const TYPE_LABEL: Record<StartupItemType, string> = {
  registry: '시작프로그램',
  startup: '시작프로그램',
  task: '예약작업',
  service: '서비스',
}

export default function BootOptimizationCard() {
  const [snapshot, setSnapshot] = useState<BootOptimizationSnapshot | null>(null)
  const [showDetail, setShowDetail] = useState(false)

  useEffect(() => {
    window.api.diagnostics.getBootOptimization().then((result) => {
      if (result.success && result.data) setSnapshot(result.data)
    }).catch(() => {})
    const unsubscribe = window.api.diagnostics.onBootUpdate(setSnapshot)
    return () => { unsubscribe() }
  }, [])

  const latest = snapshot?.latestBoot
  const measured = snapshot?.startupItems.filter((item) => item.measuredDelaySeconds != null) ?? []
  const top = measured.slice(0, 2)
  const avoidableDelay = measured
    .filter((item) => item.manageable)
    .reduce((sum, item) => sum + (item.measuredDelaySeconds ?? 0), 0)

  return (
    <>
      <section className="diag-card boot-card">
        <div className="diag-card-header">
          <span className="diag-card-title">부팅 최적화</span>
          <button className="diag-outline-button" onClick={() => setShowDetail(true)}>상세 · 관리</button>
        </div>
        <div className="boot-summary-row">
          <div><strong>{latest ? `${latest.totalSeconds.toFixed(1)}초` : '-'}</strong><span>최근 부팅</span></div>
          <div className="boot-compare">
            <span>평소 <b>{snapshot?.averageBootSeconds?.toFixed(1) ?? '-'}초</b></span>
            <span>변화 <b style={{ color: (snapshot?.improvementSeconds ?? 0) >= 0 ? '#22c55e' : '#f97316' }}>{snapshot?.improvementSeconds == null ? '-' : `${snapshot.improvementSeconds >= 0 ? '-' : '+'}${Math.abs(snapshot.improvementSeconds).toFixed(1)}초`}</b></span>
          </div>
        </div>
        {avoidableDelay > 0 && (
          <div className="avoidable-delay">끌 수 있는 항목의 실측 지연 합계 <strong>{avoidableDelay.toFixed(1)}초</strong></div>
        )}
        <div className="boot-top-items">
          {top.length === 0 ? <span className="diag-empty-line">Windows 부팅 실측 기록을 분석하고 있습니다.</span> : top.map((item) => (
            <div key={item.id}>
              <i style={{ background: IMPACT_COLOR[item.impact] }} />
              <strong>{item.name}</strong>
              <span>{item.measuredDelaySeconds?.toFixed(2)}초</span>
            </div>
          ))}
        </div>
        <div className="diag-card-footer"><span>실측 항목 {measured.length}개 · 전체 {snapshot?.startupItems.length ?? 0}개</span></div>
      </section>

      {showDetail && <BootDetailModal snapshot={snapshot} onUpdate={setSnapshot} onClose={() => setShowDetail(false)} />}
    </>
  )
}

function BootDetailModal({
  snapshot,
  onUpdate,
  onClose,
}: {
  snapshot: BootOptimizationSnapshot | null
  onUpdate: (snapshot: BootOptimizationSnapshot) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<ItemFilter>('measured')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const items = useMemo(() => (snapshot?.startupItems ?? []).filter((item) => {
    if (filter === 'measured') return item.measuredDelaySeconds != null
    if (filter === 'startup') return item.type === 'registry' || item.type === 'startup'
    if (filter === 'all') return true
    return item.type === filter
  }), [filter, snapshot])

  const activeChanges = snapshot?.changes.filter((change) => change.restoredAt == null) ?? []
  const history = snapshot?.bootHistory ?? []
  const maxBoot = Math.max(1, ...history.map((item) => item.totalSeconds))

  const run = async (task: () => Promise<{ success: boolean; data?: BootOptimizationSnapshot | null; error?: string; message?: string }>) => {
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

  const disable = (item: StartupItem) => {
    const restoreNotice = snapshot?.restorePointAutoCreate
      ? '변경 전에 시스템 복원 지점을 만들며, 실패하면 항목을 변경하지 않습니다.'
      : '자동 복원 지점이 꺼져 있습니다.'
    if (window.confirm(`${item.name}의 자동 시작을 끌까요?\n\n${restoreNotice}`)) {
      run(() => window.api.diagnostics.disableStartupItem(item.id))
    }
  }

  const stat = snapshot?.latestBoot

  return (
    <div className="diag-modal-backdrop" onMouseDown={onClose}>
      <div className="diag-modal diag-modal-wide" onMouseDown={(event) => event.stopPropagation()}>
        <header className="diag-modal-header">
          <strong>부팅 최적화 · 실측 기반</strong>
          <button onClick={onClose} aria-label="닫기">×</button>
        </header>
        <div className="diag-modal-scroll">
          <section className="boot-stat-grid">
            <div><span>최근 부팅</span><strong>{stat ? `${stat.totalSeconds.toFixed(1)}초` : '-'}</strong></div>
            <div><span>로그인까지</span><strong>{stat ? `${stat.loginSeconds.toFixed(1)}초` : '-'}</strong></div>
            <div><span>로그인 이후</span><strong>{stat ? `${stat.postLoginSeconds.toFixed(1)}초` : '-'}</strong></div>
            <div><span>평소(평균)</span><strong>{snapshot?.averageBootSeconds == null ? '-' : `${snapshot.averageBootSeconds.toFixed(1)}초`}</strong></div>
          </section>

          <section className="boot-history-chart">
            {history.length === 0 ? <p className="diag-empty">Windows 부팅 성능 이벤트 기록이 없습니다.</p> : [...history].reverse().map((entry, index) => (
              <div key={entry.timestamp} title={`${new Date(entry.timestamp).toLocaleString('ko-KR')} · ${entry.totalSeconds.toFixed(1)}초`}>
                <i style={{ height: `${Math.max(8, (entry.totalSeconds / maxBoot) * 100)}%`, background: index % 3 === 0 ? '#f59e0b' : '#3b82f6' }} />
              </div>
            ))}
            <span className="chart-old">오래된 부팅</span><span className="chart-new">최근</span>
          </section>

          <section className="diag-modal-section">
            <h3>안전장치</h3>
            <div className="safety-grid">
              <div><span>복원 지점</span><strong>{snapshot?.restorePointAutoCreate ? '자동 생성 켜짐' : '자동 생성 꺼짐'}</strong></div>
              <div><span>되돌리기</span><strong>{activeChanges.length > 0 ? `${activeChanges.length}개 가능` : '변경 없음'}</strong></div>
              <div><span>적용 방식</span><strong>삭제 없이 비활성화</strong></div>
            </div>
            <label className="diag-check-line">
              <input
                type="checkbox"
                checked={snapshot?.restorePointAutoCreate ?? true}
                onChange={(event) => run(() => window.api.diagnostics.setRestorePointAutoCreate(event.target.checked))}
              />
              끄기 전 복원 지점 자동 생성 (관리자 권한 확인 창이 한 번 뜹니다)
            </label>
            <div className="diag-inline-controls">
              <button className="diag-muted-button" disabled={busy} onClick={() => run(() => window.api.diagnostics.createRestorePoint())}>지금 복원 지점 만들기</button>
              <button className="diag-warning-button" disabled={busy || activeChanges.length === 0} onClick={() => {
                if (window.confirm(`${activeChanges.length}개의 변경을 모두 되돌릴까요?`)) run(() => window.api.diagnostics.restoreAllStartupChanges())
              }}>전부 되돌리기 ({activeChanges.length})</button>
            </div>
            <p className="diag-help">끈 항목은 삭제되지 않습니다. 시작프로그램은 비활성화하고, 서비스는 자동 시작만 수동으로 바꿉니다. Windows 핵심 항목은 변경할 수 없습니다.</p>
          </section>

          <section className="diag-modal-section">
            <div className="diag-section-title-row"><h3>항목 ({items.length})</h3><button className="text-button" disabled={busy} onClick={() => run(() => window.api.diagnostics.refreshBootOptimization())}>새로 고침</button></div>
            <div className="filter-tabs">
              {([['measured', '실측 항목'], ['all', '전체'], ['startup', '시작프로그램'], ['task', '예약작업'], ['service', '서비스']] as Array<[ItemFilter, string]>).map(([key, label]) => (
                <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
            <div className="startup-item-list">
              {items.length === 0 ? <p className="diag-empty">이 범주에 표시할 항목이 없습니다.</p> : items.map((item) => (
                <article key={item.id}>
                  <div className="startup-item-main">
                    <i style={{ background: IMPACT_COLOR[item.impact] }} />
                    <div>
                      <strong>{item.name}</strong>
                      {item.requiresAdmin && <em>관리자</em>}
                      <p>{TYPE_LABEL[item.type]} · {item.publisher || item.command || item.location}</p>
                    </div>
                    <button
                      className="diag-danger-button"
                      disabled={busy || !item.enabled || !item.manageable}
                      title={!item.manageable ? 'Windows 핵심 항목은 변경할 수 없습니다.' : undefined}
                      onClick={() => disable(item)}
                    >{item.enabled ? '끄기' : '꺼짐'}</button>
                  </div>
                  {item.measuredDelaySeconds != null && (
                    <p className="startup-delay">부팅 지연 <strong>{item.measuredDelaySeconds.toFixed(2)}초</strong> · 평균 {item.averageDelaySeconds?.toFixed(2)}초 ({item.measuredCount}회)</p>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="diag-modal-section">
            <h3>변경 기록</h3>
            {(snapshot?.changes.length ?? 0) === 0 ? <p className="diag-empty">아직 변경한 항목이 없습니다.</p> : (
              <div className="change-list">
                {snapshot?.changes.slice().reverse().map((change) => (
                  <div key={change.id}>
                    <span><strong>{change.itemName}</strong><small>{new Date(change.changedAt).toLocaleString('ko-KR')} · 자동 시작 끄기</small></span>
                    {change.restoredAt ? <em>되돌림 완료</em> : <button className="diag-outline-button" disabled={busy} onClick={() => run(() => window.api.diagnostics.restoreStartupChange(change.id))}>되돌리기</button>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <button className="diag-muted-button" disabled={busy} onClick={() => run(() => window.api.diagnostics.saveBootReport())}>리포트 저장</button>
          {busy && <p className="diag-help">Windows 정보를 처리하고 있습니다. 잠시 기다려주세요.</p>}
          {error && <p className="diag-error">{error}</p>}
          {notice && <p className="diag-success">{notice}</p>}
        </div>
      </div>
    </div>
  )
}
