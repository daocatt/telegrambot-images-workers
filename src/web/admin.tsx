import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, desc, and, like, count, sql } from 'drizzle-orm'
import { EnvBindings } from '../bot/context'

type ContextEnv = {
  Bindings: EnvBindings;
  Variables: {
    userId: string;
    isAdmin: boolean;
  }
}

const adminApp = new Hono<ContextEnv>()

// Template wrapper
const Layout = (props: { title: string; isAdmin?: boolean; children: any }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
        <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
      </head>
      <body class="bg-gray-50 text-gray-900 min-h-screen">
        <header class="bg-white shadow">
          <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
            <h1 class="text-2xl font-bold text-gray-900">📷 Telegram Image Manager</h1>
            <nav class="space-x-4">
              <a href="/admin" class="text-gray-600 hover:text-gray-900 font-medium">Images</a>
              {props.isAdmin && (
                <a href="/admin/users" class="text-gray-600 hover:text-gray-900 font-medium">Users</a>
              )}
              <a href="/admin/logout" class="text-red-600 hover:text-red-900 font-medium whitespace-nowrap">Logout</a>
            </nav>
          </div>
        </header>
        <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
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
        <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
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
  let baseWhere = isAdmin 
    ? (search ? like(schema.images.caption, `%${search}%`) : undefined)
    : (search 
        ? and(eq(schema.images.uploader_id, userId), like(schema.images.caption, `%${search}%`))
        : eq(schema.images.uploader_id, userId)
      )

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

  return c.html(
    <Layout title="Images Dashboard" isAdmin={isAdmin}>
      <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <h2 class="text-xl font-bold text-gray-800">Uploaded Images ({total})</h2>
        
        {/* Search Form */}
        <form method="GET" action="/admin" class="flex gap-2">
          <input 
            type="text" 
            name="q" 
            value={search} 
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

      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {imagesList.map(({ image: img, user }) => (
          <div class="bg-white border text-center rounded-lg shadow-sm overflow-hidden flex flex-col relative group">
            {/* User status badge (Admin View) */}
            {isAdmin && user && (
              <div class="absolute top-2 left-2 z-10 flex items-center gap-1">
                <span title={`Status: ${user.status}`} 
                      class={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white shadow-sm ${user.status === 'active' ? 'bg-green-500' : user.status === 'banned' ? 'bg-red-500' : 'bg-yellow-500'}`}>
                  {user.status === 'active' ? 'A' : user.status === 'banned' ? 'B' : 'P'}
                </span>
                <span class="bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur-sm truncate max-w-[80px]" title={user.nickname || user.tg_id}>
                  {user.nickname || user.tg_id}
                </span>
              </div>
            )}

            <div class="h-40 w-full bg-gray-200 flex items-center justify-center overflow-hidden relative">
               {img.is_broken && (
                 <div class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-20">
                   <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-red-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                   </svg>
                   <span class="text-white text-[10px] font-bold uppercase tracking-wider">Source Missing</span>
                 </div>
               )}
               <img src={`/file/${img.tg_file_id}.jpg`} alt={img.id} loading="lazy" class={`w-full h-full object-cover ${img.is_broken ? 'grayscale blur-[2px]' : ''}`} />
            </div>
            
            <div class="p-3 text-sm flex flex-col gap-2">
               <div class="flex items-center gap-2 mb-1">
                 <a href={`/file/${img.tg_file_id}.jpg`} target="_blank" class="text-blue-600 hover:underline font-mono truncate">{img.id}.jpg</a>
               </div>
               
               <div class="flex items-center gap-2">
                  {/* Public Toggle (Takes most space) */}
                  <form action={`/admin/image/${img.id}/toggle-public`} method="POST" x-data x-ref="form" class="flex-grow">
                     <button type="submit" 
                             class={`w-full py-1 px-1 rounded-md font-medium text-[10px] transition ${img.is_public ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                       {img.is_public ? '✅ Public' : '🔒 Private'}
                     </button>
                  </form>

                  {/* Delete Button (Icon only or small text next to it) */}
                  <form action={`/admin/image/${img.id}/delete`} method="POST" onsubmit="return confirm('Are you sure you want to delete this link?')" class="flex-shrink-0">
                     <button type="submit" class="bg-red-50 text-red-500 hover:bg-red-100 p-1 rounded-md transition" title="Delete Image">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                     </button>
                  </form>
               </div>
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
    </Layout>
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
    <Layout title="Users Dashboard" isAdmin={true}>
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
                   <form action={`/admin/users/${user.tg_id}/status`} method="POST">
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

export default adminApp
