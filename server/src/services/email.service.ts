import nodemailer from 'nodemailer'
import { EMAIL_FROM, GMAIL_APP_PASSWORD, GMAIL_USER } from '../config/env'

let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !EMAIL_FROM) {
    throw new Error('[email] GMAIL_USER, GMAIL_APP_PASSWORD, and EMAIL_FROM must be configured')
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
    })
  }

  return transporter
}

export async function sendEmailVerificationCode(
  recipient: string,
  code: string,
  expiresInMinutes: number
): Promise<void> {
  await getTransporter().sendMail({
    from: `PC Management Assistant <${EMAIL_FROM}>`,
    to: recipient,
    subject: '[PC Management Assistant] 이메일 인증번호',
    text: [
      'PC Management Assistant 회원가입 인증번호입니다.',
      '',
      `인증번호: ${code}`,
      `유효시간: ${expiresInMinutes}분`,
      '',
      '본인이 요청하지 않았다면 이 메일을 무시해주세요.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
        <h2 style="margin:0 0 16px">PC Management Assistant</h2>
        <p>회원가입을 완료하려면 아래 인증번호를 입력해주세요.</p>
        <div style="margin:24px 0;padding:16px 20px;background:#eff6ff;border-radius:10px;font-size:30px;font-weight:700;letter-spacing:8px;color:#1d4ed8;text-align:center">
          ${code}
        </div>
        <p>인증번호는 <strong>${expiresInMinutes}분</strong> 동안 유효합니다.</p>
        <p style="font-size:13px;color:#64748b">본인이 요청하지 않았다면 이 메일을 무시해주세요.</p>
      </div>
    `,
  })
}
