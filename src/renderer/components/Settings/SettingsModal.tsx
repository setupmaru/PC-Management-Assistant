import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import SubscriptionSection from './SubscriptionSection'

interface Props {
  onClose: () => void
  onLogout: () => void
}

export default function SettingsModal({ onClose, onLogout }: Props) {
  const { hasApiKey, maskedApiKey, setApiKeyStatus } = useAppStore()
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    window.api.loadApiKey().then((res) => {
      setApiKeyStatus(res.hasKey, res.maskedKey)
    })
  }, [setApiKeyStatus])

  const handleSave = async () => {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setMessage({ type: 'error', text: 'API 키를 입력해주세요.' })
      return
    }
    if (!trimmed.startsWith('sk-')) {
      setMessage({ type: 'error', text: 'OpenAI API 키는 "sk-"로 시작해야 합니다.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const res = await window.api.saveApiKey(trimmed)
      if (res.success) {
        setApiKeyStatus(true, `${trimmed.substring(0, 8)}${'*'.repeat(20)}`)
        setMessage({ type: 'success', text: 'API 키가 안전하게 저장되었습니다.' })
        setApiKey('')
        setTimeout(onClose, 1200)
      } else {
        setMessage({ type: 'error', text: res.error ?? '저장 실패' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: String(err) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    await window.api.saveApiKey('')
    setApiKeyStatus(false, null)
    setMessage({ type: 'success', text: 'API 키가 삭제되었습니다.' })
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
          <div style={styles.section}>
            <label style={styles.label}>OpenAI API 키</label>
            <p style={styles.desc}>
              OpenAI Console(platform.openai.com)에서 발급한 API 키를 입력하세요.
              키는 Windows DPAPI(safeStorage)로 암호화되어 로컬에만 저장됩니다.
            </p>

            {hasApiKey && (
              <div style={styles.currentKey}>
                <span style={styles.keyIcon}>KEY</span>
                <span style={styles.keyMasked}>{maskedApiKey}</span>
                <button style={styles.deleteBtn} onClick={handleDelete}>삭제</button>
              </div>
            )}

            <div style={styles.inputRow}>
              <input
                type="password"
                style={styles.input}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                autoFocus
              />
            </div>

            {message && (
              <div
                style={{
                  ...styles.message,
                  color: message.type === 'success' ? '#4ade80' : '#f87171',
                  background: message.type === 'success' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${message.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}
              >
                {message.text}
              </div>
            )}
          </div>

          <div style={styles.info}>
            <p>API 키는 로컬 기기에만 저장되며 외부로 직접 전송되지 않습니다.</p>
            <p>채팅 시 OpenAI API 요금이 발생할 수 있습니다.</p>
          </div>

          <div style={styles.divider} />

          <SubscriptionSection onLogout={onLogout} />
        </div>

        <div style={styles.modalFooter}>
          <button style={styles.cancelBtn} onClick={onClose}>취소</button>
          <button
            style={{ ...styles.saveBtn, opacity: saving ? 0.6 : 1 }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
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
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: '#cbd5e1',
  },
  desc: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 1.6,
  },
  currentKey: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#263249',
    border: '1px solid #334155',
    borderRadius: 8,
    padding: '8px 12px',
  },
  keyIcon: {
    fontSize: 11,
    color: '#cbd5e1',
    fontWeight: 700,
  },
  keyMasked: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#94a3b8',
  },
  deleteBtn: {
    background: 'none',
    border: '1px solid rgba(239,68,68,0.4)',
    color: '#f87171',
    fontSize: 11,
    padding: '3px 8px',
    borderRadius: 5,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
  },
  input: {
    flex: 1,
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 8,
    color: '#f1f5f9',
    fontSize: 13,
    padding: '10px 12px',
    outline: 'none',
    fontFamily: 'monospace',
  },
  message: {
    fontSize: 12,
    padding: '8px 12px',
    borderRadius: 7,
    lineHeight: 1.4,
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 11,
    color: '#475569',
    lineHeight: 1.6,
  },
  divider: {
    height: 1,
    background: '#334155',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '14px 20px',
    borderTop: '1px solid #334155',
  },
  cancelBtn: {
    background: 'none',
    border: '1px solid #334155',
    color: '#94a3b8',
    padding: '8px 18px',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  saveBtn: {
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
