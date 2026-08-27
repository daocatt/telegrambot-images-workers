import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../db/schema'
import { eq, desc, and, sql, count } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { ContextEnv } from '../types'
import { escapeHtml } from '../utils'
import { Layout } from '../components/Layout'

const groupsApp = new Hono<ContextEnv>()

// Galleries Management
groupsApp.get('/groups', async (c) => {
  if (String(c.env.ENABLE_GALLERY) !== 'true') return c.text('Gallery feature is disabled.', 403)
  
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')
  const isSuperAdmin = c.get('isSuperAdmin')

  // Scope: 'all' or 'me'. Only admins can view 'all'. Default is 'all' for admins, 'me' for regular users.
  const scopeParam = c.req.query('scope')
  const scope = isAdmin ? (scopeParam === 'me' ? 'me' : 'all') : 'me'

  const query = (isAdmin && scope === 'all') ? undefined : eq(schema.groups.user_id, userId)
  
  // Read page parameters
  const page = parseInt(c.req.query('page') || '1')
  const pageSize = 12
  const offset = (page - 1) * pageSize

  // Get total groups count
  const countQuery = (isAdmin && scope === 'all')
    ? db.select({ total: count() }).from(schema.groups)
    : db.select({ total: count() }).from(schema.groups).where(eq(schema.groups.user_id, userId))
  const [{ total }] = await countQuery.all()
  const totalPages = Math.ceil(total / pageSize)

  const groupsList = await db.select({
    id: schema.groups.id,
    name: schema.groups.name,
    layout: schema.groups.layout,
    passcode: schema.groups.passcode,
    user_id: schema.groups.user_id,
    created_at: schema.groups.created_at,
    creator_nickname: schema.users.nickname,
    imageCount: sql<number>`count(${schema.images.id})`
  })
  .from(schema.groups)
  .leftJoin(schema.images, eq(schema.groups.id, schema.images.group_id))
  .leftJoin(schema.users, eq(schema.groups.user_id, schema.users.tg_id))
  .where(query)
  .groupBy(schema.groups.id)
  .orderBy(desc(schema.groups.created_at))
  .limit(pageSize)
  .offset(offset)
  .all()

  return c.html(
    <>
      <Layout title="Gallery Manager" isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} showGallery={true}>
        <div x-data="{ editingGroup: null }">
          <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 border-b border-black pb-6 gap-4">
            <div class="flex flex-wrap items-center gap-4">
              <h2 class="text-xl font-bold uppercase tracking-wider">
                {scope === 'me' ? 'My Galleries' : 'All Galleries'} ({total})
              </h2>

              {isAdmin && (
                <div class="flex border border-black rounded-none text-xs overflow-hidden">
                  <a href="/admin/groups?scope=all" 
                     class={`px-2.5 py-1 font-bold uppercase transition ${scope === 'all' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'}`}>
                    All Galleries
                  </a>
                  <a href="/admin/groups?scope=me" 
                     class={`px-2.5 py-1 font-bold uppercase border-l border-black transition ${scope === 'me' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'}`}>
                    My Galleries
                  </a>
                </div>
              )}
            </div>

            <button 
              onclick="document.getElementById('createGroupModal').showModal()"
              class="bg-black text-white border border-black px-4 py-2 text-sm font-bold uppercase hover:bg-zinc-800 transition rounded-none"
            >
              + New Gallery
            </button>
          </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groupsList.map((g) => (
            <div class="bg-white border-2 border-black p-5 flex flex-col gap-4 group rounded-none">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="text-lg font-bold">{escapeHtml(g.name)}</h3>
                  <div class="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-600">
                    <span>Images: <strong class="text-black">{g.imageCount}</strong></span>
                    <span class="text-gray-300">|</span>
                    <span>Created: {new Date(g.created_at).toLocaleDateString()}</span>
                  </div>
                  {isAdmin && scope === 'all' && (
                    <div class="mt-1 text-[11px] text-gray-600 font-mono">
                      Owner: <span class="text-black font-bold">{escapeHtml(g.creator_nickname || g.user_id)}</span>
                    </div>
                  )}
                </div>
                <div class="flex gap-1 md:opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                    <button 
                      x-on:click={`editingGroup = ${JSON.stringify(g)}; $nextTick(() => document.getElementById('editGroupModal').showModal())`}
                      class="p-1.5 text-black hover:bg-gray-100 border border-transparent hover:border-black rounded-none"
                      title="Edit Gallery"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <form action={`/admin/groups/${g.id}/delete`} method="post" onsubmit="return confirm('Delete this gallery? (Images will be kept)')" class="inline">
                       <button type="submit" class="p-1.5 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-600 rounded-none" title="Delete Gallery">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                       </button>
                    </form>
              </div>
            </div>

            <div class="bg-gray-100 p-3 space-y-2 text-sm rounded-none border border-black">
               <div class="flex justify-between">
                  <span class="text-gray-600 italic">Layout</span>
                  <span class="font-bold uppercase text-black">{g.layout}</span>
               </div>
                <div class="flex justify-between">
                   <span class="text-gray-600 italic">Passcode</span>
                   <span class="font-mono bg-white px-1.5 border border-black rounded-none">{g.passcode ? '••••••••' : 'None'}</span>
                </div>
               <div class="flex justify-between items-center mt-2 border-t border-black pt-2">
                  <span class="text-gray-600 italic">Contents</span>
                  <a href={`/admin?gid=${g.id}`} class="text-black hover:underline font-bold text-xs flex items-center gap-1 uppercase">
                    Manage Images
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                  </a>
               </div>
               <div class="flex justify-between items-center mt-1">
                  <span class="text-gray-600 italic">Share Link</span>
                  <a href={`/g/${g.id}`} target="_blank" class="text-black hover:underline font-bold text-xs truncate max-w-[150px]">
                    /g/{g.id}
                  </a>
               </div>
            </div>
          </div>
          ))}

          {groupsList.length === 0 && (
            <div class="col-span-full py-20 text-center bg-white border-2 border-dashed border-black rounded-none">
               <p class="text-gray-500 uppercase font-bold">You haven't created any galleries yet.</p>
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div class="mt-8 flex justify-center items-center gap-2">
            {page > 1 && (
              <a href={`/admin/groups?page=${page - 1}${isAdmin ? `&scope=${scope}` : ''}`} 
                 class="px-4 py-2 border border-black bg-white text-sm font-bold hover:bg-gray-50 transition rounded-none uppercase">
                Previous
              </a>
            )}
            
            <div class="flex gap-1">
               <span class="px-4 py-2 text-sm text-gray-600 font-medium">
                 Page {page} of {totalPages}
               </span>
            </div>

            {page < totalPages && (
              <a href={`/admin/groups?page=${page + 1}${isAdmin ? `&scope=${scope}` : ''}`} 
                 class="px-4 py-2 border border-black bg-white text-sm font-bold hover:bg-gray-50 transition rounded-none uppercase">
                Next
              </a>
            )}
          </div>
        )}

        {/* Create Modal */}
        <dialog id="createGroupModal" class="fixed inset-0 m-auto p-0 border-2 border-black max-w-sm w-full h-fit rounded-none backdrop:bg-black/50 shadow-2xl hidden open:block">
          <div class="bg-white p-6 rounded-none">
            <h3 class="text-lg font-black uppercase mb-4 tracking-wider">Create New Gallery</h3>
            <form action="/admin/groups/create" method="post" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase mb-1">Name</label>
                <input type="text" name="name" required placeholder="My Awesome Trip" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
              </div>
              <div class="grid grid-cols-2 gap-4">
                 <div>
                    <label class="block text-xs font-bold uppercase mb-1">Layout</label>
                    <select name="layout" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none">
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
                      <label class="block text-xs font-bold uppercase">Passcode</label>
                      <button type="button" x-on:click="generate()" class="text-[10px] text-gray-600 hover:text-black font-bold uppercase">Gen</button>
                    </div>
                    <input type="text" name="passcode" id="passcode-input" placeholder="Optional" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                 </div>
              </div>
              <div class="flex justify-end gap-3 mt-6 border-t border-black pt-4">
                 <button type="button" onclick="document.getElementById('createGroupModal').close()" class="px-4 py-2 text-sm text-black border border-black hover:bg-gray-100 rounded-none uppercase font-bold">Cancel</button>
                 <button type="submit" class="px-4 py-2 text-sm bg-black text-white hover:bg-zinc-800 rounded-none uppercase font-bold border border-black">Create</button>
              </div>
            </form>
          </div>
        </dialog>

        {/* Edit Modal */}
        <dialog id="editGroupModal" class="fixed inset-0 m-auto p-0 border-2 border-black max-w-sm w-full h-fit rounded-none backdrop:bg-black/50 shadow-2xl hidden open:block">
          <div class="bg-white p-6 rounded-none">
            <h3 class="text-lg font-black uppercase mb-4 tracking-wider">Edit Gallery</h3>
            <form x-bind:action="editingGroup ? `/admin/groups/${editingGroup.id}/update` : '#'" method="post" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase mb-1">Name</label>
                <input type="text" name="name" required x-bind:value="editingGroup?.name" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
              </div>
              <div class="grid grid-cols-2 gap-4">
                 <div>
                    <label class="block text-xs font-bold uppercase mb-1">Layout</label>
                    <select name="layout" x-bind:value="editingGroup?.layout" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none">
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
                      <label class="block text-xs font-bold uppercase">Passcode</label>
                      <button type="button" x-on:click="generate()" class="text-[10px] text-gray-600 hover:text-black font-bold uppercase">Gen</button>
                    </div>
                    <input type="text" name="passcode" id="edit-passcode-input" x-bind:value="editingGroup?.passcode || ''" placeholder="Optional" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                 </div>
              </div>
              <div class="flex justify-end gap-3 mt-6 border-t border-black pt-4">
                 <button type="button" onclick="document.getElementById('editGroupModal').close()" class="px-4 py-2 text-sm text-black border border-black hover:bg-gray-100 rounded-none uppercase font-bold">Cancel</button>
                 <button type="submit" class="px-4 py-2 text-sm bg-black text-white hover:bg-zinc-800 rounded-none uppercase font-bold border border-black">Save Changes</button>
              </div>
            </form>
          </div>
        </dialog>
          </div>
      </Layout>
    </>
  )
})

groupsApp.post('/groups/create', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const body = await c.req.parseBody()
  
  const id = nanoid(8)
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

groupsApp.post('/groups/:id/update', async (c) => {
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

groupsApp.post('/groups/:id/delete', async (c) => {
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

export default groupsApp
