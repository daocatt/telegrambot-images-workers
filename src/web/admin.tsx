import { Hono } from 'hono'
import { html } from 'hono/html'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, desc, and, like, count, sql, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { EnvBindings } from '../bot/context'
import { hashPassword, verifyPassword, sendEmailVerificationCode, verifyEmailCode } from '../auth'

function maskEmail(email: string): string {
  if (!email) return 'Not Setup';
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const masked = local.length <= 2 ? local[0] + '***' : local[0] + '***' + local.slice(-1);
  return masked + '@' + domain;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type ContextEnv = {
  Bindings: EnvBindings;
  Variables: {
    userId: string;
    isAdmin: boolean;
    isSuperAdmin: boolean;
  }
}

const adminApp = new Hono<ContextEnv>()

adminApp.use('*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))

// Template wrapper with Right Angles and Black/White aesthetics
const Layout = (props: { title: string; isAdmin?: boolean; isSuperAdmin?: boolean; showGallery?: boolean; children: any }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📷</text></svg>" />
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          ;window._dashboard_data = () => ({
            selected: [],
            copiedId: null,
            toggleAll() {
              if (this.selected.length > 0) {
                this.selected = [];
              } else {
                const boxes = document.querySelectorAll("input[name='image-select']");
                this.selected = Array.from(boxes).map(b => b.value);
              }
            },
            copyUrl(id, fileId) {
              const url = window.location.origin + '/file/' + fileId + '.jpg';
              navigator.clipboard.writeText(url);
              this.copiedId = id;
              setTimeout(() => { if(this.copiedId === id) this.copiedId = null }, 2000);
            }
          });
          document.addEventListener('alpine:init', () => {
             if (window._dash_loaded) return;
             Alpine.data('dashboard', window._dashboard_data);
             window._dash_loaded = true;
          });
        `}} />
        <script defer src="https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.14.0/cdn.min.js"></script>
        <style>
          [x-cloak] {'{ display: none !important; }'}
          .no-scrollbar::-webkit-scrollbar {'{ display: none; }'}
          .no-scrollbar {'{ -ms-overflow-style: none; scrollbar-width: none; }'}
        </style>
      </head>
      <body class="bg-gray-100 text-black min-h-screen font-mono">
        <header class="bg-white border-b border-black sticky top-0 z-30">
          <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center gap-2">
            <h1 class="text-lg md:text-xl font-black uppercase tracking-wider text-black">
              📷 SnapFlare
            </h1>
            <nav class="flex items-center space-x-3 md:space-x-4 overflow-x-auto no-scrollbar py-1">
              <a href="/admin" class="text-black hover:bg-black hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-black transition whitespace-nowrap">Images</a>
              {props.isSuperAdmin && (
                <a href="/admin/users" class="text-black hover:bg-black hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-black transition whitespace-nowrap">Users</a>
              )}
              {props.showGallery && (
                <a href="/admin/groups" class="text-black hover:bg-black hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-black transition whitespace-nowrap">Gallery</a>
              )}
              <a href="/admin/profile" class="text-black hover:bg-black hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-black transition whitespace-nowrap">Profile</a>
              <a href="/admin/logout" class="text-red-600 hover:bg-red-600 hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-red-600 transition whitespace-nowrap">Logout</a>
            </nav>
          </div>
        </header>
        <main class="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 pb-32">
          {props.children}
        </main>
      </body>
    </html>
  )
}

// 1. Auth + CSRF Middleware
adminApp.use('*', async (c, next) => {
  const path = c.req.path
  if (path.endsWith('/login') || path.endsWith('/logout') || path.includes('/send-code') || path.includes('/verify-code')) {
    return next()
  }

  if (c.req.method === 'POST') {
    const origin = c.req.header('Origin') || c.req.header('Referer')
    if (origin) {
      const originHost = new URL(origin).hostname
      const reqHost = new URL(c.req.url).hostname
      if (originHost !== reqHost) {
        return c.text('Forbidden: CSRF check failed', 403)
      }
    }
  }

  const token = getCookie(c, 'admin_token')
  const queryToken = c.req.query('token')
  const currentToken = token || queryToken

  if (!currentToken) {
    return c.redirect('/admin/login?error=missing_token')
  }

  const db = drizzle(c.env.DB, { schema })
  const session = await db.select().from(schema.adminSessions).where(eq(schema.adminSessions.token, currentToken)).get()

  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    if (session) {
      c.executionCtx.waitUntil(db.delete(schema.adminSessions).where(eq(schema.adminSessions.token, currentToken)))
    }
    deleteCookie(c, 'admin_token')
    return c.redirect('/admin/login?error=expired')
  }

  // If logged in via URL token, set the persistent cookie
  if (queryToken && !token) {
    setCookie(c, 'admin_token', queryToken, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 2 * 60 * 60,
    })
  }

  const user = await db.select().from(schema.users).where(eq(schema.users.tg_id, session.user_id)).get()
  if (!user) {
    deleteCookie(c, 'admin_token')
    return c.redirect('/admin/login?error=user_not_found')
  }

  c.set('userId', session.user_id)
  c.set('isAdmin', user.is_admin)

  const superAdminTgId = c.env.SUPER_ADMIN_TG_ID
  const isSuperAdmin = superAdminTgId
    ? user.tg_id === superAdminTgId
    : user.is_admin
  c.set('isSuperAdmin', isSuperAdmin)

  // Redirect to setup credentials if not completed
  if (!user.email || !user.password_hash) {
    if (!path.endsWith('/setup-credentials')) {
      return c.redirect('/admin/setup-credentials')
    }
  }

  await next()
})

// 2. Auth Routes
adminApp.get('/login', async (c) => {
  const token = c.req.query('token')
  const error = c.req.query('error')
  
  if (token) {
    const db = drizzle(c.env.DB, { schema })
    const session = await db.select().from(schema.adminSessions).where(eq(schema.adminSessions.token, token)).get()
    
    if (session && new Date(session.expires_at).getTime() > Date.now()) {
      setCookie(c, 'admin_token', token, {
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 2 * 60 * 60,
      })
      // BUG FIX: Do NOT delete session from database, otherwise subsequent requests fail middleware check!
      return c.redirect('/admin')
    }
    return c.text('Invalid or expired login token. Please request a new one from the bot.', 401)
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
          
          <form action="/admin/login" method="post" class="space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Email Address</label>
              <input type="email" name="email" required placeholder="name@domain.com" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
            </div>
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Password</label>
              <div class="relative flex items-stretch">
                <input type="password" id="login-password" name="password" required placeholder="••••••••" class="w-full bg-white border border-black pl-3 pr-10 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
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
            <a href="https://t.me/" class="inline-block border border-black bg-white text-black px-4 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-gray-100 transition rounded-none">Go to Bot</a>
          </div>
        </div>
      </body>
    </html>
  )
})

adminApp.post('/login', async (c) => {
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
        sql`${schema.adminSessions.expires_at} < ${Date.now()}`
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

adminApp.get('/logout', async (c) => {
  const token = getCookie(c, 'admin_token')
  if (token) {
    const db = drizzle(c.env.DB, { schema })
    c.executionCtx.waitUntil(db.delete(schema.adminSessions).where(eq(schema.adminSessions.token, token)))
  }
  deleteCookie(c, 'admin_token', { path: '/' })
  return c.redirect('/admin/login')
})

// Setup Credentials Page
adminApp.get('/setup-credentials', async (c) => {
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
          document.addEventListener('DOMContentLoaded', () => {
            const savedEmail = localStorage.getItem('setup_email');
            const savedCode = localStorage.getItem('setup_code');
            if (savedEmail) {
              document.getElementById('email').value = savedEmail;
            }
            if (savedCode) {
              document.getElementById('code').value = savedCode;
              document.getElementById('code-container').style.display = 'block';
            }
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
              alert('Verification code sent successfully! Check your email or Telegram Bot chat.');
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
              localStorage.removeItem('setup_email');
              localStorage.removeItem('setup_code');
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

          <div class="space-y-4">
            <div>
              <label class="block text-xs font-bold uppercase mb-1">Email Address</label>
              <div class="flex gap-2">
                <input type="email" id="email" oninput="localStorage.setItem('setup_email', this.value)" required placeholder="name@domain.com" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                <button type="button" onclick="sendVerificationCode()" class="bg-black text-white px-3 py-2 text-xs font-bold uppercase hover:bg-zinc-800 rounded-none border border-black whitespace-nowrap">
                  Send Code
                </button>
              </div>
            </div>

            <div id="code-container" style="display:none;" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase mb-1">Verification Code</label>
                <input type="text" id="code" oninput="localStorage.setItem('setup_code', this.value)" required placeholder="123456" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none text-center tracking-[0.5em] font-bold focus:ring-0 focus:border-zinc-500" />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase mb-1">New Password (Min 8 characters)</label>
                <div class="relative flex items-stretch">
                  <input type="password" id="setup-password" required placeholder="••••••••" class="w-full bg-white border border-black pl-3 pr-10 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                  <button type="button" onclick="const input = document.getElementById('setup-password'); input.type = input.type === 'password' ? 'text' : 'password';" class="absolute inset-y-0 right-0 px-3 flex items-center text-sm hover:bg-gray-100 border-l border-black cursor-pointer">
                    👁️
                  </button>
                </div>
              </div>
              <button type="button" onclick="verifyAndSetup()" class="w-full bg-black text-white py-2 text-sm font-bold uppercase hover:bg-zinc-800 rounded-none border border-black">
                Verify & Save Credentials
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  )
})

// OTP Verification endpoints
adminApp.post('/api/auth/send-code', async (c) => {
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

adminApp.post('/api/auth/verify-code', async (c) => {
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

// 3. Images Dashboard
adminApp.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')
  const isSuperAdmin = c.get('isSuperAdmin')

  // Pagination & Search params
  const page = parseInt(c.req.query('page') || '1')
  const search = c.req.query('q') || ''
  const error = c.req.query('error') || ''
  const safeSearch = search.replace(/[%_]/g, '\\$&')
  const pageSize = 20
  const offset = (page - 1) * pageSize

  const groupId = c.req.query('gid') || ''

  let baseWhere: any = isAdmin 
    ? (search ? like(schema.images.caption, `%${safeSearch}%`) : undefined)
    : (search 
        ? and(eq(schema.images.uploader_id, userId), like(schema.images.caption, `%${safeSearch}%`))
        : eq(schema.images.uploader_id, userId)
      )

  if (groupId) {
    baseWhere = baseWhere ? and(baseWhere, eq(schema.images.group_id, groupId)) : eq(schema.images.group_id, groupId)
  }

  let activeGroup = null
  if (groupId) {
    activeGroup = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId)).get()
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.images)
    .where(baseWhere)
    .all()
  
  const totalPages = Math.ceil(total / pageSize)

  let imagesList;
  if (isAdmin) {
    imagesList = await db
      .select({
        image: schema.images,
        user: schema.users,
      })
      .from(schema.images)
      .leftJoin(schema.users, eq(schema.images.uploader_id, schema.users.tg_id))
      .where(baseWhere)
      .orderBy(desc(schema.images.created_at))
      .limit(pageSize)
      .offset(offset)
      .all()
  } else {
    const rawImages = await db
      .select()
      .from(schema.images)
      .where(baseWhere)
      .orderBy(desc(schema.images.created_at))
      .limit(pageSize)
      .offset(offset)
      .all()
    imagesList = rawImages.map(img => ({ image: img, user: null }))
  }

  let userGroups: any[] = []
  if (c.env.ENABLE_GALLERY === 'true') {
     userGroups = await db.select().from(schema.groups).where(eq(schema.groups.user_id, userId)).all()
  }

  const isGalleryEnabled = String(c.env.ENABLE_GALLERY) === 'true';

  return c.html(
    <>
      {html`<!DOCTYPE html>`}
      <Layout title="Images Dashboard" isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} showGallery={isGalleryEnabled}>
        <div x-data="dashboard" class="relative">
          {error && (
            <div class="bg-gray-100 border-l-4 border-red-600 p-4 mb-6 text-sm font-bold text-red-600 rounded-none">
              {escapeHtml(error)}
            </div>
          )}
          <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 border-b border-black pb-6">

            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-4">
                <h2 class="text-xl font-bold uppercase tracking-wider">
                  {activeGroup ? `Gallery: ${activeGroup.name}` : 'Uploaded'} ({total})
                </h2>
                <button x-on:click="toggleAll()" class="text-xs bg-white border border-black px-2 py-1 hover:bg-black hover:text-white transition shadow-sm font-medium rounded-none">
                   <span x-text="selected.length === 0 ? 'Select All' : 'Deselect All'">Select All</span>
                </button>
                <button onclick="document.getElementById('uploadModal').showModal()" class="text-xs bg-black border border-black text-white px-2.5 py-1 hover:bg-zinc-800 transition shadow-sm font-bold rounded-none uppercase">
                   + Upload
                </button>
              </div>
              {activeGroup && (
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">Filtering by gallery</span>
                  <a href="/admin" class="text-[10px] bg-white border border-black text-black px-1.5 py-0.5 hover:bg-black hover:text-white flex items-center gap-1 rounded-none">
                    Clear Filter 
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </a>
                </div>
              )}
            </div>

            <form method="get" action="/admin" class="flex gap-2">
              <input 
                type="text" 
                name="q" 
                value={escapeHtml(search as string)}
                placeholder="Search captions..." 
                class="px-3 py-1.5 border border-black bg-white text-sm outline-none w-full md:w-64 rounded-none focus:ring-0 focus:border-zinc-500"
              />
              <button type="submit" class="bg-black border border-black text-white px-4 py-1.5 text-sm font-medium hover:bg-zinc-800 transition rounded-none uppercase">
                Search
              </button>
              {search && (
                <a href="/admin" class="bg-white border border-black text-black px-3 py-1.5 text-sm font-medium hover:bg-gray-100 transition flex items-center rounded-none uppercase">
                  Clear
                </a>
              )}
            </form>
          </div>

          {/* Batch Action Bar */}
          <div x-show="selected.length > 0" 
               x-cloak=""
               x-transition:enter="transition ease-out duration-300 transform"
               x-transition:enter-start="opacity-0 translate-y-10"
               x-transition:enter-end="opacity-100 translate-y-0"
               x-transition:leave="transition ease-in duration-200 transform"
               x-transition:leave-start="opacity-100 translate-y-0"
               x-transition:leave-end="opacity-0 translate-y-10"
               class="fixed bottom-10 left-1/2 -translate-x-1/2 bg-white text-black border-2 border-black px-6 py-4 shadow-2xl z-50 flex items-center gap-6 whitespace-nowrap rounded-none">
            <span class="text-sm font-bold uppercase"><span x-text="selected.length"></span> selected</span>
            
            <div class="h-6 w-px bg-black"></div>

            <div class="flex gap-3">
              {c.env.ENABLE_GALLERY === 'true' && userGroups.length > 0 && (
                <form action="/admin/images/batch-move" method="post" class="flex gap-2 items-center">
                  <template x-for="id in selected">
                    <input type="hidden" name="ids" x-bind:value="id" />
                  </template>
                  <select name="group_id" class="bg-white text-black border border-black text-xs px-3 py-1.5 rounded-none outline-none">
                    <option value="">Move to Gallery...</option>
                    <option value="none">-- Ungroup --</option>
                    {userGroups.map(g => (
                      <option value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <button type="submit" class="bg-black border border-black text-white px-3 py-1.5 text-xs font-bold transition hover:bg-zinc-800 rounded-none uppercase">Apply</button>
                </form>
              )}

              <form action="/admin/images/batch-delete" method="post" onsubmit="return confirm('Permanently delete selected images?')">
                 <template x-for="id in selected">
                    <input type="hidden" name="ids" x-bind:value="id" />
                 </template>
                 <button type="submit" class="bg-red-600 border border-red-600 text-white px-4 py-1.5 text-xs font-bold transition hover:bg-red-700 rounded-none uppercase">Delete All</button>
              </form>
              
              <button x-on:click="selected = []" class="text-xs text-gray-600 hover:text-black underline uppercase">Cancel</button>
            </div>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {imagesList.map(({ image: img, user }) => (
              <div class="bg-white border border-black text-center overflow-hidden flex flex-col relative group rounded-none">
                <div class="h-40 w-full bg-gray-200 relative group/img overflow-hidden">
                   <div class="absolute inset-0 z-10 cursor-pointer"
                        x-on:click={`copyUrl("${escapeHtml(img.id)}", "${escapeHtml(img.tg_file_id)}")`}>
                      <img src={`/file/${encodeURIComponent(img.tg_file_id)}.jpg`} alt={escapeHtml(img.id)} loading="lazy"
                          class={`w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-110 rounded-none ${img.is_broken ? 'grayscale blur-[2px]' : ''}`} />
                     
                     <div x-show={`copiedId === "${img.id}"`} 
                          x-cloak=""
                          x-transition=""
                          class="absolute inset-0 z-30 flex items-center justify-center bg-black/90 text-white font-bold text-sm rounded-none">
                       COPIED!
                     </div>

                     <div class="absolute inset-0 z-20 bg-black/10 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none rounded-none">
                        <div class="bg-white border border-black p-2 text-black rounded-none">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                        </div>
                     </div>
                   </div>

                   <div class="absolute top-2 right-2 z-50 p-1" x-on:click="event.stopPropagation()">
                      <input type="checkbox" name="image-select" x-model="selected" value={img.id} 
                             class="w-6 h-6 border-black text-black bg-white rounded-none cursor-pointer" />
                   </div>

                   {img.is_broken && (
                     <div class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-25 pointer-events-none">
                       <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                       <span class="text-white text-[8px] font-bold uppercase">Missing</span>
                     </div>
                   )}

                   {isAdmin && user && (
                     <div class="absolute top-2 left-2 z-40 flex items-center gap-1 pointer-events-none">
                       <span class={`px-1 text-[8px] font-bold text-white ${user.status === 'active' ? 'bg-green-600' : user.status === 'banned' ? 'bg-red-600' : 'bg-yellow-600'}`}>
                         {user.status === 'active' ? 'A' : user.status === 'banned' ? 'B' : 'P'}
                       </span>
                        <span class="bg-black/50 text-white text-[8px] px-1 py-0.5 backdrop-blur-sm truncate max-w-[50px]">{escapeHtml(user.nickname || user.tg_id)}</span>
                     </div>
                   )}
                </div>
                
                <div class="p-3 text-sm flex flex-col gap-2">
                   <div class="flex items-center gap-2 mb-1">
                      <a href={`/file/${encodeURIComponent(img.tg_file_id)}.jpg`} target="_blank" class="text-black hover:underline font-mono truncate">{img.id}.jpg</a>
                   </div>
                   
                   <div class="flex items-center gap-2">
                      <form action={`/admin/image/${img.id}/toggle-public`} method="post" x-ref="form" class="flex-grow">
                         <button type="submit" 
                                 class={`w-full py-1 px-1 border border-black font-bold text-[10px] uppercase transition rounded-none ${img.is_public ? 'bg-gray-100 text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-zinc-800'}`}>
                           {img.is_public ? 'Public' : 'Private'}
                         </button>
                      </form>
                       <form action={`/admin/image/${img.id}/delete`} method="post" onsubmit="return confirm('Are you sure you want to delete this link?')" class="flex-shrink-0">
                          <button type="submit" class="border border-black hover:bg-gray-100 p-1 transition rounded-none text-red-600" title="Delete Image">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                             </svg>
                          </button>
                       </form>
                    </div>

                    {isGalleryEnabled && (
                      <div class="border-t border-black pt-2 mt-1">
                        <form action="/admin/images/batch-move" method="post" class="flex items-center gap-1 justify-between">
                           <input type="hidden" name="ids" value={img.id} />
                           <select name="group_id" onchange="this.form.submit()" class="text-[10px] bg-transparent border-none text-black font-bold focus:ring-0 w-full cursor-pointer rounded-none">
                              <option value="">Move to...</option>
                              <option value="none">-- Ungroup --</option>
                              {userGroups.map(g => (
                                <option value={g.id} selected={img.group_id === g.id}>{g.name}</option>
                              ))}
                           </select>
                           {img.group_id && (
                             <span class="bg-black text-white text-[9px] px-1.5 py-0.5 font-bold uppercase whitespace-nowrap">In Gallery</span>
                           )}
                        </form>
                      </div>
                    )}
                 </div>
              </div>
            ))}
            {imagesList.length === 0 && <p class="text-gray-500 col-span-full py-12 text-center">No images found matching your criteria.</p>}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div class="mt-8 flex justify-center items-center gap-2">
              {page > 1 && (
                <a href={`/admin?page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`} 
                   class="px-4 py-2 border border-black bg-white text-sm font-bold hover:bg-gray-50 transition rounded-none uppercase">
                  Previous
                </a>
              )}
              
              <div class="flex gap-1">
                 <span class="px-4 py-2 text-sm text-gray-600 font-medium">
                   Page {page} of {totalPages}
                 </span>
              </div>

              {page < totalPages && (
                <a href={`/admin?page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`} 
                   class="px-4 py-2 border border-black bg-white text-sm font-bold hover:bg-gray-50 transition rounded-none uppercase">
                  Next
                </a>
              )}
            </div>
          )}
          
          <dialog id="uploadModal" class="fixed inset-0 m-auto p-6 bg-white border-2 border-black max-w-md w-full h-fit rounded-none backdrop:bg-black/50 shadow-2xl hidden open:flex open:flex-col open:justify-between">
            <div x-data="{
              files: [],
              isDragging: false,
              isUploading: false,
              addFiles(fileList) {
                const limit = 10;
                const newFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));
                if (this.files.length + newFiles.length > limit) {
                  alert('You can only upload up to 10 images at once.');
                  return;
                }
                newFiles.forEach(f => {
                  this.files.push({
                    file: f,
                    name: f.name,
                    size: (f.size / 1024).toFixed(1) + ' KB',
                    status: 'pending',
                    progress: 0,
                    error: ''
                  });
                });
              },
              removeFile(index) {
                if (this.isUploading) return;
                this.files.splice(index, 1);
              },
              async startUpload() {
                if (this.files.length === 0 || this.isUploading) return;
                this.isUploading = true;
                
                for (let i = 0; i < this.files.length; i++) {
                  const item = this.files[i];
                  if (item.status === 'success') continue;
                  
                  item.status = 'uploading';
                  const formData = new FormData();
                  formData.append('file', item.file);
                  const caption = document.getElementById('upload-caption')?.value?.trim();
                  if (caption) formData.append('caption', caption);
                  const groupId = document.getElementById('upload-gallery')?.value;
                  if (groupId) formData.append('group_id', groupId);
                  
                  try {
                    const res = await fetch('/admin/upload-api', {
                      method: 'POST',
                      body: formData
                    });
                    const data = await res.json();
                    if (data.success) {
                      item.status = 'success';
                    } else {
                      item.status = 'error';
                      item.error = data.error || 'Upload failed';
                    }
                  } catch (err) {
                    item.status = 'error';
                    item.error = 'Network error';
                  }
                }
                
                this.isUploading = false;
                if (this.files.some(f => f.status === 'success')) {
                  window.location.reload();
                }
              }
            }" class="space-y-4">
              <div class="flex justify-between items-center border-b border-black pb-2">
                <h3 class="text-md font-black uppercase tracking-wider">Upload Images</h3>
                <span class="text-xs text-gray-500 uppercase font-bold" x-text="files.length + '/10 files'"></span>
              </div>

              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-bold uppercase mb-1">Caption (optional)</label>
                  <input type="text" id="upload-caption" placeholder="Add a caption..." class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                </div>
                {isGalleryEnabled && userGroups.length > 0 && (
                  <div>
                    <label class="block text-xs font-bold uppercase mb-1">Gallery (optional)</label>
                    <select id="upload-gallery" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none">
                      <option value="">No Gallery</option>
                      {userGroups.map(g => (
                        <option value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              
              {/* Drag and Drop Zone */}
              <div 
                x-on:dragover="$event.preventDefault(); isDragging = true"
                x-on:dragleave="$event.preventDefault(); isDragging = false"
                x-on:drop="$event.preventDefault(); isDragging = false; addFiles($event.dataTransfer.files)"
                x-on:click="$refs.fileInput.click()"
                x-bind:class="isDragging ? 'bg-gray-100 border-black' : 'border-black hover:bg-gray-50'"
                class="border-2 border-dashed p-6 text-center cursor-pointer transition select-none flex flex-col items-center justify-center space-y-2 rounded-none"
              >
                <input 
                  type="file" 
                  x-ref="fileInput" 
                  class="hidden" 
                  multiple 
                  accept="image/*" 
                  x-on:change="addFiles($event.target.files); $event.target.value = ''" 
                />
                <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <div class="text-xs font-bold uppercase tracking-wider">Drag & drop files or click to browse</div>
                <div class="text-[10px] text-gray-500">Supports JPG, PNG, WEBP. Max 10 images.</div>
              </div>

              {/* Selected Files List */}
              <div class="max-h-48 overflow-y-auto space-y-2 no-scrollbar" x-show="files.length > 0">
                <template x-for="(item, index) in files" x-bind:key="index">
                  <div class="flex items-center justify-between p-2 border border-black text-xs rounded-none bg-gray-50">
                    <div class="flex flex-col min-w-0 pr-4">
                      <span class="font-bold truncate" x-text="item.name"></span>
                      <span class="text-[10px] text-gray-500" x-text="item.size"></span>
                      <span class="text-[10px] text-red-600 font-bold" x-show="item.status === 'error'" x-text="item.error"></span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      {/* Status Badges */}
                      <span x-show="item.status === 'pending'" class="text-[9px] font-bold text-gray-500 uppercase">Pending</span>
                      <span x-show="item.status === 'uploading'" class="text-[9px] font-bold text-black uppercase animate-pulse">Uploading</span>
                      <span x-show="item.status === 'success'" class="text-[9px] font-bold text-green-600 uppercase">Success</span>
                      
                      <button 
                        type="button" 
                        x-on:click="$event.stopPropagation(); removeFile(index)" 
                        x-show="!isUploading" 
                        class="text-red-600 hover:bg-red-50 p-1 border border-transparent hover:border-red-600 rounded-none"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </template>
              </div>

              {/* Modal Footer Controls */}
              <div class="flex justify-end gap-3 border-t border-black pt-4">
                 <button 
                   type="button" 
                   onclick="document.getElementById('uploadModal').close()" 
                   x-show="!isUploading"
                   class="px-4 py-2 text-sm text-black border border-black hover:bg-gray-100 rounded-none uppercase font-bold"
                 >
                   Cancel
                 </button>
                 <button 
                   type="button" 
                   x-on:click="startUpload()"
                   x-bind:disabled="files.length === 0 || isUploading"
                   x-bind:class="(files.length === 0 || isUploading) ? 'bg-gray-300 border-gray-300 text-gray-500 cursor-not-allowed' : 'bg-black text-white hover:bg-zinc-800'"
                   class="px-4 py-2 text-sm border border-black rounded-none uppercase font-bold transition"
                 >
                   <span x-text="isUploading ? 'Uploading...' : 'Start Upload'"></span>
                 </button>
              </div>
            </div>
          </dialog>
        </div>
      </Layout>
    </>
  )
})

// 4. Image Actions
adminApp.post('/image/:id/toggle-public', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')

  const query = isAdmin 
    ? eq(schema.images.id, id)
    : and(eq(schema.images.id, id), eq(schema.images.uploader_id, userId))

  const current = await db.select().from(schema.images).where(query).get()
  
  if (current) {
    await db.update(schema.images).set({ is_public: !current.is_public }).where(eq(schema.images.id, id))
  }
  return c.redirect('/admin')
})

adminApp.post('/images/batch-move', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')
  const body = await c.req.parseBody()
  
  const ids = (Array.isArray(body['ids']) ? body['ids'] : [body['ids']]) as string[]
  const groupId = body['group_id'] === 'none' ? null : String(body['group_id'])
  
  if (!groupId && body['group_id'] !== 'none') return c.redirect('/admin')

  const query = isAdmin 
    ? inArray(schema.images.id, ids)
    : and(inArray(schema.images.id, ids), eq(schema.images.uploader_id, userId))

  await db.update(schema.images).set({ group_id: groupId }).where(query)
  return c.redirect('/admin')
})

adminApp.post('/images/batch-delete', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')
  const body = await c.req.parseBody()
  
  const ids = (Array.isArray(body['ids']) ? body['ids'] : [body['ids']]) as string[]

  const query = isAdmin 
    ? inArray(schema.images.id, ids)
    : and(inArray(schema.images.id, ids), eq(schema.images.uploader_id, userId))

  const images = await db.select().from(schema.images).where(query).all()
  
  if (images.length > 0) {
    await db.delete(schema.images).where(query)
    
    c.executionCtx.waitUntil((async () => {
      for (const img of images) {
        await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/deleteMessage?chat_id=${c.env.CHANNEL_ID}&message_id=${img.channel_msg_id}`)
      }
    })())
  }
  
  return c.redirect('/admin')
})

adminApp.post('/image/:id/delete', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')

  const query = isAdmin 
    ? eq(schema.images.id, id)
    : and(eq(schema.images.id, id), eq(schema.images.uploader_id, userId))
  
  const current = await db.select().from(schema.images).where(query).get()
  if (current) {
    await db.delete(schema.images).where(eq(schema.images.id, id))
    await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/deleteMessage?chat_id=${c.env.CHANNEL_ID}&message_id=${current.channel_msg_id}`)
  }
  return c.redirect('/admin')
})

// 5. Users Dashboard (Admins Only)
adminApp.get('/users', async (c) => {
  if (!c.get('isSuperAdmin')) return c.text('Forbidden: Super admin only', 403)

  const db = drizzle(c.env.DB, { schema })
  const usersList = await db.select().from(schema.users).orderBy(desc(schema.users.created_at)).all()
  const error = c.req.query('error')

  return c.html(
    <>
      {html`<!DOCTYPE html>`}
      <Layout title="Users Dashboard" isSuperAdmin={true} showGallery={String(c.env.ENABLE_GALLERY) === 'true'}>
        {error && (
          <div class="bg-gray-100 border-l-4 border-red-600 p-4 mb-6 text-sm font-bold text-red-600 rounded-none">
            {escapeHtml(error)}
          </div>
        )}
        <h2 class="text-xl font-bold uppercase tracking-wider mb-4">User Management</h2>

      <div class="bg-white border-2 border-black overflow-hidden rounded-none">
        <table class="min-w-full divide-y divide-black border-collapse">
          <thead class="bg-gray-100">
            <tr>
              <th scope="col" class="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider border-r border-black">TG ID</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider border-r border-black">Nickname</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider border-r border-black">Email</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider border-r border-black">Role</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider border-r border-black">Status</th>
              <th scope="col" class="px-6 py-3 text-right text-xs font-bold uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-black">
            {usersList.map((user) => (
              <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-bold border-r border-black">{user.tg_id}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm border-r border-black">{escapeHtml(user.nickname || '')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm border-r border-black">{maskEmail(user.email || '')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm border-r border-black">
                  {user.is_admin ? <span class="bg-black text-white px-2 py-0.5 text-xs font-bold uppercase rounded-none">Admin</span> : <span class="text-gray-500 uppercase text-xs">User</span>}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm border-r border-black">
                  {user.status === 'active' && <span class="bg-black text-white px-2 py-0.5 text-xs font-bold uppercase rounded-none">Active</span>}
                  {user.status === 'pending' && <span class="bg-gray-200 text-black px-2 py-0.5 text-xs font-bold uppercase rounded-none">Pending</span>}
                  {user.status === 'banned' && <span class="bg-red-600 text-white px-2 py-0.5 text-xs font-bold uppercase rounded-none">Banned</span>}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex gap-2 justify-end">
                   {user.is_admin ? (
                     <span class="text-xs text-gray-400 uppercase font-bold">Protected</span>
                   ) : (
                     <form action={`/admin/users/${user.tg_id}/status`} method="post">
                        <select name="status" class="text-sm border border-black bg-white rounded-none p-1 mr-2 outline-none font-bold" onchange="this.form.submit()">
                           <option value="active" selected={user.status === 'active'}>Active</option>
                           <option value="pending" selected={user.status === 'pending'}>Pending</option>
                           <option value="banned" selected={user.status === 'banned'}>Banned</option>
                        </select>
                     </form>
                   )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Layout>
    </>
  )
})

adminApp.post('/users/:id/status', async (c) => {
  if (!c.get('isSuperAdmin')) return c.text('Forbidden: Super admin only', 403)
  const { id } = c.req.param()
  const currentUserId = c.get('userId')
  if (id === currentUserId) return c.redirect('/admin/users?error=Cannot+modify+your+own+status')
  const body = await c.req.parseBody()
  const status = body['status'] as string
  
  if (['active', 'pending', 'banned'].includes(status)) {
    const db = drizzle(c.env.DB, { schema })
    const target = await db.select({ is_admin: schema.users.is_admin }).from(schema.users).where(eq(schema.users.tg_id, id)).get()
    if (target?.is_admin) return c.redirect('/admin/users?error=Cannot+modify+admin+status')
    await db.update(schema.users).set({ status }).where(eq(schema.users.tg_id, id))
  }
  return c.redirect('/admin/users')
})

// 6. Galleries Management
adminApp.get('/groups', async (c) => {
  if (String(c.env.ENABLE_GALLERY) !== 'true') return c.text('Gallery feature is disabled.', 403)
  
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')
  const isSuperAdmin = c.get('isSuperAdmin')

  const query = isAdmin ? undefined : eq(schema.groups.user_id, userId)
  
  // Read page parameters
  const page = parseInt(c.req.query('page') || '1')
  const pageSize = 12
  const offset = (page - 1) * pageSize

  // Get total groups count
  const countQuery = isAdmin 
    ? db.select({ total: count() }).from(schema.groups)
    : db.select({ total: count() }).from(schema.groups).where(eq(schema.groups.user_id, userId))
  const [{ total }] = await countQuery.all()
  const totalPages = Math.ceil(total / pageSize)

  const groupsList = await db.select({
    id: schema.groups.id,
    name: schema.groups.name,
    layout: schema.groups.layout,
    passcode: schema.groups.passcode,
    created_at: schema.groups.created_at,
    imageCount: sql<number>`count(${schema.images.id})`
  })
  .from(schema.groups)
  .leftJoin(schema.images, eq(schema.groups.id, schema.images.group_id))
  .where(query)
  .groupBy(schema.groups.id)
  .orderBy(desc(schema.groups.created_at))
  .limit(pageSize)
  .offset(offset)
  .all()

  return c.html(
    <>
      {html`<!DOCTYPE html>`}
      <Layout title="Gallery Manager" isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} showGallery={true}>
        <div x-data="{ editingGroup: null }">
          <div class="flex items-center justify-between mb-6 border-b border-black pb-6">
            <h2 class="text-xl font-bold uppercase tracking-wider">My Collections</h2>
            <button 
              onclick="document.getElementById('createGroupModal').showModal()"
              class="bg-black text-white border border-black px-4 py-2 text-sm font-bold uppercase hover:bg-zinc-800 transition rounded-none"
            >
              + New Gallery
            </button>
          </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groupsList.map((g) => (
            <div class="bg-white border-2 border-black p-5 flex flex-col gap-4 group rounded-none">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="text-lg font-bold">{escapeHtml(g.name)}</h3>
                  <div class="flex items-center gap-3 mt-1 text-xs text-gray-600">
                    <span>Images: <strong class="text-black">{g.imageCount}</strong></span>
                    <span class="text-gray-300">|</span>
                    <span>Created: {new Date(g.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div class="flex gap-1 md:opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                    <button 
                      x-on:click={`editingGroup = ${JSON.stringify(g)}; $nextTick(() => document.getElementById('editGroupModal').showModal())`}
                      class="p-1.5 text-black hover:bg-gray-100 border border-transparent hover:border-black rounded-none"
                      title="Edit Gallery"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <form action={`/admin/groups/${g.id}/delete`} method="post" onsubmit="return confirm('Delete this gallery? (Images will be kept)')" class="inline">
                       <button type="submit" class="p-1.5 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-600 rounded-none" title="Delete Gallery">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                       </button>
                    </form>
              </div>
            </div>

            <div class="bg-gray-100 p-3 space-y-2 text-sm rounded-none border border-black">
               <div class="flex justify-between">
                  <span class="text-gray-600 italic">Layout</span>
                  <span class="font-bold uppercase text-black">{g.layout}</span>
               </div>
                <div class="flex justify-between">
                   <span class="text-gray-600 italic">Passcode</span>
                   <span class="font-mono bg-white px-1.5 border border-black rounded-none">{g.passcode ? '••••••••' : 'None'}</span>
                </div>
               <div class="flex justify-between items-center mt-2 border-t border-black pt-2">
                  <span class="text-gray-600 italic">Contents</span>
                  <a href={`/admin?gid=${g.id}`} class="text-black hover:underline font-bold text-xs flex items-center gap-1 uppercase">
                    Manage Images
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  </a>
               </div>
               <div class="flex justify-between items-center mt-1">
                  <span class="text-gray-600 italic">Share Link</span>
                  <a href={`/g/${g.id}`} target="_blank" class="text-black hover:underline font-bold text-xs truncate max-w-[150px]">
                    /g/{g.id}
                  </a>
               </div>
            </div>
          </div>
          ))}

          {groupsList.length === 0 && (
            <div class="col-span-full py-20 text-center bg-white border-2 border-dashed border-black rounded-none">
               <p class="text-gray-500 uppercase font-bold">You haven't created any galleries yet.</p>
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div class="mt-8 flex justify-center items-center gap-2">
            {page > 1 && (
              <a href={`/admin/groups?page=${page - 1}`} 
                 class="px-4 py-2 border border-black bg-white text-sm font-bold hover:bg-gray-50 transition rounded-none uppercase">
                Previous
              </a>
            )}
            
            <div class="flex gap-1">
               <span class="px-4 py-2 text-sm text-gray-600 font-medium">
                 Page {page} of {totalPages}
               </span>
            </div>

            {page < totalPages && (
              <a href={`/admin/groups?page=${page + 1}`} 
                 class="px-4 py-2 border border-black bg-white text-sm font-bold hover:bg-gray-50 transition rounded-none uppercase">
                Next
              </a>
            )}
          </div>
        )}

        {/* Create Modal */}
        <dialog id="createGroupModal" class="fixed inset-0 m-auto p-0 border-2 border-black max-w-sm w-full h-fit rounded-none backdrop:bg-black/50 shadow-2xl hidden open:block">
          <div class="bg-white p-6 rounded-none">
            <h3 class="text-lg font-black uppercase mb-4 tracking-wider">Create New Gallery</h3>
            <form action="/admin/groups/create" method="post" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase mb-1">Name</label>
                <input type="text" name="name" required placeholder="My Awesome Trip" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
              </div>
              <div class="grid grid-cols-2 gap-4">
                 <div>
                    <label class="block text-xs font-bold uppercase mb-1">Layout</label>
                    <select name="layout" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none">
                      <option value="grid">Grid (Square)</option>
                      <option value="waterfall">Waterfall</option>
                      <option value="carousel">Carousel</option>
                    </select>
                 </div>
                 <div x-data="{ 
                    generate() {
                      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                      let code = '';
                      for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
                      document.getElementById('passcode-input').value = code;
                    }
                 }">
                    <div class="flex justify-between items-center mb-1">
                      <label class="block text-xs font-bold uppercase">Passcode</label>
                      <button type="button" x-on:click="generate()" class="text-[10px] text-gray-600 hover:text-black font-bold uppercase">Gen</button>
                    </div>
                    <input type="text" name="passcode" id="passcode-input" placeholder="Optional" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                 </div>
              </div>
              <div class="flex justify-end gap-3 mt-6 border-t border-black pt-4">
                 <button type="button" onclick="document.getElementById('createGroupModal').close()" class="px-4 py-2 text-sm text-black border border-black hover:bg-gray-100 rounded-none uppercase font-bold">Cancel</button>
                 <button type="submit" class="px-4 py-2 text-sm bg-black text-white hover:bg-zinc-800 rounded-none uppercase font-bold border border-black">Create</button>
              </div>
            </form>
          </div>
        </dialog>

        {/* Edit Modal */}
        <dialog id="editGroupModal" class="fixed inset-0 m-auto p-0 border-2 border-black max-w-sm w-full h-fit rounded-none backdrop:bg-black/50 shadow-2xl hidden open:block">
          <div class="bg-white p-6 rounded-none">
            <h3 class="text-lg font-black uppercase mb-4 tracking-wider">Edit Gallery</h3>
            <form x-bind:action="editingGroup ? `/admin/groups/${editingGroup.id}/update` : '#'" method="post" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase mb-1">Name</label>
                <input type="text" name="name" required x-bind:value="editingGroup?.name" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
              </div>
              <div class="grid grid-cols-2 gap-4">
                 <div>
                    <label class="block text-xs font-bold uppercase mb-1">Layout</label>
                    <select name="layout" x-bind:value="editingGroup?.layout" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none">
                      <option value="grid">Grid (Square)</option>
                      <option value="waterfall">Waterfall</option>
                      <option value="carousel">Carousel</option>
                    </select>
                 </div>
                 <div x-data="{ 
                    generate() {
                      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                      let code = '';
                      for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
                      document.getElementById('edit-passcode-input').value = code;
                    }
                 }">
                    <div class="flex justify-between items-center mb-1">
                      <label class="block text-xs font-bold uppercase">Passcode</label>
                      <button type="button" x-on:click="generate()" class="text-[10px] text-gray-600 hover:text-black font-bold uppercase">Gen</button>
                    </div>
                    <input type="text" name="passcode" id="edit-passcode-input" x-bind:value="editingGroup?.passcode || ''" placeholder="Optional" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                 </div>
              </div>
              <div class="flex justify-end gap-3 mt-6 border-t border-black pt-4">
                 <button type="button" onclick="document.getElementById('editGroupModal').close()" class="px-4 py-2 text-sm text-black border border-black hover:bg-gray-100 rounded-none uppercase font-bold">Cancel</button>
                 <button type="submit" class="px-4 py-2 text-sm bg-black text-white hover:bg-zinc-800 rounded-none uppercase font-bold border border-black">Save Changes</button>
              </div>
            </form>
          </div>
        </dialog>
          </div>
      </Layout>
    </>
  )
})

adminApp.post('/groups/create', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const body = await c.req.parseBody()
  
  const id = nanoid(8)
  await db.insert(schema.groups).values({
    id,
    user_id: userId,
    name: String(body['name']),
    layout: String(body['layout'] || 'grid'),
    passcode: body['passcode'] ? String(body['passcode']) : null,
    created_at: new Date()
  })
  
  return c.redirect('/admin/groups')
})

adminApp.post('/groups/:id/update', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')
  const body = await c.req.parseBody()

  const query = isAdmin 
    ? eq(schema.groups.id, id)
    : and(eq(schema.groups.id, id), eq(schema.groups.user_id, userId))

  await db.update(schema.groups).set({
    name: String(body['name']),
    layout: String(body['layout']),
    passcode: body['passcode'] ? String(body['passcode']) : null
  }).where(query)
  
  return c.redirect('/admin/groups')
})

adminApp.post('/groups/:id/delete', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')

  const query = isAdmin 
    ? eq(schema.groups.id, id)
    : and(eq(schema.groups.id, id), eq(schema.groups.user_id, userId))

  await db.delete(schema.groups).where(query)
  return c.redirect('/admin/groups')
})

// Profile (Personal Center) Page
adminApp.get('/profile', async (c) => {
  const userId = c.get('userId')
  const isSuperAdmin = c.get('isSuperAdmin')
  const db = drizzle(c.env.DB, { schema })
  const user = await db.select().from(schema.users).where(eq(schema.users.tg_id, userId)).get()
  const error = c.req.query('error')
  const success = c.req.query('success')

  return c.html(
    <>
      {html`<!DOCTYPE html>`}
      <Layout title="Personal Center" isAdmin={user?.is_admin} isSuperAdmin={isSuperAdmin} showGallery={String(c.env.ENABLE_GALLERY) === 'true'}>
        <script dangerouslySetInnerHTML={{ __html: `
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
              alert('Verification code sent successfully! Check your email or Telegram Bot chat.');
            } else {
              alert('Error: ' + data.error);
            }
          }
        ` }} />
        <div class="max-w-md bg-white border-2 border-black p-6 rounded-none">
          <h2 class="text-xl font-black uppercase tracking-wider mb-2 border-b border-black pb-4">Personal Center</h2>
          
          {error && (
            <div class="bg-gray-100 border-l-4 border-red-600 p-3 mb-4 text-xs font-bold text-red-600 rounded-none">
              {escapeHtml(error)}
            </div>
          )}
          {success && (
            <div class="bg-gray-100 border-l-4 border-green-600 p-3 mb-4 text-xs font-bold text-green-600 rounded-none">
              {escapeHtml(success)}
            </div>
          )}

          <div class="space-y-6">
            {/* Account Info */}
            <div class="space-y-2 text-xs">
              <div><span class="font-bold text-gray-500 uppercase">Telegram ID:</span> <span class="font-bold">{user?.tg_id}</span></div>
              <div><span class="font-bold text-gray-500 uppercase">Nickname:</span> <span class="font-bold">{escapeHtml(user?.nickname || '')}</span></div>
              <div><span class="font-bold text-gray-500 uppercase">Registered Email:</span> <span class="font-bold">{escapeHtml(user?.email || 'None')}</span></div>
            </div>

            {/* Nickname Modification Form */}
            <form action="/admin/profile/change-nickname" method="post" class="space-y-4 border-t border-black pt-4">
              <h3 class="text-sm font-black uppercase tracking-wider">Change Nickname</h3>
              <p class="text-xs text-gray-600">Min 4 characters, no special symbols.</p>
              <div>
                <label class="block text-xs font-bold uppercase mb-1">New Nickname</label>
                <div class="flex gap-2">
                  <input type="text" name="nickname" required placeholder="NewNickname" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                  <button type="submit" class="bg-black text-white px-3 py-2 text-xs font-bold uppercase hover:bg-zinc-800 rounded-none border border-black whitespace-nowrap">
                    Update
                  </button>
                </div>
              </div>
            </form>

            {/* Email Setup / Verification Form */}
            <form action="/admin/profile/update-email" method="post" class="space-y-4 border-t border-black pt-4">
              <h3 class="text-sm font-black uppercase tracking-wider">Change / Setup Email</h3>
              
              <div>
                <label class="block text-xs font-bold uppercase mb-1">New Email</label>
                <input type="email" id="profile-email-input" name="email" required placeholder="name@domain.com" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
              </div>

              <div>
                <label class="block text-xs font-bold uppercase mb-1">Verification Code</label>
                <div class="flex gap-2">
                  <input type="text" name="code" required placeholder="123456" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none text-center font-bold focus:ring-0 focus:border-zinc-500" />
                  <button type="button" onclick="sendProfileCode()" class="bg-black text-white px-3 py-2 text-xs font-bold uppercase hover:bg-zinc-800 rounded-none border border-black whitespace-nowrap">
                    Send Code
                  </button>
                </div>
              </div>

              <button type="submit" class="w-full bg-black text-white py-2 text-sm font-bold uppercase hover:bg-zinc-800 rounded-none border border-black">
                Update Email
              </button>
            </form>

            {/* Password Modification Form */}
            <form action="/admin/profile/change-password" method="post" class="space-y-4 border-t border-black pt-4">
              <h3 class="text-sm font-black uppercase tracking-wider">
                {user?.password_hash ? 'Change Password' : 'Set Password'}
              </h3>
              {user?.password_hash && (
                <div>
                  <label class="block text-xs font-bold uppercase mb-1">Current Password</label>
                  <div class="relative flex items-stretch">
                    <input type="password" id="profile-current-password" name="current_password" required placeholder="••••••••" class="w-full bg-white border border-black pl-3 pr-10 py-2 text-sm outline-none rounded-none focus:ring-0" />
                    <button type="button" onclick="const input = document.getElementById('profile-current-password'); input.type = input.type === 'password' ? 'text' : 'password';" class="absolute inset-y-0 right-0 px-3 flex items-center text-sm hover:bg-gray-100 border-l border-black cursor-pointer">
                      👁️
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label class="block text-xs font-bold uppercase mb-1">New Password (Min 8 characters)</label>
                <div class="relative flex items-stretch">
                  <input type="password" id="profile-new-password" name="new_password" required placeholder="••••••••" class="w-full bg-white border border-black pl-3 pr-10 py-2 text-sm outline-none rounded-none focus:ring-0" />
                  <button type="button" onclick="const input = document.getElementById('profile-new-password'); input.type = input.type === 'password' ? 'text' : 'password';" class="absolute inset-y-0 right-0 px-3 flex items-center text-sm hover:bg-gray-100 border-l border-black cursor-pointer">
                    👁️
                  </button>
                </div>
              </div>
              <button type="submit" class="w-full bg-black text-white py-2 text-sm font-bold uppercase hover:bg-zinc-800 rounded-none border border-black">
                {user?.password_hash ? 'Update Password' : 'Set Password'}
              </button>
            </form>
          </div>
        </div>
      </Layout>
    </>
  )
})

// Profile Action Endpoints
adminApp.post('/profile/change-nickname', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.parseBody()
  const nickname = String(body['nickname'] || '').trim()

  // Validate nickname: at least 4 chars, only alphanumeric, underscores, Chinese characters
  const nicknameRegex = /^[a-zA-Z0-9_\u4e00-\u9fa5]{4,32}$/
  if (!nicknameRegex.test(nickname)) {
    return c.redirect('/admin/profile?error=Nickname+must+be+at+least+4+characters+and+contain+no+special+symbols')
  }

  const db = drizzle(c.env.DB, { schema })
  await db.update(schema.users).set({
    nickname
  }).where(eq(schema.users.tg_id, userId))

  return c.redirect('/admin/profile?success=Nickname+updated+successfully')
})

adminApp.post('/api/auth/send-code-profile', async (c) => {
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

adminApp.post('/profile/update-email', async (c) => {
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

adminApp.post('/profile/change-password', async (c) => {
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

// Web Image Upload API
adminApp.post('/upload-api', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  
  const body = await c.req.parseBody()
  const file = body['file'] as File
  const caption = String(body['caption'] || '').trim()
  const groupId = body['group_id'] ? String(body['group_id']) : null

  if (!file || file.size === 0) {
    return c.json({ success: false, error: 'No file uploaded' }, 400)
  }

  const MAX_FILE_SIZE = 20 * 1024 * 1024
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ success: false, error: 'File too large. Max 20MB.' }, 400)
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml']
  if (!allowedTypes.includes(file.type)) {
    return c.json({ success: false, error: 'Invalid file type. Only images are allowed.' }, 400)
  }

  try {
    // 1. Prepare FormData to send to Telegram Bot sendPhoto API
    const formData = new FormData()
    formData.append('chat_id', c.env.CHANNEL_ID)
    formData.append('photo', file)
    if (caption) {
      formData.append('caption', caption)
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: formData
    })

    const tgData = await tgRes.json() as any
    if (!tgRes.ok || !tgData.ok) {
      console.error('Telegram upload failed:', tgData)
      return c.json({ success: false, error: tgData.description || 'Telegram upload failed' }, 500)
    }

    // 2. Extract tg_file_id and channel_msg_id
    const messageId = tgData.result.message_id
    const photoArray = tgData.result.photo
    const bestPhoto = photoArray[photoArray.length - 1]
    const tgFileId = bestPhoto.file_id

    // 3. Save info to D1 Database
    const id = nanoid(8)
    await db.insert(schema.images).values({
      id,
      tg_file_id: tgFileId,
      channel_msg_id: messageId,
      uploader_id: userId,
      is_public: true,
      caption: caption || null,
      group_id: groupId,
      created_at: new Date()
    })

    const baseUrl = c.env.BASE_URL.replace(/\/$/, '')
    const url = `${baseUrl}/file/${tgFileId}.jpg`

    return c.json({ success: true, id, url })
  } catch (err: any) {
    console.error('Web upload error:', err)
    return c.json({ success: false, error: err.message }, 500)
  }
})

export default adminApp
