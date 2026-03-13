import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { webhookCallback } from 'grammy'
import { getCookie, setCookie } from 'hono/cookie'
import { createBot } from './bot'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './db/schema'
import { eq, count } from 'drizzle-orm'
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
  ENABLE_GALLERY?: string;
}

const app = new Hono<{ Bindings: Bindings }>()

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
    const bot = createBot(c.env as any)
    return await webhookCallback(bot, 'hono')(c as any)
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

  // SOCIAL MEDIA PREVIEW BLACK MAGIC:
  // Detect if requested by a human browser or social media bot (instead of an <img> tag)
  const userAgent = c.req.header('User-Agent') || ''
  const accept = c.req.header('Accept') || ''
  const isBrowser = accept.includes('text/html') || userAgent.includes('TelegramBot') || userAgent.includes('Twitterbot') || userAgent.includes('facebookexternalhit')

  if (isBrowser) {
    const imageUrl = `${new URL(c.req.url).origin}/file/${image.tg_file_id}.jpg`
    const siteTitle = "Telegram Image Host"
    const description = image.caption || "Shared via Telegram Image Manager"
    
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${description} - ${siteTitle}</title>
          <!-- Open Graph / Facebook -->
          <meta property="og:type" content="website">
          <meta property="og:title" content="${description}">
          <meta property="og:description" content="View this image on ${siteTitle}">
          <meta property="og:image" content="${imageUrl}">
          <!-- Twitter -->
          <meta property="twitter:card" content="summary_large_image">
          <meta property="twitter:title" content="${description}">
          <meta property="twitter:image" content="${imageUrl}">
          <style>
            body { margin: 0; background: #0b0e11; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: sans-serif; }
            img { max-width: 90vw; max-height: 90vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .info { position: absolute; bottom: 20px; color: white; background: rgba(0,0,0,0.6); padding: 10px 20px; border-radius: 20px; backdrop-filter: blur(5px); }
          </style>
        </head>
        <body>
          <img src="${imageUrl}" alt="${description}">
          ${image.caption ? `<div class="info">${image.caption}</div>` : ''}
        </body>
      </html>
    `)
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

// === GALLERY SYSTEM (Collections) ===
app.get('/g/:id', async (c) => {
  if (c.env.ENABLE_GALLERY !== 'true') return c.text('Gallery feature is disabled.', 403)
  
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })
  const group = await db.select().from(schema.groups).where(eq(schema.groups.id, id)).get()
  
  if (!group) return c.text('Gallery not found', 404)

  // 1. Passcode Check
  if (group.passcode) {
    const authCookie = getCookie(c, `gallery_auth_${id}`)
    if (authCookie !== group.passcode) {
       // Return Password Form
       return c.html(`
         <!DOCTYPE html>
         <html lang="en">
           <head>
             <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
             <title>Locked Gallery - ${group.name}</title>
             <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
           </head>
           <body class="bg-gray-900 text-white flex items-center justify-center min-h-screen">
             <div class="p-8 bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm text-center border border-gray-700">
               <div class="mb-6 inline-flex p-4 bg-gray-700 rounded-full text-yellow-400">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
               </div>
               <h1 class="text-2xl font-bold mb-2">${group.name}</h1>
               <p class="text-gray-400 text-sm mb-6">This collection is password protected.</p>
               <form action="/g/${id}/auth" method="post" class="space-y-4">
                 <input type="password" name="passcode" autofocus required placeholder="Enter Passcode" class="w-full bg-gray-700 border-none rounded-xl px-4 py-3 text-center text-lg tracking-[0.5em] focus:ring-2 focus:ring-blue-500 outline-none" />
                 <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95">Unlock Collection</button>
               </form>
             </div>
           </body>
         </html>
       `)
    }
  }

  // 2. Fetch Images
  const images = await db.select().from(schema.images).where(eq(schema.images.group_id, id)).orderBy(schema.images.sort_order).all()

  // 3. Render Gallery
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${group.name} - Web Gallery</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <!-- PhotoSwipe Lightbox -->
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/photoswipe@5.3.7/dist/photoswipe.css">
        <style>
          .waterfall { columns: 2; column-gap: 1rem; }
          @media (min-width: 768px) { .waterfall { columns: 3; } }
          @media (min-width: 1024px) { .waterfall { columns: 4; } }
          .waterfall-item { break-inside: avoid; margin-bottom: 1rem; }
          
          .carousel { display: flex; overflow-x: auto; snap-type: x mandatory; gap: 1rem; padding: 1rem; border-radius: 1rem; scrollbar-width: none; }
          .carousel::-webkit-scrollbar { display: none; }
          .carousel-item { flex: 0 0 calc(100% - 2rem); snap-align: center; }
          @media (min-width: 768px) { .carousel-item { flex: 0 0 45%; } }
        </style>
      </head>
      <body class="bg-gray-50 text-gray-900 min-h-screen">
        <header class="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b">
           <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
              <h1 class="text-xl font-bold truncate pr-4">${group.name}</h1>
              <span class="text-xs font-medium bg-gray-100 px-2.5 py-1 rounded-full text-gray-500">${images.length} Photos</span>
           </div>
        </header>

        <main class="max-w-7xl mx-auto p-4 md:p-8">
           <div id="gallery-container" class="${
             group.layout === 'waterfall' ? 'waterfall' : 
             group.layout === 'carousel' ? 'carousel' : 
             'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4'
           }">
             ${images.map(img => `
               <a href="/file/${img.tg_file_id}.jpg" 
                  class="${group.layout === 'waterfall' ? 'waterfall-item' : group.layout === 'carousel' ? 'carousel-item' : ''} block group overflow-hidden rounded-xl bg-gray-200 aspect-[4/5] relative"
                  data-pswp-width="1200" 
                  data-pswp-height="1600"
                  target="_blank">
                  <img src="/file/${img.tg_file_id}.jpg" 
                       loading="lazy" 
                       class="w-full h-full object-cover transition duration-500 group-hover:scale-110" 
                       alt="${img.caption || ''}" />
                  ${img.caption ? `
                    <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                       <p class="text-white text-xs font-medium truncate">${img.caption}</p>
                    </div>
                  ` : ''}
               </a>
             `).join('')}
           </div>
        </main>

        <footer class="py-12 text-center text-gray-400 text-sm">
           当你决定做自己时，美丽就开始了
        </footer>

        <script type="module">
          import PhotoSwipeLightbox from 'https://cdn.jsdelivr.net/npm/photoswipe@5.3.7/dist/photoswipe-lightbox.esm.js';
          const lightbox = new PhotoSwipeLightbox({
            gallery: '#gallery-container',
            children: 'a',
            pswpModule: () => import('https://cdn.jsdelivr.net/npm/photoswipe@5.3.7/dist/photoswipe.esm.js')
          });
          lightbox.init();
        </script>
      </body>
    </html>
  `)
})

app.post('/g/:id/auth', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.parseBody()
  const passcode = String(body['passcode'])

  const db = drizzle(c.env.DB, { schema })
  const group = await db.select().from(schema.groups).where(eq(schema.groups.id, id)).get()

  if (group && group.passcode === passcode) {
    setCookie(c, `gallery_auth_${id}`, passcode, {
      path: '/',
      maxAge: 3600 * 24 * 7, // 7 days
      secure: true,
      httpOnly: true,
      sameSite: 'Lax'
    })
    return c.redirect(`/g/${id}`)
  }

  return c.text('Invalid passcode', 401)
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
