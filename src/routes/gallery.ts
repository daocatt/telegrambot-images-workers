import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, count } from 'drizzle-orm'
import { EnvBindings } from '../bot/context'
import { escapeHtml, timingSafeEqual } from '../web/utils'

const galleryApp = new Hono<{ Bindings: EnvBindings }>()

galleryApp.get('/g/:id', async (c) => {
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

galleryApp.post('/g/:id/auth', async (c) => {
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

export default galleryApp
