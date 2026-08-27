import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq } from 'drizzle-orm'
import { EnvBindings } from '../bot/context'
import { escapeHtml } from '../web/utils'

const fileApp = new Hono<{ Bindings: EnvBindings }>()

export async function proxyImageFromTelegram(c: any, tgFileId: string, imageId?: string) {
  // 1. Ask Telegram for the file_path via tg_file_id
  const fileParamsResponse = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/getFile?file_id=${tgFileId}`)
  const fileParams: any = await fileParamsResponse.json()

  // Industrial Security: Handle missing files with 404 and Negative Caching
  if (!fileParams.ok) {
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
fileApp.get('/img/:filename', async (c) => {
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

  // SOCIAL MEDIA PREVIEW:
  const userAgent = c.req.header('User-Agent') || ''
  const accept = c.req.header('Accept') || ''
  const isBrowser = accept.includes('text/html') || userAgent.includes('TelegramBot') || userAgent.includes('Twitterbot') || userAgent.includes('facebookexternalhit')

  if (isBrowser) {
    const imageUrl = `${new URL(c.req.url).origin}/file/${image.tg_file_id}.jpg`
    const siteTitle = "Telegram Image Host"
    const description = image.caption || "Shared via Telegram Image Manager"
    const safeDescription = escapeHtml(description)
    const safeCaption = image.caption ? escapeHtml(image.caption) : ''
    
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${safeDescription} - ${siteTitle}</title>
          <meta property="og:type" content="website">
          <meta property="og:title" content="${safeDescription}">
          <meta property="og:description" content="View this image on ${siteTitle}">
          <meta property="og:image" content="${imageUrl}">
          <meta property="twitter:card" content="summary_large_image">
          <meta property="twitter:title" content="${safeDescription}">
          <meta property="twitter:image" content="${imageUrl}">
          <style>
            body { margin: 0; background: #0b0e11; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; }
            img { max-width: 90vw; max-height: 90vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .info { position: absolute; bottom: 20px; color: white; background: rgba(0,0,0,0.6); padding: 10px 20px; border-radius: 20px; backdrop-filter: blur(5px); }
          </style>
        </head>
        <body>
          <img src="${imageUrl}" alt="${safeDescription}">
          ${safeCaption ? `<div class="info">${safeCaption}</div>` : ''}
        </body>
      </html>
    `)
  }

  const response = await proxyImageFromTelegram(c, image.tg_file_id, id)
  
  if (response.ok) {
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
  }
  
  return response
})

// Compatibility Route for /file/:filename
fileApp.get('/file/:filename', async (c) => {
  const cache = caches.default
  const cacheKey = new Request(c.req.url, c.req.raw)
  
  const cachedResponse = await cache.match(cacheKey)
  if (cachedResponse) return cachedResponse

  const { filename } = c.req.param()
  const tgFileId = filename.split('.')[0]
  
  if (!tgFileId) return c.text('Invalid file ID', 400)
  
  if (c.env.ENABLE_PUBLIC_CHECK === 'true') {
    const db = drizzle(c.env.DB, { schema })
    const image = await db.select({ is_public: schema.images.is_public }).from(schema.images).where(eq(schema.images.tg_file_id, tgFileId)).get()
    
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

export default fileApp
