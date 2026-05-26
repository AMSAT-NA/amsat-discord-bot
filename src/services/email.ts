import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { config } from '../config';

const ses = new SESClient({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
});

/** Send the OTP verification email to the member. */
export async function sendVerificationEmail(
  toAddress: string,
  displayName: string,
  otpCode: string,
): Promise<void> {
  const command = new SendEmailCommand({
    Source: `${config.SES_FROM_NAME} <${config.SES_FROM_ADDRESS}>`,
    Destination: { ToAddresses: [toAddress] },
    Message: {
      Subject: {
        Data: 'Your AMSAT Discord Verification Code',
        Charset: 'UTF-8',
      },
      Body: {
        Html: { Data: buildHtml(displayName, otpCode), Charset: 'UTF-8' },
        Text: { Data: buildText(displayName, otpCode), Charset: 'UTF-8' },
      },
    },
  });

  await ses.send(command);
}

// ─── Email templates ───────────────────────────────────────────────────────────

function buildHtml(name: string, code: string): string {
  const ttl = config.OTP_TTL_MINUTES;
  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body   { font-family: Arial, sans-serif; background: #f9f9f9; margin: 0; padding: 24px; }
    .card  { background: #fff; border-radius: 8px; max-width: 480px; margin: 0 auto;
             padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    h2     { color: #1a1a2e; margin-top: 0; }
    .code  { font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #1a1a2e;
             background: #f0f0f0; border-radius: 6px; padding: 14px 24px;
             display: inline-block; margin: 16px 0; }
    pre    { background: #f0f0f0; border-radius: 4px; padding: 10px 14px;
             font-size: 14px; overflow-x: auto; }
    .note  { color: #666; font-size: 13px; margin-top: 24px; border-top: 1px solid #eee;
             padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🛰 AMSAT Discord Verification</h2>
    <p>Hi ${esc(name)},</p>
    <p>Your Discord verification code is:</p>
    <div><span class="code">${esc(code)}</span></div>
    <p>This code expires in <strong>${ttl} minutes</strong>.</p>
    <p>Return to Discord and run:</p>
    <pre>/verify confirm code:${esc(code)}</pre>
    <div class="note">
      If you did not request this code, you can safely ignore this email.<br>
      Your account will not be affected.
    </div>
  </div>
</body>
</html>`.trim();
}

function buildText(name: string, code: string): string {
  const ttl = config.OTP_TTL_MINUTES;
  return `
AMSAT Discord Verification
===========================

Hi ${name},

Your Discord verification code is:

  ${code}

This code expires in ${ttl} minutes.

Return to Discord and run:

  /verify confirm code:${code}

If you did not request this, you can safely ignore this email.

---
AMSAT — The Radio Amateur Satellite Corporation
`.trim();
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
