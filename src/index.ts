import { Hono } from 'hono'
import { webhookCallback } from 'grammy'
import { createBot } from './bot'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './db/schema'
import { eq } from 'drizzle-orm'
import adminApp from './web/admin'
type Bindings = {
  DB: D1Database;
  BOT_TOKEN: string;
  CHANNEL_ID: string;
  ACCESS_MODE: string; // "single" | "multi"
  WEBHOOK_SECRET: string;
  WEBHOOK_PATH_SECRET: string;
  BASE_URL: string;
  ADMIN_URL?: string;
  WEBHOOK_URL?: string;
  ENABLE_PUBLIC_CHECK?: string; // "true" or "false"
}

const app = new Hono<{ Bindings: Bindings }>()

app.route('/admin', adminApp)

app.get('/', (c) => {
  return c.text('Telegram Bot Image Manager API is running.')
})

// Webhook Route
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
    const bot = createBot(c.env)
    return await webhookCallback(bot, 'hono')(c)
  } catch (err: any) {
    console.error('Webhook error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// Helper to proxy image from Telegram
async function proxyImageFromTelegram(c: any, tgFileId: string, imageId?: string) {
  // 1. Ask Telegram for the file_path via tg_file_id
  const fileParamsResponse = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/getFile?file_id=${tgFileId}`)
  const fileParams: any = await fileParamsResponse.json()

  // Industrial Security: Handle missing files with 404 and Negative Caching
  if (!fileParams.ok) {
    // Link health sync: If file is missing on TG, mark it broken in D1
    // We do this by ID (if provided) or by searching for the tgFileId
    const db = drizzle(c.env.DB, { schema })
    c.executionCtx.waitUntil((async () => {
      try {
        if (imageId) {
          await db.update(schema.images).set({ is_broken: true }).where(eq(schema.images.id, imageId))
        } else {
          await db.update(schema.images).set({ is_broken: true }).where(eq(schema.images.tg_file_id, tgFileId))
        }
      } catch (e) {
        console.error('[DB Sync Error] Failed to mark image as broken:', e)
      }
    })());

    return new Response('Image not found on Telegram servers.', { 
      status: 404,
      headers: {
        'Cache-Control': 'public, max-age=3600' // Cache 404 for 1 hour
      }
    })
  }

  // 2. Download the actual binary stream from Telegram
  const filePath = fileParams.result.file_path
  const fileStreamResponse = await fetch(`https://api.telegram.org/file/bot${c.env.BOT_TOKEN}/${filePath}`)

  if (!fileStreamResponse.ok) return c.text('Failed to stream file from Telegram', 502)

  // 3. Return to the browser with correct headers (cache + content-type)
  const headers = new Headers(fileStreamResponse.headers)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable') // Cache for 1 year
  
  return new Response(fileStreamResponse.body, { headers })
}

// Image Serving Route (Native ID)
app.get('/img/:filename', async (c) => {
  const cache = caches.default
  const cacheKey = new Request(c.req.url, c.req.raw)
  
  // 1. Try Cache API first
  const cachedResponse = await cache.match(cacheKey)
  if (cachedResponse) {
    return cachedResponse
  }

  const { filename } = c.req.param()
  const id = filename.split('.')[0]
  
  const db = drizzle(c.env.DB, { schema })
  const image = await db.select().from(schema.images).where(eq(schema.images.id, id)).get()

  if (!image) return c.text('Image not found', 404)
  if (!image.is_public) return c.text('Access denied', 403)
  
  // Strategy: If already marked broken, return 404 immediately
  if (image.is_broken) {
    const brokenRes = new Response('Image is marked as broken (missing on source).', { 
      status: 404,
      headers: { 'Cache-Control': 'public, max-age=86400' } 
    })
    c.executionCtx.waitUntil(cache.put(cacheKey, brokenRes.clone()))
    return brokenRes
  }

  const response = await proxyImageFromTelegram(c, image.tg_file_id, id)
  
  // 2. Put back into Cache API for future requests if successful
  if (response.ok) {
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
  }
  
  return response
})

// Compatibility Route for telegraph-images
app.get('/file/:filename', async (c) => {
  const cache = caches.default
  const cacheKey = new Request(c.req.url, c.req.raw)
  
  const cachedResponse = await cache.match(cacheKey)
  if (cachedResponse) return cachedResponse

  const { filename } = c.req.param()
  const tgFileId = filename.split('.')[0]
  
  if (!tgFileId) return c.text('Invalid file ID', 400)
  
  // Optional Security Check: Query D1 for is_public status
  if (c.env.ENABLE_PUBLIC_CHECK === 'true') {
    const db = drizzle(c.env.DB, { schema })
    const image = await db.select({ is_public: schema.images.is_public }).from(schema.images).where(eq(schema.images.tg_file_id, tgFileId)).get()
    
    // If record exists and is private, deny access
    if (image && !image.is_public) {
      return c.text('Access denied: image is private.', 403)
    }
  }

  const response = await proxyImageFromTelegram(c, tgFileId)

  if (response.ok || response.status === 404) {
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
  }

  return response
})

// Webhook setup helper (Optional admin route to set it up easily via curl)
app.get('/setWebhook', async (c) => {
  const base = c.env.WEBHOOK_URL || c.env.BASE_URL || new URL(c.req.url).origin
  const url = `${base.replace(/\/$/, '')}/webhook/${c.env.WEBHOOK_PATH_SECRET}`
  const response = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/setWebhook?url=${url}&secret_token=${c.env.WEBHOOK_SECRET}`)
  const result = await response.json()
  return c.json(result)
})

export default app
