export type ChatModel = 'gpt-4o-mini' | 'gpt-5.4-mini' | 'gpt-5.5' | 'gpt-6-astra'
export interface AccountSettings {
  chatModel: ChatModel
  models: { id: ChatModel; label: string }[]
}
export type AccountSettingsResult = { success: true; data: AccountSettings } | { success: false; error: string }
