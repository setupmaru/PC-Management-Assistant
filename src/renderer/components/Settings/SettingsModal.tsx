import SubscriptionSection from './SubscriptionSection'

interface Props {
  onClose: () => void
  onLogout: () => void
}

export default function SettingsModal({ onClose, onLogout }: Props) {
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
