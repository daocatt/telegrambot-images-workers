import { Hono } from 'hono'
import { html } from 'hono/html'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, desc, and, like, count, sql, inArray } from 'drizzle-orm'
import { EnvBindings } from '../bot/context'

type ContextEnv = {
  Bindings: EnvBindings;
  Variables: {
    userId: string;
    isAdmin: boolean;
  }
}

const adminApp = new Hono<ContextEnv>()

// Pro-level CORS: Dynamically allow the request's origin to support any custom domains
adminApp.use('*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))



// Template wrapper
const Layout = (props: { title: string; isAdmin?: boolean; showGallery?: boolean; children: any }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
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
      <body class="bg-gray-50 text-gray-900 min-h-screen">
        <header class="bg-white shadow sticky top-0 z-30">
          <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center gap-2">
            <h1 class="text-lg md:text-2xl font-bold text-gray-900 truncate">
              <span class="hidden md:inline">📷 Telegram Image Manager</span>
              <span class="md:hidden">📷 Img Manager</span>
            </h1>
            <nav class="flex items-center space-x-3 md:space-x-4 overflow-x-auto no-scrollbar py-1">
              <a href="/admin" class="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap text-sm md:text-base">Images</a>
              {props.isAdmin && (
                <a href="/admin/users" class="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap text-sm md:text-base">Users</a>
              )}
              {props.showGallery && (
                <a href="/admin/groups" class="text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap text-sm md:text-base">Gallery</a>
              )}
              <a href="/admin/logout" class="text-red-600 hover:text-red-900 font-medium whitespace-nowrap text-sm md:text-base">Logout</a>
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

// 1. Auth Middleware
adminApp.use('*', async (c, next) => {
  const path = c.req.path
  // Allow login and logout routes to pass through
  if (path.endsWith('/login') || path.endsWith('/logout')) {
    return next()
  }

  const token = getCookie(c, 'admin_token')
  
  // Special case: If user is accessing /admin but has a token in URL query,
  // we let it pass to the handler so the handler can set the cookie.
  const queryToken = c.req.query('token')
  if (!token && !queryToken) {
    return c.redirect('/admin/login?error=missing_token')
  }

  // If we have a cookie, validate it
  if (token) {
    const db = drizzle(c.env.DB, { schema })
    const session = await db.select().from(schema.adminSessions).where(eq(schema.adminSessions.token, token)).get()

    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      deleteCookie(c, 'admin_token')
      return c.redirect('/admin/login?error=expired')
    }

    const user = await db.select().from(schema.users).where(eq(schema.users.tg_id, session.user_id)).get()
    c.set('userId', session.user_id)
    c.set('isAdmin', user?.is_admin || false)
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
      })
      return c.redirect('/admin')
    }
    return c.text('Invalid or expired login token. Please request a new one from the bot.', 401)
  }

  return c.html(
    <html lang="en">
      <head>
        <title>Login - Telegram Admin</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
      </head>
      <body class="flex items-center justify-center min-h-screen bg-gray-100">
        <div class="p-8 bg-white rounded-xl shadow-lg text-center max-w-sm">
          <h2 class="text-2xl font-bold mb-4">Unauthorized</h2>
          {error && <p class="text-red-500 mb-4">{error}</p>}
          <p class="text-gray-600 mb-6">You must generate a 2-hour login token from your Telegram bot using the 
            <span class="font-mono bg-gray-200 px-1 py-0.5 rounded ml-1">/admin</span> command.</p>
          <a href="https://t.me/" class="bg-blue-500 text-white px-4 py-2 rounded shadow hover:bg-blue-600 transition">Go to Bot</a>
        </div>
      </body>
    </html>
  )
})

adminApp.get('/logout', async (c) => {
  deleteCookie(c, 'admin_token', { path: '/' })
  return c.redirect('/admin/login')
})

// 3. Images Dashboard
adminApp.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')

  // Pagination & Search params
  const page = parseInt(c.req.query('page') || '1')
  const search = c.req.query('q') || ''
  const pageSize = 20
  const offset = (page - 1) * pageSize

  // Build Query Conditions
  const groupId = c.req.query('gid') || ''
  
  let baseWhere: any = isAdmin 
    ? (search ? like(schema.images.caption, `%${search}%`) : undefined)
    : (search 
        ? and(eq(schema.images.uploader_id, userId), like(schema.images.caption, `%${search}%`))
        : eq(schema.images.uploader_id, userId)
      )

  if (groupId) {
    baseWhere = baseWhere ? and(baseWhere, eq(schema.images.group_id, groupId)) : eq(schema.images.group_id, groupId)
  }

  // Fetch Current Group Info (if filtering)
  let activeGroup = null
  if (groupId) {
    activeGroup = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId)).get()
  }

  // Fetch Total Count for Pagination
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.images)
    .where(baseWhere)
    .all()
  
  const totalPages = Math.ceil(total / pageSize)

  // Fetch Paginated Images
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

  // Fetch user's groups for batch assignment (if enabled)
  let userGroups: any[] = []
  if (c.env.ENABLE_GALLERY === 'true') {
     userGroups = await db.select().from(schema.groups).where(eq(schema.groups.user_id, userId)).all()
  }

  const isGalleryEnabled = String(c.env.ENABLE_GALLERY) === 'true';

  return c.html(
    <>
      {html`<!DOCTYPE html>`}
      <Layout title="Images Dashboard" isAdmin={isAdmin} showGallery={isGalleryEnabled}>
        <div x-data="dashboard" class="relative">
          <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">

            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-4">
                <h2 class="text-xl font-bold text-gray-800">
                  {activeGroup ? `Gallery: ${activeGroup.name}` : 'Uploaded Images'} ({total})
                </h2>
                <button x-on:click="toggleAll()" class="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-50 transition shadow-sm font-medium text-gray-600">
                   <span x-text="selected.length === 0 ? 'Select All' : 'Deselect All'">Select All</span>
                </button>
              </div>
              {activeGroup && (
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">Filtering by gallery</span>
                  <a href="/admin" class="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-200 flex items-center gap-1">
                    Clear Filter 
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </a>
                </div>
              )}
            </div>

        
        {/* Search Form */}
        <form method="get" action="/admin" class="flex gap-2">
          <input 
            type="text" 
            name="q" 
            value={search as string} 
            placeholder="Search captions..." 
            class="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-full md:w-64"
          />
          <button type="submit" class="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
            Search
          </button>
          {search && (
            <a href="/admin" class="bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-300 transition flex items-center">
              Clear
            </a>
          )}
        </form>
      </div>

      {/* Batch Action Bar (Sticky Bottom) */}
      <div x-show="selected.length > 0" 
           x-cloak=""
           x-transition:enter="transition ease-out duration-300 transform"
           x-transition:enter-start="opacity-0 translate-y-10"
           x-transition:enter-end="opacity-100 translate-y-0"
           x-transition:leave="transition ease-in duration-200 transform"
           x-transition:leave-start="opacity-100 translate-y-0"
           x-transition:leave-end="opacity-0 translate-y-10"
           class="fixed bottom-10 left-1/2 -translate-x-1/2 bg-gray-900/95 text-white px-6 py-4 rounded-full shadow-2xl z-50 flex items-center gap-6 backdrop-blur-md border border-white/20 whitespace-nowrap">
        <span class="text-sm font-bold"><span x-text="selected.length"></span> items selected</span>
        
        <div class="h-6 w-px bg-white/20"></div>

        <div class="flex gap-3">
          {c.env.ENABLE_GALLERY === 'true' && userGroups.length > 0 && (
            <form action="/admin/images/batch-move" method="post" class="flex gap-2 items-center">
              <template x-for="id in selected">
                <input type="hidden" name="ids" x-bind:value="id" />
              </template>
              <select name="group_id" class="bg-gray-800 text-white text-xs border-none rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-blue-400">
                <option value="">Move to Gallery...</option>
                <option value="none">-- Ungroup --</option>
                {userGroups.map(g => (
                  <option value={g.id}>{g.name}</option>
                ))}
              </select>
              <button type="submit" class="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg text-xs font-bold transition">Apply</button>
            </form>
          )}

          <form action="/admin/images/batch-delete" method="post" onsubmit="return confirm('Permanently delete selected images?')">
             <template x-for="id in selected">
                <input type="hidden" name="ids" x-bind:value="id" />
             </template>
             <button type="submit" class="bg-red-600 hover:bg-red-500 px-4 py-1.5 rounded-lg text-xs font-bold transition">Delete All</button>
          </form>
          
          <button x-on:click="selected = []" class="text-xs text-gray-400 hover:text-white underline">Cancel</button>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {imagesList.map(({ image: img, user }) => (
          <div class="bg-white border text-center rounded-lg shadow-sm overflow-hidden flex flex-col relative group">
            <div class="h-40 w-full bg-gray-200 relative group/img overflow-hidden">
               {/* Clickable Area (Copy Image) */}
               <div class="absolute inset-0 z-10 cursor-pointer"
                    x-on:click={`copyUrl("${img.id}", "${img.tg_file_id}")`}>
                 <img src={`/file/${img.tg_file_id}.jpg`} alt={img.id} loading="lazy" 
                      class={`w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-110 ${img.is_broken ? 'grayscale blur-[2px]' : ''}`} />
                 
                 {/* Feedback Overlay */}
                 <div x-show={`copiedId === "${img.id}"`} 
                      x-cloak=""
                      x-transition=""
                      class="absolute inset-0 z-30 flex items-center justify-center bg-blue-600/90 text-white font-bold text-sm">
                   Copied!
                 </div>

                 {/* Hover Icon (PC only) */}
                 <div class="absolute inset-0 z-20 bg-black/10 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <div class="bg-white/90 p-2 rounded-full shadow-lg text-gray-700">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                    </div>
                 </div>
               </div>

               {/* Checkbox Layer (Top-most) */}
               <div class="absolute top-2 right-2 z-50 p-1" x-on:click="event.stopPropagation()">
                  <input type="checkbox" name="image-select" x-model="selected" value={img.id} 
                         class="w-6 h-6 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer shadow-sm bg-white/95" />
               </div>

               {/* Broken Icon Overlay */}
               {img.is_broken && (
                 <div class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-25 pointer-events-none">
                   <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                   <span class="text-white text-[8px] font-bold">Missing</span>
                 </div>
               )}

               {/* Admin Attributes */}
               {isAdmin && user && (
                 <div class="absolute top-2 left-2 z-40 flex items-center gap-1 pointer-events-none">
                   <span class={`px-1 rounded text-[8px] font-bold text-white shadow-sm ${user.status === 'active' ? 'bg-green-500' : user.status === 'banned' ? 'bg-red-500' : 'bg-yellow-500'}`}>
                     {user.status === 'active' ? 'A' : user.status === 'banned' ? 'B' : 'P'}
                   </span>
                   <span class="bg-black/50 text-white text-[8px] px-1 py-0.5 rounded backdrop-blur-sm truncate max-w-[50px]">{user.nickname || user.tg_id}</span>
                 </div>
               )}
            </div>
            
            <div class="p-3 text-sm flex flex-col gap-2">
               <div class="flex items-center gap-2 mb-1">
                 <a href={`/file/${img.tg_file_id}.jpg`} target="_blank" class="text-blue-600 hover:underline font-mono truncate">{img.id}.jpg</a>
               </div>
               
               <div class="flex items-center gap-2">
                  {/* Public Toggle (Takes most space) */}
                  <form action={`/admin/image/${img.id}/toggle-public`} method="post" x-ref="form" class="flex-grow">
                     <button type="submit" 
                             class={`w-full py-1 px-1 rounded-md font-medium text-[10px] transition ${img.is_public ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                       {img.is_public ? '✅ Public' : '🔒 Private'}
                     </button>
                  </form>
                   {/* Delete Button (Icon only or small text next to it) */}
                   <form action={`/admin/image/${img.id}/delete`} method="post" onsubmit="return confirm('Are you sure you want to delete this link?')" class="flex-shrink-0">
                      <button type="submit" class="bg-red-50 text-red-500 hover:bg-red-100 p-1 rounded-md transition" title="Delete Image">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                         </svg>
                      </button>
                   </form>
                </div>

                {/* Individual Gallery Selector */}
                {isGalleryEnabled && (
                  <div class="border-t pt-2 mt-1">
                    <form action="/admin/images/batch-move" method="post" class="flex items-center gap-1 justify-between">
                       <input type="hidden" name="ids" value={img.id} />
                       <select name="group_id" onchange="this.form.submit()" class="text-[10px] bg-transparent border-none text-gray-400 hover:text-gray-600 focus:ring-0 w-full cursor-pointer">
                          <option value="">📁 Move to...</option>
                          <option value="none">-- Ungroup --</option>
                          {userGroups.map(g => (
                            <option value={g.id} selected={img.group_id === g.id}>{g.name}</option>
                          ))}
                       </select>
                       {img.group_id && (
                         <span class="bg-blue-50 text-blue-600 text-[9px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap">In Gallery</span>
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
               class="px-4 py-2 border rounded-lg bg-white text-sm font-medium hover:bg-gray-50 text-gray-700 shadow-sm">
              Previous
            </a>
          )}
          
          <div class="flex gap-1">
             {/* Show current page and total */}
             <span class="px-4 py-2 text-sm text-gray-600 font-medium">
               Page {page} of {totalPages}
             </span>
          </div>

          {page < totalPages && (
            <a href={`/admin?page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`} 
               class="px-4 py-2 border rounded-lg bg-white text-sm font-medium hover:bg-gray-50 text-gray-700 shadow-sm">
              Next
            </a>
          )}
        </div>
      )}
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

  // Fetch to delete from Telegram too
  const images = await db.select().from(schema.images).where(query).all()
  
  if (images.length > 0) {
    // Delete from DB
    await db.delete(schema.images).where(query)
    
    // Asynchronously delete from Telegram
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
    // Delete from DB
    await db.delete(schema.images).where(eq(schema.images.id, id))
    // Delete from Telegram Channel
    await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/deleteMessage?chat_id=${c.env.CHANNEL_ID}&message_id=${current.channel_msg_id}`)
  }
  return c.redirect('/admin')
})

// 5. Users Dashboard (Admins Only)
adminApp.get('/users', async (c) => {
  if (!c.get('isAdmin')) return c.text('Forbidden: Admins only', 403)

  const db = drizzle(c.env.DB, { schema })
  const usersList = await db.select().from(schema.users).orderBy(desc(schema.users.created_at)).all()

  return c.html(
    <>
      {html`<!DOCTYPE html>`}
      <Layout title="Users Dashboard" isAdmin={true} showGallery={String(c.env.ENABLE_GALLERY) === 'true'}>
        <h2 class="text-xl font-semibold mb-4 text-gray-800">User Management</h2>

      <div class="bg-white shadow overflow-hidden sm:rounded-lg">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TG ID</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nickname</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
              <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            {usersList.map((user) => (
              <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{user.tg_id}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.nickname}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                  {user.is_admin ? <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">Admin</span> : <span class="text-gray-500">User</span>}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                  {user.status === 'active' && <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Active</span>}
                  {user.status === 'pending' && <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Pending</span>}
                  {user.status === 'banned' && <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Banned</span>}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex gap-2 justify-end">
                   <form action={`/admin/users/${user.tg_id}/status`} method="post">
                      <select name="status" class="text-sm border-gray-300 rounded-md p-1 mr-2" onchange="this.form.submit()">
                         <option value="active" selected={user.status === 'active'}>Active</option>
                         <option value="pending" selected={user.status === 'pending'}>Pending</option>
                         <option value="banned" selected={user.status === 'banned'}>Banned</option>
                      </select>
                   </form>
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
  if (!c.get('isAdmin')) return c.text('Forbidden: Admins only', 403)
  const { id } = c.req.param()
  const body = await c.req.parseBody()
  const status = body['status'] as string
  
  if (['active', 'pending', 'banned'].includes(status)) {
    const db = drizzle(c.env.DB, { schema })
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

  // Fetch groups with image counts
  const query = isAdmin ? undefined : eq(schema.groups.user_id, userId)
  
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
  .all()

  return c.html(
    <>
      {html`<!DOCTYPE html>`}
      <Layout title="Gallery Manager" isAdmin={isAdmin} showGallery={true}>
        <div x-data="{ editingGroup: null }">
          <div class="flex items-center justify-between mb-6">

            <h2 class="text-xl font-bold text-gray-800">My Collections</h2>
            <button 
              onclick="document.getElementById('createGroupModal').showModal()"
              class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition shadow-sm"
            >
              + New Gallery
            </button>
          </div>


        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groupsList.map((g) => (
            <div class="bg-white rounded-xl shadow-sm border p-5 flex flex-col gap-4 group">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="text-lg font-bold text-gray-900">{g.name}</h3>
                  <div class="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>Images: <strong class="text-blue-600 font-bold">{g.imageCount}</strong></span>
                    <span class="text-gray-300">|</span>
                    <span>Created: {new Date(g.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div class="flex gap-1 md:opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                    <button 
                      x-on:click={`editingGroup = ${JSON.stringify(g)}; $nextTick(() => document.getElementById('editGroupModal').showModal())`}
                      class="p-1.5 text-blue-500 hover:bg-blue-50 rounded-md"
                      title="Edit Gallery"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <form action={`/admin/groups/${g.id}/delete`} method="post" onsubmit="return confirm('Delete this gallery? (Images will be kept)')" class="inline">
                       <button type="submit" class="p-1.5 text-red-500 hover:bg-red-50 rounded-md" title="Delete Gallery">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                       </button>
                    </form>
              </div>
            </div>

            <div class="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
               <div class="flex justify-between">
                  <span class="text-gray-500 italic">Layout</span>
                  <span class="font-medium capitalize text-gray-700">{g.layout}</span>
               </div>
               <div class="flex justify-between">
                  <span class="text-gray-500 italic">Passcode</span>
                  <span class="font-mono bg-white px-1.5 border rounded">{g.passcode || 'None'}</span>
               </div>
               <div class="flex justify-between items-center mt-2 border-t pt-2">
                  <span class="text-gray-500 italic">Contents</span>
                  <a href={`/admin?gid=${g.id}`} class="text-blue-600 hover:underline font-medium text-xs flex items-center gap-1">
                    Manage Images
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  </a>
               </div>
               <div class="flex justify-between items-center mt-1">
                  <span class="text-gray-500 italic">Share Link</span>
                  <a href={`/g/${g.id}`} target="_blank" class="text-blue-600 hover:underline font-medium text-xs truncate max-w-[150px]">
                    /g/{g.id}
                  </a>
               </div>
            </div>
          </div>
        ))}

        {groupsList.length === 0 && (
          <div class="col-span-full py-20 text-center bg-white rounded-xl border-2 border-dashed border-gray-200">
             <p class="text-gray-400">You haven't created any galleries yet.</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <dialog id="createGroupModal" class="p-0 rounded-xl shadow-2xl backdrop:bg-black/50 border-none open:flex flex-col max-w-sm w-full">
        <div class="bg-white p-6">
          <h3 class="text-lg font-bold mb-4">Create New Gallery</h3>
          <form action="/admin/groups/create" method="post" class="space-y-4">
            <div>
              <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
              <input type="text" name="name" required placeholder="My Awesome Trip" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div class="grid grid-cols-2 gap-4">
               <div>
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Layout</label>
                  <select name="layout" class="w-full px-3 py-2 border rounded-lg text-sm bg-white">
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
                    <label class="block text-xs font-bold text-gray-500 uppercase">Passcode</label>
                    <button type="button" x-on:click="generate()" class="text-[10px] text-blue-600 hover:underline">Generate</button>
                  </div>
                  <input type="text" name="passcode" id="passcode-input" placeholder="Optional" class="w-full px-3 py-2 border rounded-lg text-sm outline-none" />
               </div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
               <button type="button" onclick="document.getElementById('createGroupModal').close()" class="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">Cancel</button>
               <button type="submit" class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create</button>
            </div>
          </form>
        </div>
      </dialog>

      {/* Edit Modal */}
      <dialog id="editGroupModal" class="p-0 rounded-xl shadow-2xl backdrop:bg-black/50 border-none open:flex flex-col max-w-sm w-full">
        <div class="bg-white p-6">
          <h3 class="text-lg font-bold mb-4">Edit Gallery</h3>
          <form x-bind:action="editingGroup ? `/admin/groups/${editingGroup.id}/update` : '#'" method="post" class="space-y-4">
            <div>
              <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
              <input type="text" name="name" required x-bind:value="editingGroup?.name" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div class="grid grid-cols-2 gap-4">
               <div>
                  <label class="block text-xs font-bold text-gray-500 uppercase mb-1">Layout</label>
                  <select name="layout" x-bind:value="editingGroup?.layout" class="w-full px-3 py-2 border rounded-lg text-sm bg-white">
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
                    <label class="block text-xs font-bold text-gray-500 uppercase">Passcode</label>
                    <button type="button" x-on:click="generate()" class="text-[10px] text-blue-600 hover:underline">Generate</button>
                  </div>
                  <input type="text" name="passcode" id="edit-passcode-input" x-bind:value="editingGroup?.passcode || ''" placeholder="Optional" class="w-full px-3 py-2 border rounded-lg text-sm outline-none" />
               </div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
               <button type="button" onclick="document.getElementById('editGroupModal').close()" class="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">Cancel</button>
               <button type="submit" class="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold">Save Changes</button>
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
  
  const id = Math.random().toString(36).substring(2, 10)
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

export default adminApp
