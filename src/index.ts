import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { webhookCallback } from 'grammy'
import { getCookie, setCookie } from 'hono/cookie'
import { createBot } from './bot'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './db/schema'
import { eq, count, sql } from 'drizzle-orm'
import adminApp from './web/admin'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

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
  TELEGRAM_BOT_NAME?: string;
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

  return c.html(`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Image Host - Telegram Bot Service</title>
        <style>
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans CN", monospace;
            background: #f3f4f6;
            color: #000000;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
          }
          .bg-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('${randomBg}');
            background-size: cover;
            background-position: center;
            filter: brightness(0.6) contrast(1.05);
            z-index: 1;
            transition: filter 0.5s ease;
          }
          .container {
            position: relative;
            z-index: 10;
            width: 90%;
            max-width: 460px;
            padding: 2.5rem 2rem;
            background: #ffffff;
            color: #000000;
            border: 3px solid #000000;
            border-radius: 0;
            box-shadow: 8px 8px 0px #000000;
            text-align: center;
            animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .logo-wrapper {
            margin-bottom: 1.5rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 64px;
            height: 64px;
            background: #000000;
            border: 2px solid #000000;
            border-radius: 0;
            box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.15);
          }
          .logo-icon {
            width: 32px;
            height: 32px;
            fill: #ffffff;
          }
          h1 {
            font-size: 1.75rem;
            font-weight: 900;
            margin-bottom: 0.5rem;
            letter-spacing: -0.5px;
            text-transform: uppercase;
          }
          .subtitle {
            font-size: 0.95rem;
            color: #4b5563;
            margin-bottom: 2rem;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .info-box {
            background: #f9fafb;
            border: 1px solid #000000;
            padding: 1.25rem 1rem;
            border-radius: 0;
            margin-bottom: 2rem;
            font-size: 0.9rem;
            line-height: 1.6;
            color: #000000;
            text-align: left;
          }
          .info-box p {
            margin-bottom: 0.5rem;
            font-weight: 500;
          }
          .info-box p:last-child {
            margin-bottom: 0;
          }
          .bullet {
            color: #000000;
            margin-right: 6px;
            font-weight: 900;
          }
          .btn-cta {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 1rem;
            background: #000000;
            color: #ffffff;
            font-weight: 800;
            font-size: 1rem;
            text-decoration: none;
            border-radius: 0;
            border: 2px solid #000000;
            box-shadow: 4px 4px 0px #000000;
            transition: all 0.2s ease;
            margin-bottom: 1.25rem;
            cursor: pointer;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .btn-cta:hover {
            background: #1f2937;
            transform: translate(-2px, -2px);
            box-shadow: 6px 6px 0px #000000;
          }
          .btn-cta:active {
            transform: translate(0, 0);
            box-shadow: 2px 2px 0px #000000;
          }
          .btn-cta svg {
            margin-right: 8px;
            width: 20px;
            height: 20px;
          }
          .footer-links {
            display: flex;
            justify-content: center;
            gap: 1.5rem;
            font-size: 0.85rem;
          }
          .footer-links a {
            color: #000000;
            text-decoration: underline;
            font-weight: bold;
            transition: opacity 0.2s ease;
          }
          .footer-links a:hover {
            opacity: 0.8;
          }
        </style>
      </head>
      <body>
        <div class="bg-overlay"></div>
        <div class="container">
          <div class="logo-wrapper">
            <svg class="logo-icon" viewBox="0 0 24 24">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0-2-.9-2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
          </div>
          <h1>📷 SnapFlare</h1>
          <div class="subtitle">Telegram 智能图床服务</div>
          
          <div class="info-box">
            <p><span class="bullet">■</span> 关注 Telegram 机器人即可开始使用</p>
            <p><span class="bullet">■</span> 发送图片至 Bot 即可立即生成高速外链</p>
            <p><span class="bullet">■</span> 自动接入 D1 与 CDN，享受极速访问体验</p>
          </div>

          <a href="${botLink}" target="_blank" rel="noopener noreferrer" class="btn-cta">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.24-5.54 3.65-.52.36-.97.53-1.33.52-.4-.01-1.17-.23-1.74-.41-.7-.23-1.26-.35-1.21-.74.03-.2.3-.41.82-.62 3.18-1.38 5.3-2.29 6.36-2.73 3.02-1.26 3.65-1.48 4.06-1.49.09 0 .29.02.42.13.11.09.14.21.15.3-.01.08-.01.17-.02.2z"/>
            </svg>
            关注 ${botName}
          </a>

          <div class="footer-links">
            <a href="/admin">管理后台 (Admin Console)</a>
          </div>
        </div>
      </body>
    </html>
  `)
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
    const error = c.req.query('error')
    if (!authCookie || !timingSafeEqual(authCookie, group.passcode)) {
       const safeName = escapeHtml(group.name)
       const errorAlert = error ? `
          <div class="bg-gray-100 border-l-4 border-black p-3 mb-4 text-xs font-bold text-red-600 rounded-none text-left">
             ${escapeHtml(error)}
          </div>
       ` : '';
       return c.html(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Locked Gallery - ${safeName}</title>
              <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
            </head>
            <body class="bg-gray-100 text-black flex items-center justify-center min-h-screen font-mono">
              <div class="p-8 bg-white border-2 border-black max-w-sm w-full text-center rounded-none shadow-md">
                <div class="mb-4 inline-flex p-3 bg-gray-100 border border-black text-black">
                   <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                </div>
                <h1 class="text-xl font-black uppercase mb-1 tracking-wider">${safeName}</h1>
                <p class="text-gray-500 text-xs mb-6">This collection is password protected.</p>
                
                ${errorAlert}
                
                <form action="/g/${encodeURIComponent(id)}/auth" method="post" class="space-y-4">
                  <div class="relative flex items-stretch">
                    <input type="password" id="gallery-passcode" name="passcode" autofocus required placeholder="Passcode" class="w-full bg-white border border-black pl-3 pr-10 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500 text-center" />
                    <button type="button" onclick="const input = document.getElementById('gallery-passcode'); input.type = input.type === 'password' ? 'text' : 'password';" class="absolute inset-y-0 right-0 px-3 flex items-center text-sm hover:bg-gray-100 border-l border-black cursor-pointer">
                      👁️
                    </button>
                  </div>
                  <button type="submit" class="w-full bg-black text-white py-2 text-sm font-bold uppercase tracking-wider hover:bg-zinc-800 transition rounded-none border border-black cursor-pointer">Unlock Collection</button>
                </form>
              </div>
            </body>
          </html>
        `)
     }
  }

  // 2. Fetch Images
  const page = Math.max(1, Math.min(parseInt(c.req.query('page') || '1') || 1, 1000))
  const pageSize = 24
  const offset = (page - 1) * pageSize

  // Fetch count
  const [{ totalImages }] = await db.select({ totalImages: count() }).from(schema.images).where(eq(schema.images.group_id, id)).all()
  const totalPages = Math.ceil(totalImages / pageSize)

  const images = await db.select().from(schema.images).where(eq(schema.images.group_id, id)).orderBy(schema.images.sort_order).limit(pageSize).offset(offset).all()

  const safeGroupName = escapeHtml(group.name)
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${safeGroupName} - Web Gallery</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
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
              <h1 class="text-xl font-bold truncate pr-4">${safeGroupName}</h1>
              <span class="text-xs font-medium bg-gray-100 px-2.5 py-1 rounded-full text-gray-500">${totalImages} Photos</span>
           </div>
        </header>

        <main class="max-w-7xl mx-auto p-4 md:p-8">
           <div id="gallery-container" class="${
             group.layout === 'waterfall' ? 'waterfall' : 
             group.layout === 'carousel' ? 'carousel' : 
             'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4'
           }">
             ${images.map(img => {
               const safeCaption = escapeHtml(img.caption || '')
               return `
                <a href="/file/${encodeURIComponent(img.tg_file_id)}.jpg" 
                   class="${group.layout === 'waterfall' ? 'waterfall-item' : group.layout === 'carousel' ? 'carousel-item' : ''} block group overflow-hidden rounded-xl bg-gray-200 aspect-[4/5] relative"
                   data-pswp-width="1200" 
                   data-pswp-height="1600"
                   target="_blank">
                   <img src="/file/${encodeURIComponent(img.tg_file_id)}.jpg" 
                        loading="lazy" 
                        class="w-full h-full object-cover transition duration-500 group-hover:scale-110" 
                        alt="${safeCaption}" />
                   ${img.caption ? `
                     <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                        <p class="text-white text-xs font-medium truncate">${safeCaption}</p>
                     </div>
                   ` : ''}
                </a>
              `}).join('')}
           </div>

           <!-- Pagination Controls -->
           ${totalPages > 1 ? `
             <div class="mt-12 flex justify-center items-center gap-4">
               ${page > 1 ? `
                 <a href="/g/${encodeURIComponent(id)}?page=${page - 1}" class="px-5 py-2.5 bg-white border border-gray-200 rounded-full text-sm font-semibold hover:bg-gray-100 transition shadow-sm text-black">
                   ← Previous
                 </a>
               ` : ''}
               <span class="text-sm font-medium text-gray-500">
                 Page ${page} of ${totalPages}
               </span>
               ${page < totalPages ? `
                 <a href="/g/${encodeURIComponent(id)}?page=${page + 1}" class="px-5 py-2.5 bg-white border border-gray-200 rounded-full text-sm font-semibold hover:bg-gray-100 transition shadow-sm text-black">
                   Next →
                 </a>
               ` : ''}
             </div>
           ` : ''}
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
  const passcode = String(body['passcode'] || '')

  const db = drizzle(c.env.DB, { schema })
  const group = await db.select().from(schema.groups).where(eq(schema.groups.id, id)).get()

  if (group && group.passcode && timingSafeEqual(group.passcode, passcode)) {
    setCookie(c, `gallery_auth_${id}`, group.passcode, {
      path: '/',
      maxAge: 3600 * 24 * 7,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax'
    })
    return c.redirect(`/g/${encodeURIComponent(id)}`)
  }

  return c.redirect(`/g/${encodeURIComponent(id)}?error=Invalid+passcode`)
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
