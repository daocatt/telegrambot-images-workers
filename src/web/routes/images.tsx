import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../db/schema'
import { eq, desc, and, like, count, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { ContextEnv } from '../types'
import { escapeHtml } from '../utils'
import { Layout } from '../components/Layout'

const imagesApp = new Hono<ContextEnv>()

// Images Dashboard
imagesApp.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')
  const isSuperAdmin = c.get('isSuperAdmin')

  // Pagination, Scope & Search params
  const page = parseInt(c.req.query('page') || '1')
  const search = c.req.query('q') || ''
  const error = c.req.query('error') || ''
  const safeSearch = search.replace(/[%_]/g, '\\$&')
  const pageSize = 20
  const offset = (page - 1) * pageSize

  // Scope: 'all' or 'me'. Only admins can view 'all'. Default is 'all' for admins, 'me' for regular users.
  const scopeParam = c.req.query('scope')
  const scope = isAdmin ? (scopeParam === 'me' ? 'me' : 'all') : 'me'

  const groupId = c.req.query('gid') || ''

  let baseWhere: any = (isAdmin && scope === 'all')
    ? (search ? like(schema.images.caption, `%${safeSearch}%`) : undefined)
    : (search 
        ? and(eq(schema.images.uploader_id, userId), like(schema.images.caption, `%${safeSearch}%`))
        : eq(schema.images.uploader_id, userId)
      )

  if (groupId) {
    baseWhere = baseWhere ? and(baseWhere, eq(schema.images.group_id, groupId)) : eq(schema.images.group_id, groupId)
  }

  let activeGroup = null
  if (groupId) {
    activeGroup = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId)).get()
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.images)
    .where(baseWhere)
    .all()
  
  const totalPages = Math.ceil(total / pageSize)

  let imagesList;
  if (isAdmin && scope === 'all') {
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

  let userGroups: any[] = []
  if (c.env.ENABLE_GALLERY === 'true') {
     userGroups = await db.select().from(schema.groups).where(eq(schema.groups.user_id, userId)).all()
  }

  const isGalleryEnabled = String(c.env.ENABLE_GALLERY) === 'true';

  return c.html(
    <>
      <Layout title="Images Dashboard" isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} showGallery={isGalleryEnabled}>
        <div x-data="dashboard" class="relative">
          {error && (
            <div class="bg-gray-100 border-l-4 border-red-600 p-4 mb-6 text-sm font-bold text-red-600 rounded-none">
              {escapeHtml(error)}
            </div>
          )}
          <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4 border-b border-black pb-6">

            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap items-center gap-3">
                <h2 class="text-xl font-bold uppercase tracking-wider">
                  {activeGroup ? `Gallery: ${activeGroup.name}` : (scope === 'me' ? 'My Uploads' : 'All Uploads')} ({total})
                </h2>

                {isAdmin && (
                  <div class="flex border border-black rounded-none text-xs overflow-hidden">
                    <a href={`/admin?scope=all${groupId ? `&gid=${groupId}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`} 
                       class={`px-2.5 py-1 font-bold uppercase transition ${scope === 'all' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'}`}>
                      All Uploads
                    </a>
                    <a href={`/admin?scope=me${groupId ? `&gid=${groupId}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`} 
                       class={`px-2.5 py-1 font-bold uppercase border-l border-black transition ${scope === 'me' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'}`}>
                      My Uploads
                    </a>
                  </div>
                )}

                <button x-on:click="toggleAll()" class="text-xs bg-white border border-black px-2 py-1 hover:bg-black hover:text-white transition shadow-sm font-medium rounded-none">
                   <span x-text="selected.length === 0 ? 'Select All' : 'Deselect All'">Select All</span>
                </button>
                <button onclick="document.getElementById('uploadModal').showModal()" class="text-xs bg-black border border-black text-white px-2.5 py-1 hover:bg-zinc-800 transition shadow-sm font-bold rounded-none uppercase">
                   + Upload
                </button>
              </div>
              {activeGroup && (
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">Filtering by gallery</span>
                  <a href={`/admin${scope ? `?scope=${scope}` : ''}`} class="text-[10px] bg-white border border-black text-black px-1.5 py-0.5 hover:bg-black hover:text-white flex items-center gap-1 rounded-none">
                    Clear Filter 
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </a>
                </div>
              )}
            </div>

            <form method="get" action="/admin" class="flex gap-2">
              {isAdmin && <input type="hidden" name="scope" value={scope} />}
              {groupId && <input type="hidden" name="gid" value={groupId} />}
              <input 
                type="text" 
                name="q" 
                value={escapeHtml(search as string)}
                placeholder="Search captions..." 
                class="px-3 py-1.5 border border-black bg-white text-sm outline-none w-full md:w-64 rounded-none focus:ring-0 focus:border-zinc-500"
              />
              <button type="submit" class="bg-black border border-black text-white px-4 py-1.5 text-sm font-medium hover:bg-zinc-800 transition rounded-none uppercase">
                Search
              </button>
              {search && (
                <a href={`/admin?scope=${scope}${groupId ? `&gid=${groupId}` : ''}`} class="bg-white border border-black text-black px-3 py-1.5 text-sm font-medium hover:bg-gray-100 transition flex items-center rounded-none uppercase">
                  Clear
                </a>
              )}
            </form>
          </div>

          {/* Batch Action Bar */}
          <div x-show="selected.length > 0" 
               x-cloak=""
               x-transition:enter="transition ease-out duration-300 transform"
               x-transition:enter-start="opacity-0 translate-y-10"
               x-transition:enter-end="opacity-100 translate-y-0"
               x-transition:leave="transition ease-in duration-200 transform"
               x-transition:leave-start="opacity-100 translate-y-0"
               x-transition:leave-end="opacity-0 translate-y-10"
               class="fixed bottom-10 left-1/2 -translate-x-1/2 bg-white text-black border-2 border-black px-6 py-4 shadow-2xl z-50 flex items-center gap-6 whitespace-nowrap rounded-none">
            <span class="text-sm font-bold uppercase"><span x-text="selected.length"></span> selected</span>
            
            <div class="h-6 w-px bg-black"></div>

            <div class="flex gap-3">
              {c.env.ENABLE_GALLERY === 'true' && userGroups.length > 0 && (
                <form action="/admin/images/batch-move" method="post" class="flex gap-2 items-center">
                  <template x-for="id in selected">
                    <input type="hidden" name="ids" x-bind:value="id" />
                  </template>
                  <select name="group_id" class="bg-white text-black border border-black text-xs px-3 py-1.5 rounded-none outline-none">
                    <option value="">Move to Gallery...</option>
                    <option value="none">-- Ungroup --</option>
                    {userGroups.map(g => (
                      <option value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <button type="submit" class="bg-black border border-black text-white px-3 py-1.5 text-xs font-bold transition hover:bg-zinc-800 rounded-none uppercase">Apply</button>
                </form>
              )}

              <form action="/admin/images/batch-delete" method="post" onsubmit="return confirm('Permanently delete selected images?')">
                 <template x-for="id in selected">
                    <input type="hidden" name="ids" x-bind:value="id" />
                 </template>
                 <button type="submit" class="bg-red-600 border border-red-600 text-white px-4 py-1.5 text-xs font-bold transition hover:bg-red-700 rounded-none uppercase">Delete All</button>
              </form>
              
              <button x-on:click="selected = []" class="text-xs text-gray-600 hover:text-black underline uppercase">Cancel</button>
            </div>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {imagesList.map(({ image: img, user }) => (
              <div class="bg-white border border-black text-center overflow-hidden flex flex-col relative group rounded-none">
                <div class="h-40 w-full bg-gray-200 relative group/img overflow-hidden">
                   <div class="absolute inset-0 z-10 cursor-pointer"
                        x-on:click={`copyUrl("${escapeHtml(img.id)}", "${escapeHtml(img.tg_file_id)}")`}>
                      <img src={`/file/${encodeURIComponent(img.tg_file_id)}.jpg`} alt={escapeHtml(img.id)} loading="lazy"
                          class={`w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-110 rounded-none ${img.is_broken ? 'grayscale blur-[2px]' : ''}`} />
                     
                     <div x-show={`copiedId === "${img.id}"`} 
                          x-cloak=""
                          x-transition=""
                          class="absolute inset-0 z-30 flex items-center justify-center bg-black/90 text-white font-bold text-sm rounded-none">
                       COPIED!
                     </div>

                     <div class="absolute inset-0 z-20 bg-black/10 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center pointer-events-none rounded-none">
                        <div class="bg-white border border-black p-2 text-black rounded-none">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                        </div>
                     </div>
                   </div>

                   <div class="absolute top-2 right-2 z-50 p-1" x-on:click="event.stopPropagation()">
                      <input type="checkbox" name="image-select" x-model="selected" value={img.id} 
                             class="w-6 h-6 border-black text-black bg-white rounded-none cursor-pointer" />
                   </div>

                   {img.is_broken && (
                     <div class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-25 pointer-events-none">
                       <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-400 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                       <span class="text-white text-[8px] font-bold uppercase">Missing</span>
                     </div>
                   )}

                   {isAdmin && user && (
                     <div class="absolute top-2 left-2 z-40 flex items-center gap-1 pointer-events-none">
                       <span class={`px-1 text-[8px] font-bold text-white ${user.status === 'active' ? 'bg-green-600' : user.status === 'banned' ? 'bg-red-600' : 'bg-yellow-600'}`}>
                         {user.status === 'active' ? 'A' : user.status === 'banned' ? 'B' : 'P'}
                       </span>
                        <span class="bg-black/50 text-white text-[8px] px-1 py-0.5 backdrop-blur-sm truncate max-w-[50px]">{escapeHtml(user.nickname || user.tg_id)}</span>
                     </div>
                   )}
                </div>
                
                <div class="p-3 text-sm flex flex-col gap-2">
                   <div class="flex items-center gap-2 mb-1">
                      <a href={`/file/${encodeURIComponent(img.tg_file_id)}.jpg`} target="_blank" class="text-black hover:underline font-mono truncate">{img.id}.jpg</a>
                   </div>
                   
                   <div class="flex items-center gap-2">
                      <form action={`/admin/image/${img.id}/toggle-public`} method="post" x-ref="form" class="flex-grow">
                         <button type="submit" 
                                 class={`w-full py-1 px-1 border border-black font-bold text-[10px] uppercase transition rounded-none ${img.is_public ? 'bg-gray-100 text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-zinc-800'}`}>
                           {img.is_public ? 'Public' : 'Private'}
                         </button>
                      </form>
                       <form action={`/admin/image/${img.id}/delete`} method="post" onsubmit="return confirm('Are you sure you want to delete this link?')" class="flex-shrink-0">
                          <button type="submit" class="border border-black hover:bg-gray-100 p-1 transition rounded-none text-red-600" title="Delete Image">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                             </svg>
                          </button>
                       </form>
                    </div>

                    {isGalleryEnabled && (
                      <div class="border-t border-black pt-2 mt-1">
                        <form action="/admin/images/batch-move" method="post" class="flex items-center gap-1 justify-between">
                           <input type="hidden" name="ids" value={img.id} />
                           <select name="group_id" onchange="this.form.submit()" class="text-[10px] bg-transparent border-none text-black font-bold focus:ring-0 w-full cursor-pointer rounded-none">
                              <option value="">Move to...</option>
                              <option value="none">-- Ungroup --</option>
                              {userGroups.map(g => (
                                <option value={g.id} selected={img.group_id === g.id}>{g.name}</option>
                              ))}
                           </select>
                           {img.group_id && (
                             <span class="bg-black text-white text-[9px] px-1.5 py-0.5 font-bold uppercase whitespace-nowrap">In Gallery</span>
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
                <a href={`/admin?page=${page - 1}${isAdmin ? `&scope=${scope}` : ''}${groupId ? `&gid=${groupId}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`} 
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
                <a href={`/admin?page=${page + 1}${isAdmin ? `&scope=${scope}` : ''}${groupId ? `&gid=${groupId}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`} 
                   class="px-4 py-2 border border-black bg-white text-sm font-bold hover:bg-gray-50 transition rounded-none uppercase">
                  Next
                </a>
              )}
            </div>
          )}
          
          <dialog id="uploadModal" class="fixed inset-0 m-auto p-6 bg-white border-2 border-black max-w-md w-full h-fit rounded-none backdrop:bg-black/50 shadow-2xl hidden open:flex open:flex-col open:justify-between">
            <div x-data="{
              files: [],
              isDragging: false,
              isUploading: false,
              addFiles(fileList) {
                const limit = 10;
                const newFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));
                if (this.files.length + newFiles.length > limit) {
                  alert('You can only upload up to 10 images at once.');
                  return;
                }
                newFiles.forEach(f => {
                  this.files.push({
                    file: f,
                    name: f.name,
                    size: (f.size / 1024).toFixed(1) + ' KB',
                    status: 'pending',
                    progress: 0,
                    error: ''
                  });
                });
              },
              removeFile(index) {
                if (this.isUploading) return;
                this.files.splice(index, 1);
              },
              async startUpload() {
                if (this.files.length === 0 || this.isUploading) return;
                this.isUploading = true;
                
                for (let i = 0; i < this.files.length; i++) {
                  const item = this.files[i];
                  if (item.status === 'success') continue;
                  
                  item.status = 'uploading';
                  const formData = new FormData();
                  formData.append('file', item.file);
                  const caption = document.getElementById('upload-caption')?.value?.trim();
                  if (caption) formData.append('caption', caption);
                  const groupId = document.getElementById('upload-gallery')?.value;
                  if (groupId) formData.append('group_id', groupId);
                  
                  try {
                    const res = await fetch('/admin/upload-api', {
                      method: 'POST',
                      body: formData
                    });
                    const data = await res.json();
                    if (data.success) {
                      item.status = 'success';
                    } else {
                      item.status = 'error';
                      item.error = data.error || 'Upload failed';
                    }
                  } catch (err) {
                    item.status = 'error';
                    item.error = 'Network error';
                  }
                }
                
                this.isUploading = false;
                if (this.files.some(f => f.status === 'success')) {
                  window.location.reload();
                }
              }
            }" class="space-y-4">
              <div class="flex justify-between items-center border-b border-black pb-2">
                <h3 class="text-md font-black uppercase tracking-wider">Upload Images</h3>
                <span class="text-xs text-gray-500 uppercase font-bold" x-text="files.length + '/10 files'"></span>
              </div>

              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-bold uppercase mb-1">Caption (optional)</label>
                  <input type="text" id="upload-caption" placeholder="Add a caption..." class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none focus:ring-0 focus:border-zinc-500" />
                </div>
                {isGalleryEnabled && userGroups.length > 0 && (
                  <div>
                    <label class="block text-xs font-bold uppercase mb-1">Gallery (optional)</label>
                    <select id="upload-gallery" class="w-full bg-white border border-black px-3 py-2 text-sm outline-none rounded-none">
                      <option value="">No Gallery</option>
                      {userGroups.map(g => (
                        <option value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              
              {/* Drag and Drop Zone */}
              <div 
                x-on:dragover="$event.preventDefault(); isDragging = true"
                x-on:dragleave="$event.preventDefault(); isDragging = false"
                x-on:drop="$event.preventDefault(); isDragging = false; addFiles($event.dataTransfer.files)"
                x-on:click="$refs.fileInput.click()"
                x-bind:class="isDragging ? 'bg-gray-100 border-black' : 'border-black hover:bg-gray-50'"
                class="border-2 border-dashed p-6 text-center cursor-pointer transition select-none flex flex-col items-center justify-center space-y-2 rounded-none"
              >
                <input 
                  type="file" 
                  x-ref="fileInput" 
                  class="hidden" 
                  multiple 
                  accept="image/*" 
                  x-on:change="addFiles($event.target.files); $event.target.value = ''" 
                />
                <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <div class="text-xs font-bold uppercase tracking-wider">Drag & drop files or click to browse</div>
                <div class="text-[10px] text-gray-500">Supports JPG, PNG, WEBP. Max 10 images.</div>
              </div>

              {/* Selected Files List */}
              <div class="max-h-48 overflow-y-auto space-y-2 no-scrollbar" x-show="files.length > 0">
                <template x-for="(item, index) in files" x-bind:key="index">
                  <div class="flex items-center justify-between p-2 border border-black text-xs rounded-none bg-gray-50">
                    <div class="flex flex-col min-w-0 pr-4">
                      <span class="font-bold truncate" x-text="item.name"></span>
                      <span class="text-[10px] text-gray-500" x-text="item.size"></span>
                      <span class="text-[10px] text-red-600 font-bold" x-show="item.status === 'error'" x-text="item.error"></span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      {/* Status Badges */}
                      <span x-show="item.status === 'pending'" class="text-[9px] font-bold text-gray-500 uppercase">Pending</span>
                      <span x-show="item.status === 'uploading'" class="text-[9px] font-bold text-black uppercase animate-pulse">Uploading</span>
                      <span x-show="item.status === 'success'" class="text-[9px] font-bold text-green-600 uppercase">Success</span>
                      
                      <button 
                        type="button" 
                        x-on:click="$event.stopPropagation(); removeFile(index)" 
                        x-show="!isUploading" 
                        class="text-red-600 hover:bg-red-50 p-1 border border-transparent hover:border-red-600 rounded-none"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </template>
              </div>

              {/* Modal Footer Controls */}
              <div class="flex justify-end gap-3 border-t border-black pt-4">
                 <button 
                   type="button" 
                   onclick="document.getElementById('uploadModal').close()" 
                   x-show="!isUploading" 
                   class="px-4 py-2 text-sm text-black border border-black hover:bg-gray-100 rounded-none uppercase font-bold"
                 >
                   Cancel
                 </button>
                 <button 
                   type="button" 
                   x-on:click="startUpload()"
                   x-bind:disabled="files.length === 0 || isUploading"
                   x-bind:class="(files.length === 0 || isUploading) ? 'bg-gray-300 border-gray-300 text-gray-500 cursor-not-allowed' : 'bg-black text-white hover:bg-zinc-800'"
                   class="px-4 py-2 text-sm border border-black rounded-none uppercase font-bold transition"
                 >
                   <span x-text="isUploading ? 'Uploading...' : 'Start Upload'"></span>
                 </button>
              </div>
            </div>
          </dialog>
        </div>
      </Layout>
    </>
  )
})

// Image Actions
imagesApp.post('/image/:id/toggle-public', async (c) => {
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

imagesApp.post('/images/batch-move', async (c) => {
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

imagesApp.post('/images/batch-delete', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')
  const body = await c.req.parseBody()
  
  const ids = (Array.isArray(body['ids']) ? body['ids'] : [body['ids']]) as string[]

  const query = isAdmin 
    ? inArray(schema.images.id, ids)
    : and(inArray(schema.images.id, ids), eq(schema.images.uploader_id, userId))

  const images = await db.select().from(schema.images).where(query).all()
  
  if (images.length > 0) {
    await db.delete(schema.images).where(query)
    
    c.executionCtx.waitUntil((async () => {
      for (const img of images) {
        await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/deleteMessage?chat_id=${c.env.CHANNEL_ID}&message_id=${img.channel_msg_id}`)
      }
    })())
  }
  
  return c.redirect('/admin')
})

imagesApp.post('/image/:id/delete', async (c) => {
  const { id } = c.req.param()
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  const isAdmin = c.get('isAdmin')

  const query = isAdmin 
    ? eq(schema.images.id, id)
    : and(eq(schema.images.id, id), eq(schema.images.uploader_id, userId))
  
  const current = await db.select().from(schema.images).where(query).get()
  if (current) {
    await db.delete(schema.images).where(eq(schema.images.id, id))
    await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/deleteMessage?chat_id=${c.env.CHANNEL_ID}&message_id=${current.channel_msg_id}`)
  }
  return c.redirect('/admin')
})

// Web Image Upload API
imagesApp.post('/upload-api', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const userId = c.get('userId')
  
  const body = await c.req.parseBody()
  const file = body['file'] as File
  const caption = String(body['caption'] || '').trim()
  const groupId = body['group_id'] ? String(body['group_id']) : null

  if (!file || file.size === 0) {
    return c.json({ success: false, error: 'No file uploaded' }, 400)
  }

  const MAX_FILE_SIZE = 20 * 1024 * 1024
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ success: false, error: 'File too large. Max 20MB.' }, 400)
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml']
  if (!allowedTypes.includes(file.type)) {
    return c.json({ success: false, error: 'Invalid file type. Only images are allowed.' }, 400)
  }

  try {
    // 1. Prepare FormData to send to Telegram Bot sendPhoto API
    const formData = new FormData()
    formData.append('chat_id', c.env.CHANNEL_ID)
    formData.append('photo', file)
    if (caption) {
      formData.append('caption', caption)
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: formData
    })

    const tgData = await tgRes.json() as any
    if (!tgRes.ok || !tgData.ok) {
      console.error('Telegram upload failed:', tgData)
      return c.json({ success: false, error: tgData.description || 'Telegram upload failed' }, 500)
    }

    // 2. Extract tg_file_id and channel_msg_id
    const messageId = tgData.result.message_id
    const photoArray = tgData.result.photo
    const bestPhoto = photoArray[photoArray.length - 1]
    const tgFileId = bestPhoto.file_id

    // 3. Save info to D1 Database
    const id = nanoid(8)
    await db.insert(schema.images).values({
      id,
      tg_file_id: tgFileId,
      channel_msg_id: messageId,
      uploader_id: userId,
      is_public: true,
      caption: caption || null,
      group_id: groupId,
      created_at: new Date()
    })

    const baseUrl = c.env.BASE_URL.replace(/\/$/, '')
    const url = `${baseUrl}/file/${tgFileId}.jpg`

    return c.json({ success: true, id, url })
  } catch (err: any) {
    console.error('Web upload error:', err)
    return c.json({ success: false, error: err.message }, 500)
  }
})

export default imagesApp
