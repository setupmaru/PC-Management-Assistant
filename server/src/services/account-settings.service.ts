import pool from '../config/db'

export const DEFAULT_CHAT_MODEL = 'gpt-5.4-mini'
export type ChatModel = 'gpt-4o-mini' | 'gpt-5.4-mini' | 'gpt-5.5' | 'gpt-6-astra'
const MODELS: { id: ChatModel; label: string }[] = [
  { id: 'gpt-4o-mini', label: '경제형 · GPT-4o mini' },
  { id: 'gpt-5.4-mini', label: '균형형 · GPT-5.4 mini (기본)' },
  { id: 'gpt-5.5', label: '고급형 · GPT-5.5' },
  { id: 'gpt-6-astra', label: '전용 · GPT-6 Astra' },
]
export class AccountSettingsError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
function settings(row: { email: string; chat_model: string }) {
  const models = MODELS.filter(model => model.id !== 'gpt-6-astra' || row.email === 'setupmaru@setupmaru.com')
  return { chatModel: models.find(model => model.id === row.chat_model)?.id ?? DEFAULT_CHAT_MODEL, models }
}
export async function updateAccountSettings(userId: string, model: unknown) {
  if (typeof model !== 'string' || !MODELS.some(option => option.id === model)) {
    throw new AccountSettingsError(400, '유효하지 않은 AI 모델입니다.')
  }
  const current = await getAccountSettings(userId)
  if (!current.models.some(option => option.id === model)) {
    throw new AccountSettingsError(403, '이 계정에서 사용할 수 없는 모델입니다.')
  }
  // Recheck the database email in the write to avoid an authorization race.
  const { rows } = await pool.query(
    "UPDATE users SET chat_model = $2, updated_at = NOW() WHERE id = $1 AND ($2 <> 'gpt-6-astra' OR email = 'setupmaru@setupmaru.com') RETURNING email, chat_model",
    [userId, model]
  )
  if (!rows[0]) throw new AccountSettingsError(403, '계정 설정을 저장할 수 없습니다.')
  return settings(rows[0])
}
export async function getAccountSettings(userId: string) {
  const { rows } = await pool.query('SELECT email, chat_model FROM users WHERE id = $1', [userId])
  if (!rows[0]) throw new AccountSettingsError(401, '계정을 확인할 수 없습니다. 다시 로그인해주세요.')
  return settings(rows[0])
}
