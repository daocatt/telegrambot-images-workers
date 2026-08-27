import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { webhookCallback } from 'grammy'
import { createBot } from './bot'
import { EnvBindings } from './bot/context'
import adminApp from './web/admin'
import fileApp from './routes/file'
import galleryApp from './routes/gallery'
import { landingHtml } from './web/templates/landing'

const app = new Hono<{ Bindings: EnvBindings }>()

// Global CORS support for diverse custom domains
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => origin,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    credentials: true,
  })
  return corsMiddleware(c, next)
})

// Submodule routes
app.route('/admin', adminApp)
app.route('/', fileApp)
app.route('/', galleryApp)

// Home Landing Page
app.get('/', (c) => {
  const botName = c.env.TELEGRAM_BOT_NAME || '@snapflare_bot'
  const botUsername = botName.startsWith('@') ? botName.slice(1) : botName
  const botLink = `https://t.me/${botUsername}`

  const backgrounds = [
    'https://images.unsplash.com/photo-1508193638397-1c4234db14d8?q=80&w=1600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1528164344705-47542687000d?q=80&w=1600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1548013146-72479768bbf4?q=80&w=1600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1523731407965-2430cd12f5e4?q=80&w=1600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1504609773096-104ff2c73ba4?q=80&w=1600&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1589308078059-be1415eab4c3?q=80&w=1600&auto=format&fit=crop'
  ]
  const randomBg = backgrounds[Math.floor(Math.random() * backgrounds.length)]

  const renderedHtml = landingHtml
    .replace('__RANDOM_BG__', randomBg)
    .replace('__BOT_LINK__', botLink)
    .replace('__BOT_NAME__', botName)

  return c.html(renderedHtml)
})

// Telegram Webhook Route
app.post('/webhook/:path_secret', async (c) => {
  const pathSecret = c.req.param('path_secret')
  if (pathSecret !== c.env.WEBHOOK_PATH_SECRET) {
    return c.text('Unauthorized', 401)
  }

  // Validate Telegram Secret Token (for defense in depth)
  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  if (secretToken !== c.env.WEBHOOK_SECRET) {
    return c.text('Unauthorized', 401)
  }

  try {
    const bot = createBot(c.env as any)
    return await webhookCallback(bot, 'hono')(c as any)
  } catch (err: any) {
    console.error('Webhook error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// Webhook setup helper (Optional admin route to set it up easily via curl)
app.get('/setWebhook', async (c) => {
  const secretToken = c.req.query('admin_secret')
  if (secretToken !== c.env.WEBHOOK_SECRET) {
    return c.text('Unauthorized', 401)
  }
  const base = c.env.WEBHOOK_URL || c.env.BASE_URL || new URL(c.req.url).origin
  const url = `${base.replace(/\/$/, '')}/webhook/${c.env.WEBHOOK_PATH_SECRET}`
  const response = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}&secret_token=${c.env.WEBHOOK_SECRET}`)
  const result = await response.json()
  return c.json(result)
})

export default app
