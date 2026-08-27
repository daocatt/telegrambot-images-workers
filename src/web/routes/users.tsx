import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../db/schema'
import { eq, desc } from 'drizzle-orm'
import { ContextEnv } from '../types'
import { escapeHtml, maskEmail } from '../utils'
import { Layout } from '../components/Layout'

const usersApp = new Hono<ContextEnv>()

// Users Dashboard (Super Admins Only)
usersApp.get('/users', async (c) => {
  if (!c.get('isSuperAdmin')) return c.text('Forbidden: Super admin only', 403)

  const db = drizzle(c.env.DB, { schema })
  const usersList = await db.select().from(schema.users).orderBy(desc(schema.users.created_at)).all()
  const error = c.req.query('error')
  const success = c.req.query('success')

  return c.html(
    <>
      <Layout title="Users Dashboard" isAdmin={true} isSuperAdmin={true} showGallery={String(c.env.ENABLE_GALLERY) === 'true'}>
        {error && (
          <div class="bg-gray-100 border-l-4 border-red-600 p-4 mb-6 text-sm font-bold text-red-600 rounded-none">
            {escapeHtml(error)}
          </div>
        )}
        {success && (
          <div class="bg-gray-100 border-l-4 border-green-600 p-4 mb-6 text-sm font-bold text-green-600 rounded-none">
            {escapeHtml(success)}
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
                     <div class="flex items-center gap-2">
                       <form action={`/admin/users/${user.tg_id}/status`} method="post">
                          <select name="status" class="text-sm border border-black bg-white rounded-none p-1 mr-2 outline-none font-bold" onchange="this.form.submit()">
                             <option value="active" selected={user.status === 'active'}>Active</option>
                             <option value="pending" selected={user.status === 'pending'}>Pending</option>
                             <option value="banned" selected={user.status === 'banned'}>Banned</option>
                          </select>
                       </form>
                        <button type="button" 
                                data-nickname={escapeHtml(user.nickname || '')}
                                data-tg-id={user.tg_id}
                                onclick={`
                                  var btn = this;
                                  document.getElementById('delete-user-nickname').textContent = btn.dataset.nickname;
                                  document.getElementById('delete-user-tg-id').textContent = btn.dataset.tgId;
                                  document.getElementById('delete-user-form').action = '/admin/users/' + btn.dataset.tgId + '/delete';
                                  document.getElementById('deleteUserModal').showModal();
                                `}
                                class="bg-red-600 text-white border border-black px-2 py-1 text-xs font-bold uppercase hover:bg-red-700 transition rounded-none cursor-pointer">
                          Delete
                        </button>
                     </div>
                   )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {/* Custom Delete User Modal */}
        <dialog id="deleteUserModal" class="fixed inset-0 m-auto p-0 border-2 border-black max-w-sm w-full h-fit rounded-none backdrop:bg-black/50 shadow-2xl hidden open:block">
          <div class="bg-white p-6 rounded-none">
            <h3 class="text-lg font-black uppercase mb-2 text-red-600 tracking-wider">⚠️ Delete User</h3>
            <p class="text-xs text-gray-700 mb-6 leading-relaxed">
              Are you absolutely sure you want to delete <span id="delete-user-nickname" class="font-bold"></span> (<span id="delete-user-tg-id" class="font-mono"></span>)? 
              <br /><br />
              <span class="font-bold text-red-600">WARNING:</span> This will permanently erase their account, all their galleries, and all their uploaded image records. This action cannot be undone.
            </p>
            <form id="delete-user-form" action="" method="post" class="flex justify-end gap-3 border-t border-black pt-4">
              <button type="button" onclick="document.getElementById('deleteUserModal').close()" class="px-4 py-2 text-sm text-black border border-black hover:bg-gray-100 rounded-none uppercase font-bold cursor-pointer">Cancel</button>
              <button type="submit" class="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 rounded-none uppercase font-bold border border-black cursor-pointer">Confirm Delete</button>
            </form>
          </div>
        </dialog>
      </Layout>
    </>
  )
})

usersApp.post('/users/:id/status', async (c) => {
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

usersApp.post('/users/:id/delete', async (c) => {
  if (!c.get('isSuperAdmin')) return c.text('Forbidden: Super admin only', 403)
  const { id } = c.req.param()
  const currentUserId = c.get('userId')
  if (id === currentUserId) return c.redirect('/admin/users?error=Cannot+delete+yourself')

  const db = drizzle(c.env.DB, { schema })
  const target = await db.select({ is_admin: schema.users.is_admin }).from(schema.users).where(eq(schema.users.tg_id, id)).get()
  if (target?.is_admin) {
    return c.redirect('/admin/users?error=Cannot+delete+admin+users')
  }

  // Fetch all images for this uploader to delete Telegram messages asynchronously
  const imagesList = await db.select({ channel_msg_id: schema.images.channel_msg_id }).from(schema.images).where(eq(schema.images.uploader_id, id)).all()

  // Perform deletions inside D1
  await db.delete(schema.images).where(eq(schema.images.uploader_id, id))
  await db.delete(schema.groups).where(eq(schema.groups.user_id, id))
  await db.delete(schema.adminSessions).where(eq(schema.adminSessions.user_id, id))
  await db.delete(schema.users).where(eq(schema.users.tg_id, id))

  // Asynchronously request Telegram message deletion
  if (imagesList.length > 0) {
    c.executionCtx.waitUntil((async () => {
      for (const img of imagesList) {
        try {
          await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/deleteMessage?chat_id=${c.env.CHANNEL_ID}&message_id=${img.channel_msg_id}`)
        } catch (e) {
          console.error('[Delete User TG Sync Error]:', e)
        }
      }
    })())
  }

  return c.redirect('/admin/users?success=User+deleted+successfully')
})

export default usersApp
