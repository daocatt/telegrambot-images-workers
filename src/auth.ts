import { getDb } from './db/client';
import { emailVerifications, users } from './db/schema';
import { eq } from 'drizzle-orm';

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const passwordBuffer = new TextEncoder().encode(password);
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const pbkdf2Key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign']
  );
  
  const exportedKey = await crypto.subtle.exportKey('raw', pbkdf2Key) as ArrayBuffer;
  const hashHex = Array.from(new Uint8Array(exportedKey)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return `pbkdf2_sha256$100000$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }
  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const hashHex = parts[3];
  
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const passwordBuffer = new TextEncoder().encode(password);
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  const pbkdf2Key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign']
  );
  
  const exportedKey = await crypto.subtle.exportKey('raw', pbkdf2Key) as ArrayBuffer;
  const currentHashHex = Array.from(new Uint8Array(exportedKey)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return currentHashHex === hashHex;
}

export async function sendEmailVerificationCode(
  email: string,
  tgId: string,
  env: any
): Promise<string> {
  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const db = getDb(env.DB);
  
  // Set expiry in 15 minutes
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  
  await db
    .insert(emailVerifications)
    .values({
      email,
      code,
      expires_at: expiresAt,
    })
    .onConflictDoUpdate({
      target: emailVerifications.email,
      set: {
        code,
        expires_at: expiresAt,
      },
    });

  const subject = "Email Verification Code - Telegram Image Host";
  const bodyText = `Your email verification code is: ${code}. It expires in 15 minutes.`;
  const htmlContent = `
    <div style="font-family: sans-serif; padding: 20px; max-width: 500px; border: 2px solid #000; background: #fff;">
      <h2 style="margin-top: 0; color: #000; text-transform: uppercase;">Verification Code</h2>
      <p>Please use the following verification code to confirm your email address:</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 15px; background: #f3f4f6; text-align: center; border: 1px solid #ccc; margin: 20px 0; color: #000;">
        ${code}
      </div>
      <p style="font-size: 12px; color: #666;">This code expires in 15 minutes. If you did not request this, please ignore this email.</p>
    </div>
  `;

  // Try to send via Resend API
  let sent = false;
  const fromEmail = env.SENDER_EMAIL || `noreply@${new URL(env.BASE_URL).hostname}`;

  if (env.RESEND_API_KEY) {
    try {
      const senderName = env.SENDER_NAME || 'Telegram Image Host';
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${senderName} <${fromEmail}>`,
          to: [email],
          subject: subject,
          html: htmlContent,
          text: bodyText,
        }),
      });
      if (resendResponse.ok) {
        sent = true;
        console.log(`Verification email sent to ${email} via Resend API.`);
      } else {
        const errorText = await resendResponse.text();
        console.error(`Resend API returned error: ${errorText}`);
      }
    } catch (err) {
      console.error("Failed to send email via Resend API:", err);
    }
  }

  // Try to send via CF Email Sending if Resend was not used
  if (!sent && env.EMAIL) {
    try {
      const senderName = env.SENDER_NAME || "Telegram Image Host Auth";
      await env.EMAIL.send({
        to: email,
        from: { email: fromEmail, name: senderName },
        subject,
        html: htmlContent,
        text: bodyText,
      });
      sent = true;
      console.log(`Verification email sent to ${email} via Cloudflare Email Sending.`);
    } catch (err) {
      console.error("Failed to send email via Cloudflare Email Sending:", err);
    }
  }

  // Fallback 1: Log to console
  console.log(`[VERIFICATION CODE] Email: ${email}, Code: ${code}`);

  // Fallback 2: Send code to Telegram Chat
  if (tgId && env.BOT_TOKEN) {
    try {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgId,
          text: `🔑 **Email Verification Code**\n\nTo link *${email}*, enter this code on the verification page:\n\n\`${code}\`\n\n_Expires in 15 minutes._`,
          parse_mode: 'Markdown',
        }),
      });
    } catch (tgErr) {
      console.error("Failed to send Telegram backup verification notification:", tgErr);
    }
  }

  return code;
}

export async function verifyEmailCode(
  email: string,
  code: string,
  env: any
): Promise<boolean> {
  const db = getDb(env.DB);
  const record = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.email, email))
    .get();

  if (!record) return false;
  if (record.code !== code) return false;
  if (new Date(record.expires_at).getTime() < Date.now()) return false;

  // Cleanup code after successful verification
  await db.delete(emailVerifications).where(eq(emailVerifications.email, email));
  return true;
}
