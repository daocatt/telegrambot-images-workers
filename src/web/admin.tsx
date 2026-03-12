import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { eq, desc, and } from 'drizzle-orm'
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
  if (c.req.path === '/login' || c.req.path === '/logout') return next()

  const token = getCookie(c, 'admin_token')
  if (!token) return c.redirect('/admin/login?error=missing_token')

  const db = drizzle(c.env.DB, { schema })
  const session = await db.select().from(schema.adminSessions).where(eq(schema.adminSessions.token, token)).get()

  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    deleteCookie(c, 'admin_token')
    return c.redirect('/admin/login?error=expired')
  }

  const user = await db.select().from(schema.users).where(eq(schema.users.tg_id, session.user_id)).get()

  // Inject into context
  c.set('userId', session.user_id)
  c.set('isAdmin', user?.is_admin || false)
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

  let imagesList;
  if (isAdmin) {
    imagesList = await db.select().from(schema.images).orderBy(desc(schema.images.created_at)).all()
  } else {
    imagesList = await db.select().from(schema.images).where(eq(schema.images.uploader_id, userId)).orderBy(desc(schema.images.created_at)).all()
  }

  return c.html(
    <Layout title="Images Dashboard" isAdmin={isAdmin}>
      <h2 class="text-xl font-semibold mb-4 text-gray-800">Uploaded Images</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {imagesList.map((img) => (
          <div class="bg-white border text-center rounded-lg shadow-sm overflow-hidden flex flex-col relative group">
            <div class="h-40 w-full bg-gray-200 flex items-center justify-center overflow-hidden">
               <img src={`/img/${img.id}.jpg`} alt={img.id} loading="lazy" class="w-full h-full object-cover" />
            </div>
            
            <div class="p-3 text-sm flex flex-col gap-2">
               <div class="flex items-center gap-2 mb-1">
                 <a href={`/img/${img.id}.jpg`} target="_blank" class="text-blue-600 hover:underline font-mono truncate">{img.id}.jpg</a>
               </div>
               
               <div class="flex items-center gap-2 justify-between">
                 {/* AlpineJS form to toggle public state seamlessly */}
                 <form action={`/admin/image/${img.id}/toggle-public`} method="POST" x-data x-ref="form" class="w-full">
                    <button type="submit" 
                            class={`w-full py-1 px-2 rounded-md font-medium text-xs transition ${img.is_public ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                      {img.is_public ? '✅ Public' : '🔒 Private'}
                    </button>
                 </form>
               </div>
               
               <form action={`/admin/image/${img.id}/delete`} method="POST" onsubmit="return confirm('Are you sure you want to delete this link?')">
                  <button type="submit" class="text-red-500 hover:text-red-700 text-xs text-center w-full mt-1 font-medium">🗑 Delete</button>
               </form>
            </div>
          </div>
        ))}
        {imagesList.length === 0 && <p class="text-gray-500 col-span-full">No images found.</p>}
      </div>
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
