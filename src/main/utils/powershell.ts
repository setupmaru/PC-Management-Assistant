import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * PowerShell 스크립트를 Base64 인코딩(UTF-16LE)으로 실행
 * 한글 경로 등 특수문자 포함 환경에서 안전하게 실행
 */
export async function runPowerShell(script: string, timeoutMs = 15000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')

  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encoded,
    ],
    {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      encoding: 'utf8',
    }
  )

  if (stderr && !stdout) {
    throw new Error(`PowerShell error: ${stderr}`)
  }

  return stdout.trim()
}
