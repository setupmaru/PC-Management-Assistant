import { useEffect, useRef, useState } from 'react'
import type { AccountSettings, ChatModel } from '../../../shared/account-settings'
import SubscriptionSection from './SubscriptionSection'

interface Props {
  accountId: string
  onClose: () => void
  onLogout: () => void
}

export default function SettingsModal(props: Props) {
  return <AccountSettingsModal key={props.accountId} {...props} />
}

function AccountSettingsModal({ onClose, onLogout }: Props) {
  const [settings, setSettings] = useState<AccountSettings | null>(null)
  const [selected, setSelected] = useState<ChatModel>('gpt-5.4-mini')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const active = useRef(false)
  useEffect(() => {
    let cancelled = false
    active.current = true
    window.api.accountSettings.get().then(result => {
      if (cancelled) return
      if (result.success) { setSettings(result.data); setSelected(result.data.chatModel) }
      else setError(result.error)
    }).catch(() => { if (!cancelled) setError('설정을 불러오지 못했습니다.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; active.current = false }
  }, [])
  async function saveModel() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const result = await window.api.accountSettings.update(selected)
      if (!active.current) return
      if (result.success) { setSettings(result.data); setSelected(result.data.chatModel); setSaved(true) }
      else setError(result.error)
    } catch { if (active.current) setError('설정을 저장하지 못했습니다.') }
    finally { if (active.current) setSaving(false) }
  }
  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <div style={styles.modalTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
            </svg>
            설정
          </div>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={styles.modalBody}>
          <SubscriptionSection onLogout={onLogout} />
          <section style={{ marginTop: 20, color: '#e2e8f0' }} aria-label="AI 모델 설정">
            <label htmlFor="chat-model">AI 채팅 모델</label>
            <p style={{ fontSize: 12, color: '#94a3b8' }}>계정에 저장되며 다음 채팅부터 적용됩니다. 채팅은 Plus 이상에서 이용할 수 있습니다.</p>
            {loading && <p role="status">설정을 불러오는 중…</p>}
            {settings && <>
              <select id="chat-model" value={selected} disabled={saving}
                style={{ width: '100%', padding: 10, background: '#0f172a', color: '#e2e8f0', borderRadius: 6 }}
                onChange={event => { setSelected(event.target.value as ChatModel); setSaved(false) }}>
                {settings.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
              <button style={{ ...styles.closeFooterBtn, marginTop: 10 }} disabled={saving || selected === settings.chatModel} onClick={saveModel}>모델 저장</button>
            </>}
            {saving && <p role="status">저장 중…</p>}
            {saved && <p role="status">저장되었습니다. 다음 채팅부터 적용됩니다.</p>}
            {error && <p role="alert" style={{ color: '#f87171' }}>{error}</p>}
          </section>
        </div>

        <div style={styles.modalFooter}>
          <button style={styles.closeFooterBtn} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 14,
    width: 460,
    maxWidth: '90vw',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #334155',
  },
  modalTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 15,
    fontWeight: 600,
    color: '#f1f5f9',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 16,
    cursor: 'pointer',
    padding: 4,
    fontFamily: 'inherit',
  },
  modalBody: {
    padding: '20px',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '14px 20px',
    borderTop: '1px solid #334155',
  },
  closeFooterBtn: {
    background: '#3b82f6',
    border: 'none',
    color: '#fff',
    padding: '8px 22px',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 600,
  },
}
