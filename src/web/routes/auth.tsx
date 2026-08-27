import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../db/schema'
import { eq, and, lt } from 'drizzle-orm'
import { ContextEnv } from '../types'
import { hashPassword, verifyPassword, sendEmailVerificationCode, verifyEmailCode } from '../../auth'
import { escapeHtml, maskEmail, timingSafeEqual } from '../utils'
import { Layout } from '../components/Layout'

const authApp = new Hono<ContextEnv>()

authApp.get('/login', async (c) => {
  const ticket = c.req.query('ticket')
  const error = c.req.query('error')

  const botName = c.env.TELEGRAM_BOT_NAME || ''
  const botUsername = botName.startsWith('@') ? botName.slice(1) : botName
  const botLink = botUsername ? `https://t.me/${botUsername}` : 'https://t.me'
  
  if (ticket) {
    return c.html(
      <html lang="en">
        <head>
          <title>Verification - Telegram Admin</title>
          <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        </head>
        <body class="flex items-center justify-center min-h-screen bg-gray-100 font-mono text-black">
          <div class="p-8 bg-white border-2 border-black max-w-sm w-full rounded-none">
            <h2 class="text-xl font-black uppercase tracking-wider mb-2 text-center border-b border-black pb-4">Bot Verification</h2>
            <p class="text-xs text-gray-500 mb-6 text-center">Please enter the 6-digit verification code sent to your Telegram chat.</p>
            
            {error && (
              <div class="bg-gray-100 border-l-4 border-black p-3 mb-4 text-xs font-bold text-red-600 rounded-none">
                {escapeHtml(error)}
              </div>
            )}
            
            <form action="/admin/login-ticket" method="post" autocomplete="off" class="space-y-4">
              <input type="hidden" name="ticket" value={ticket} />
              <div>
                <label class="block text-xs font-bold uppercase mb-1">Verification Code</label>
                <input type="text" name="code" required autocomplete="one-time-code" placeholder="123456" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none text-center tracking-[0.5em] font-bold focus:ring-0 focus:border-zinc-500" />
              </div>
              <button type="submit" class="w-full bg-black text-white py-2 text-sm font-bold uppercase tracking-wider hover:bg-zinc-800 transition rounded-none border border-black cursor-pointer">
                Confirm Login
              </button>
            </form>
            <div class="mt-6 border-t border-black pt-4 text-center">
              <a href="/admin/login" class="text-xs text-gray-600 hover:underline">Back to standard login</a>
            </div>
          </div>
        </body>
      </html>
    )
  }

  return c.html(
    <html lang="en">
      <head>
        <title>Login - Telegram Admin</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        {c.env.TURNSTILE_SITE_KEY && (
          <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        )}
      </head>
      <body class="flex items-center justify-center min-h-screen bg-gray-100 font-mono text-black">
        <div class="p-8 bg-white border-2 border-black max-w-sm w-full rounded-none">
          <h2 class="text-xl font-black uppercase tracking-wider mb-6 text-center border-b border-black pb-4">Console Login</h2>
          {error && (
            <div class="bg-gray-100 border-l-4 border-black p-3 mb-4 text-xs font-bold text-red-600 rounded-none">
              {escapeHtml(error)}
            </div>
          )}
          
          <form action="/admin/login" method="post" autocomplete="off" class="space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Email Address</label>
              <input type="email" name="email" required autocomplete="username" placeholder="name@domain.com" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
            </div>
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Password</label>
              <div class="relative flex items-stretch">
                <input type="password" id="login-password" name="password" required autocomplete="current-password" placeholder="••••••••" class="w-full bg-white border border-black pl-3 pr-10 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                <button type="button" onclick="const input = document.getElementById('login-password'); input.type = input.type === 'password' ? 'text' : 'password';" class="absolute inset-y-0 right-0 px-3 flex items-center text-sm hover:bg-gray-100 border-l border-black cursor-pointer">
                  👁️
                </button>
              </div>
            </div>
            {c.env.TURNSTILE_SITE_KEY && (
              <div class="cf-turnstile" data-sitekey={c.env.TURNSTILE_SITE_KEY} data-theme="light"></div>
            )}
            <button type="submit" class="w-full bg-black text-white py-2 text-sm font-bold uppercase tracking-wider hover:bg-zinc-800 transition rounded-none border border-black">
              Sign In
            </button>
          </form>

          <div class="mt-6 border-t border-black pt-4 text-center">
            <p class="text-xs text-gray-600 mb-3">No email login yet? Generate a dashboard link from your Telegram bot via /dashboard command.</p>
            <a href={botLink} class="inline-block border border-black bg-white text-black px-4 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-gray-100 transition rounded-none">Go to Bot</a>
          </div>
        </div>
      </body>
    </html>
  )
})

authApp.post('/login-ticket', async (c) => {
  const body = await c.req.parseBody()
  const ticket = String(body['ticket'] || '')
  const code = String(body['code'] || '').trim()

  const db = drizzle(c.env.DB, { schema })
  const now = Date.now()

  const record = await db.select().from(schema.tgLoginTickets).where(eq(schema.tgLoginTickets.ticket, ticket)).get()
  
  if (!record || record.expires_at.getTime() < now) {
    return c.redirect(`/admin/login?ticket=${encodeURIComponent(ticket)}&error=Verification+code+expired.+Please+generate+a+new+link+from+the+bot.`)
  }

  if (!timingSafeEqual(record.code, code)) {
    return c.redirect(`/admin/login?ticket=${encodeURIComponent(ticket)}&error=Invalid+verification+code.`)
  }

  // Auth successful! Delete the temporary ticket
  await db.delete(schema.tgLoginTickets).where(eq(schema.tgLoginTickets.ticket, ticket))

  // Create persistent session
  const token = crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 day session for OTP login

  await db.insert(schema.adminSessions).values({
    token,
    user_id: record.user_id,
    expires_at: expiresAt,
  })

  // Clean up expired sessions for this user (fire-and-forget)
  c.executionCtx.waitUntil(
    db.delete(schema.adminSessions)
      .where(and(
        eq(schema.adminSessions.user_id, record.user_id),
        lt(schema.adminSessions.expires_at, new Date())
      ))
  )

  setCookie(c, 'admin_token', token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 24 * 60 * 60,
  })

  return c.redirect('/admin')
})

authApp.post('/login', async (c) => {
  const body = await c.req.parseBody()
  const email = String(body['email'] || '').trim().toLowerCase()
  const password = String(body['password'] || '')

  if (!email || !password) {
    return c.redirect('/admin/login?error=Invalid+credentials')
  }

  if (c.env.TURNSTILE_SECRET_KEY) {
    const turnstileToken = String(body['cf-turnstile-response'] || '')
    if (!turnstileToken) {
      return c.redirect('/admin/login?error=Captcha+verification+required')
    }
    try {
      const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: c.env.TURNSTILE_SECRET_KEY,
          response: turnstileToken,
        }),
      })
      const verifyData = await verifyRes.json() as any
      if (!verifyData.success) {
        return c.redirect('/admin/login?error=Captcha+verification+failed')
      }
    } catch (err) {
      console.error('Turnstile verification error:', err)
      return c.redirect('/admin/login?error=Captcha+verification+failed')
    }
  }

  const db = drizzle(c.env.DB, { schema })
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get()

  if (!user || !user.password_hash || user.status !== 'active') {
    return c.redirect('/admin/login?error=Invalid+credentials')
  }

  const matches = await verifyPassword(password, user.password_hash)
  if (!matches) {
    return c.redirect('/admin/login?error=Invalid+credentials')
  }

  // Create persistent session
  const token = crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 day session for Email login

  await db.insert(schema.adminSessions).values({
    token,
    user_id: user.tg_id,
    expires_at: expiresAt,
  })

  // Clean up expired sessions for this user (fire-and-forget)
  c.executionCtx.waitUntil(
    db.delete(schema.adminSessions)
      .where(and(
        eq(schema.adminSessions.user_id, user.tg_id),
        lt(schema.adminSessions.expires_at, new Date())
      ))
  )

  setCookie(c, 'admin_token', token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 24 * 60 * 60,
  })

  return c.redirect('/admin')
})

authApp.get('/logout', async (c) => {
  const token = getCookie(c, 'admin_token')
  if (token) {
    const db = drizzle(c.env.DB, { schema })
    c.executionCtx.waitUntil(db.delete(schema.adminSessions).where(eq(schema.adminSessions.token, token)))
  }
  deleteCookie(c, 'admin_token', { path: '/' })
  return c.redirect('/admin/login')
})

// Setup Credentials Page
authApp.get('/setup-credentials', async (c) => {
  const userId = c.get('userId')
  const db = drizzle(c.env.DB, { schema })
  const user = await db.select().from(schema.users).where(eq(schema.users.tg_id, userId)).get()

  if (user && user.email && user.password_hash) {
    return c.redirect('/admin')
  }

  return c.html(
    <html lang="en">
      <head>
        <title>Setup Credentials - Admin Console</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          function clearSetupInputs() {
            const email = document.getElementById('email');
            const code = document.getElementById('code');
            const password = document.getElementById('setup-password');
            const codeContainer = document.getElementById('code-container');
            if (email) email.value = '';
            if (code) code.value = '';
            if (password) password.value = '';
            if (codeContainer) codeContainer.style.display = 'none';
          }
          document.addEventListener('DOMContentLoaded', clearSetupInputs);
          window.addEventListener('pageshow', () => {
            clearSetupInputs();
          });

          async function sendVerificationCode() {
            const email = document.getElementById('email').value.trim();
            if (!email) return alert('Please enter email');
            const res = await fetch('/admin/api/auth/send-code', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (data.success) {
              document.getElementById('code-container').style.display = 'block';
            } else {
              alert('Error: ' + data.error);
            }
          }

          async function verifyAndSetup() {
            const email = document.getElementById('email').value.trim();
            const code = document.getElementById('code').value.trim();
            const password = document.getElementById('setup-password').value;

            if (password.length < 8) {
               return alert('Password must be at least 8 characters long.');
            }

            const res = await fetch('/admin/api/auth/verify-code', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ email, code, password })
            });
            const data = await res.json();
            if (data.success) {
              alert('Setup completed! You can now log in using email.');
              window.location.href = '/admin';
            } else {
              alert('Verification failed: ' + data.error);
            }
          }
        ` }} />
      </head>
      <body class="flex items-center justify-center min-h-screen bg-gray-100 font-mono text-black">
        <div class="p-8 bg-white border-2 border-black max-w-sm w-full rounded-none">
          <h2 class="text-xl font-black uppercase tracking-wider mb-2 text-center">Setup Credentials</h2>
          <p class="text-xs text-gray-500 mb-6 text-center">Link your Telegram account to an email and password for future direct web access.</p>

          <form autocomplete="off" onsubmit="return false;" class="space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Email Address</label>
              <div class="flex gap-2">
                <input type="email" id="email" required autocomplete="username" placeholder="name@domain.com" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                <button type="button" onclick="sendVerificationCode()" class="bg-black text-white px-3 py-2 text-xs font-bold uppercase hover:bg-zinc-800 rounded-none border border-black whitespace-nowrap">
                  Send Code
                </button>
              </div>
            </div>

            <div id="code-container" style="display:none;" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase mb-1">Verification Code</label>
                <input type="text" id="code" required autocomplete="one-time-code" placeholder="123456" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none text-center tracking-[0.5em] font-bold focus:ring-0 focus:border-zinc-500" />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase mb-1">New Password (Min 8 characters)</label>
                <div class="relative flex items-stretch">
                  <input type="password" id="setup-password" required autocomplete="new-password" placeholder="••••••••" class="w-full bg-white border border-black pl-3 pr-10 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                  <button type="button" onclick="const input = document.getElementById('setup-password'); input.type = input.type === 'password' ? 'text' : 'password';" class="absolute inset-y-0 right-0 px-3 flex items-center text-sm hover:bg-gray-100 border-l border-black cursor-pointer">
                    👁️
                  </button>
                </div>
              </div>
              <button type="button" onclick="verifyAndSetup()" class="w-full bg-black text-white py-2 text-sm font-bold uppercase hover:bg-zinc-800 rounded-none border border-black">
                Verify & Save Credentials
              </button>
            </div>
          </form>
        </div>
      </body>
    </html>
  )
})

// OTP Verification endpoints
authApp.post('/api/auth/send-code', async (c) => {
  const sessionToken = getCookie(c, 'admin_token')
  if (!sessionToken) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const db = drizzle(c.env.DB, { schema })
  const session = await db.select().from(schema.adminSessions).where(eq(schema.adminSessions.token, sessionToken)).get()
  if (!session) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const body = await c.req.json()
  const email = String(body.email || '').trim().toLowerCase()

  if (!email || !email.includes('@')) {
    return c.json({ success: false, error: 'Invalid email address' })
  }

  // Check if email already registered to someone else
  const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, email)).get()
  if (existingUser && existingUser.tg_id !== session.user_id) {
    return c.json({ success: false, error: 'Email is already linked to another account' })
  }

  try {
    await sendEmailVerificationCode(email, session.user_id, c.env)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ success: false, error: err.message })
  }
})

authApp.post('/api/auth/verify-code', async (c) => {
  const sessionToken = getCookie(c, 'admin_token')
  if (!sessionToken) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const db = drizzle(c.env.DB, { schema })
  const session = await db.select().from(schema.adminSessions).where(eq(schema.adminSessions.token, sessionToken)).get()
  if (!session) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const body = await c.req.json()
  const email = String(body.email || '').trim().toLowerCase()
  const code = String(body.code || '').trim()
  const password = String(body.password || '')

  if (!email || !code || !password || password.length < 8) {
    return c.json({ success: false, error: 'Invalid parameters. Password must be >= 8 characters.' })
  }

  const isValid = await verifyEmailCode(email, code, c.env)
  if (!isValid) {
    return c.json({ success: false, error: 'Verification code is invalid or expired.' })
  }

  const passwordHash = await hashPassword(password)
  await db.update(schema.users).set({
    email,
    password_hash: passwordHash,
    email_verified: true,
  }).where(eq(schema.users.tg_id, session.user_id))

  return c.json({ success: true })
})

// Profile (Personal Center) Page
authApp.get('/profile', async (c) => {
  const userId = c.get('userId')
  const isSuperAdmin = c.get('isSuperAdmin')
  const db = drizzle(c.env.DB, { schema })
  const user = await db.select().from(schema.users).where(eq(schema.users.tg_id, userId)).get()
  const error = c.req.query('error')
  const success = c.req.query('success')

  return c.html(
    <>
      <Layout title="Personal Center" isAdmin={user?.is_admin} isSuperAdmin={isSuperAdmin} showGallery={String(c.env.ENABLE_GALLERY) === 'true'}>
        <script dangerouslySetInnerHTML={{ __html: `
          function clearProfileInputs() {
            const email = document.getElementById('profile-email-input');
            const code = document.getElementById('profile-code-input');
            const nickname = document.getElementById('profile-nickname-input');
            const currentPwd = document.getElementById('profile-current-password');
            const newPwd = document.getElementById('profile-new-password');
            if (email) email.value = '';
            if (code) code.value = '';
            if (nickname) nickname.value = '';
            if (currentPwd) currentPwd.value = '';
            if (newPwd) newPwd.value = '';
          }
          document.addEventListener('DOMContentLoaded', clearProfileInputs);
          window.addEventListener('pageshow', () => {
            clearProfileInputs();
          });

          async function sendProfileCode() {
            const email = document.getElementById('profile-email-input').value.trim();
            if (!email) return alert('Please enter email first');
            const res = await fetch('/admin/api/auth/send-code-profile', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (data.success) {
              alert('Verification code sent to your new email.');
            } else {
              alert('Error: ' + data.error);
            }
          }
        ` }} />
        <div class="max-w-2xl mx-auto bg-white border-2 border-black p-6 sm:p-8 rounded-none">
          <h2 class="text-xl font-black uppercase tracking-wider mb-6 border-b border-black pb-4">Personal Center</h2>
          
          {error && (
            <div class="bg-gray-100 border-l-4 border-black p-3 mb-6 text-xs font-bold text-red-600 rounded-none">
              {escapeHtml(error)}
            </div>
          )}
          {success && (
            <div class="bg-gray-100 border-l-4 border-black p-3 mb-6 text-xs font-bold text-green-600 rounded-none">
              {escapeHtml(success)}
            </div>
          )}

          <div class="space-y-6">
            {/* Account Info */}
            <div class="bg-gray-50 border border-black p-4 rounded-none">
              <h3 class="text-sm font-bold uppercase tracking-wider mb-3">Account Information</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <span class="text-gray-500 block">Telegram ID</span>
                  <span class="font-bold font-mono">{user?.tg_id}</span>
                </div>
                <div>
                  <span class="text-gray-500 block">Current Nickname</span>
                  <span class="font-bold">{escapeHtml(user?.nickname || 'None')}</span>
                </div>
                <div>
                  <span class="text-gray-500 block">Bound Email</span>
                  <span class="font-bold font-mono">{user?.email ? maskEmail(user.email) : 'Not bound'}</span>
                </div>
                <div>
                  <span class="text-gray-500 block">Account Role</span>
                  <span class="font-bold uppercase">{user?.is_admin ? (isSuperAdmin ? 'Super Admin' : 'Admin') : 'User'}</span>
                </div>
              </div>
            </div>

            {/* Change Nickname */}
            <div class="border border-black p-4 rounded-none">
              <h3 class="text-sm font-bold uppercase tracking-wider mb-3">Update Nickname</h3>
              <form action="/admin/profile/update-nickname" method="post" autocomplete="off" class="space-y-3">
                <div>
                  <input type="text" id="profile-nickname-input" name="nickname" required value={escapeHtml(user?.nickname || '')} placeholder="Enter nickname" class="w-full bg-white border border-black px-3 py-2 text-xs outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                </div>
                <button type="submit" class="bg-black text-white px-4 py-1.5 text-xs font-bold uppercase hover:bg-zinc-800 transition rounded-none border border-black cursor-pointer">
                  Save Nickname
                </button>
              </form>
            </div>

            {/* Bind/Change Email */}
            <div class="border border-black p-4 rounded-none">
              <h3 class="text-sm font-bold uppercase tracking-wider mb-3">
                {user?.email ? 'Change Email Address' : 'Bind Email Address'}
              </h3>
              <form action="/admin/profile/update-email" method="post" autocomplete="off" class="space-y-3">
                <div>
                  <label class="block text-[10px] font-bold uppercase text-gray-500 mb-1">New Email</label>
                  <div class="flex gap-2">
                    <input type="email" id="profile-email-input" name="email" required autocomplete="off" placeholder="name@domain.com" class="w-full bg-white border border-black px-3 py-2 text-xs outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                    <button type="button" onclick="sendProfileCode()" class="bg-black text-white px-3 py-2 text-xs font-bold uppercase hover:bg-zinc-800 rounded-none border border-black whitespace-nowrap cursor-pointer">
                      Send Code
                    </button>
                  </div>
                </div>
                <div>
                  <label class="block text-[10px] font-bold uppercase text-gray-500 mb-1">Verification Code</label>
                  <input type="text" id="profile-code-input" name="code" required autocomplete="off" placeholder="123456" class="w-full bg-white border border-black px-3 py-2 text-xs outline-none rounded-none text-center tracking-[0.3em] font-bold focus:ring-0 focus:border-zinc-500" />
                </div>
                <button type="submit" class="bg-black text-white px-4 py-1.5 text-xs font-bold uppercase hover:bg-zinc-800 transition rounded-none border border-black cursor-pointer">
                  Verify & Update Email
                </button>
              </form>
            </div>

            {/* Change Password */}
            <div class="border border-black p-4 rounded-none">
              <h3 class="text-sm font-bold uppercase tracking-wider mb-3">Change Password</h3>
              <form action="/admin/profile/change-password" method="post" autocomplete="off" class="space-y-3">
                {user?.password_hash && (
                  <div>
                    <label class="block text-[10px] font-bold uppercase text-gray-500 mb-1">Current Password</label>
                    <input type="password" id="profile-current-password" name="current_password" required autocomplete="current-password" placeholder="••••••••" class="w-full bg-white border border-black px-3 py-2 text-xs outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                  </div>
                )}
                <div>
                  <label class="block text-[10px] font-bold uppercase text-gray-500 mb-1">New Password (Min 8 characters)</label>
                  <input type="password" id="profile-new-password" name="new_password" required autocomplete="new-password" placeholder="••••••••" class="w-full bg-white border border-black px-3 py-2 text-xs outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                </div>
                <button type="submit" class="bg-black text-white px-4 py-1.5 text-xs font-bold uppercase hover:bg-zinc-800 transition rounded-none border border-black cursor-pointer">
                  Update Password
                </button>
              </form>
            </div>

          </div>
        </div>
      </Layout>
    </>
  )
})

authApp.post('/profile/update-nickname', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.parseBody()
  const nickname = String(body['nickname'] || '').trim()

  if (!nickname) {
    return c.redirect('/admin/profile?error=Nickname+cannot+be+empty')
  }

  const db = drizzle(c.env.DB, { schema })
  await db.update(schema.users).set({ nickname }).where(eq(schema.users.tg_id, userId))
  return c.redirect('/admin/profile?success=Nickname+updated+successfully')
})

authApp.post('/api/auth/send-code-profile', async (c) => {
  const sessionToken = getCookie(c, 'admin_token')
  if (!sessionToken) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const db = drizzle(c.env.DB, { schema })
  const session = await db.select().from(schema.adminSessions).where(eq(schema.adminSessions.token, sessionToken)).get()
  if (!session) return c.json({ success: false, error: 'Unauthorized' }, 401)

  const body = await c.req.json()
  const email = String(body.email || '').trim().toLowerCase()

  if (!email || !email.includes('@')) {
    return c.json({ success: false, error: 'Invalid email address' })
  }

  // Check unique email across other users
  const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, email)).get()
  if (existingUser && existingUser.tg_id !== session.user_id) {
    return c.json({ success: false, error: 'Email is already linked to another account' })
  }

  try {
    await sendEmailVerificationCode(email, session.user_id, c.env)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ success: false, error: err.message })
  }
})

authApp.post('/profile/update-email', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.parseBody()
  const email = String(body['email'] || '').trim().toLowerCase()
  const code = String(body['code'] || '').trim()

  if (!email || !code) {
    return c.redirect('/admin/profile?error=Email+and+verification+code+are+required')
  }

  const db = drizzle(c.env.DB, { schema })
  
  // Check unique email
  const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, email)).get()
  if (existingUser && existingUser.tg_id !== userId) {
    return c.redirect('/admin/profile?error=Email+is+already+linked+to+another+account')
  }

  const isValid = await verifyEmailCode(email, code, c.env)
  if (!isValid) {
    return c.redirect('/admin/profile?error=Invalid+or+expired+verification+code')
  }

  await db.update(schema.users).set({
    email,
    email_verified: true
  }).where(eq(schema.users.tg_id, userId))

  return c.redirect('/admin/profile?success=Email+updated+successfully')
})

authApp.post('/profile/change-password', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.parseBody()
  const currentPassword = String(body['current_password'] || '')
  const newPassword = String(body['new_password'] || '')

  if (newPassword.length < 8) {
    return c.redirect('/admin/profile?error=New+password+must+be+at+least+8+characters')
  }

  const db = drizzle(c.env.DB, { schema })
  const user = await db.select().from(schema.users).where(eq(schema.users.tg_id, userId)).get()

  if (!user) {
    return c.redirect('/admin/profile?error=User+not+found')
  }

  // If user had a password set, verify it first
  if (user.password_hash) {
    const verified = await verifyPassword(currentPassword, user.password_hash)
    if (!verified) {
      return c.redirect('/admin/profile?error=Current+password+is+incorrect')
    }
  }

  const newHash = await hashPassword(newPassword)
  await db.update(schema.users).set({
    password_hash: newHash
  }).where(eq(schema.users.tg_id, userId))

  return c.redirect('/admin/profile?success=Password+updated+successfully')
})

export default authApp
