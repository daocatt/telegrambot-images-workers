export const Layout = (props: { title: string; isAdmin?: boolean; isSuperAdmin?: boolean; showGallery?: boolean; children: any }) => {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📷</text></svg>" />
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
      <body class="bg-gray-100 text-black min-h-screen font-mono">
        <header class="bg-white border-b border-black sticky top-0 z-30">
          <div class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center gap-2">
            <h1 class="text-lg md:text-xl font-black uppercase tracking-wider text-black">
              📷 SnapFlare
            </h1>
            <nav class="flex items-center space-x-3 md:space-x-4 overflow-x-auto no-scrollbar py-1">
              <a href="/admin" class="text-black hover:bg-black hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-black transition whitespace-nowrap">Images</a>
              {props.isSuperAdmin && (
                <a href="/admin/users" class="text-black hover:bg-black hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-black transition whitespace-nowrap">Users</a>
              )}
              {props.showGallery && (
                <a href="/admin/groups" class="text-black hover:bg-black hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-black transition whitespace-nowrap">Gallery</a>
              )}
              <a href="/admin/profile" class="text-black hover:bg-black hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-black transition whitespace-nowrap">Profile</a>
              <a href="/admin/logout" class="text-red-600 hover:bg-red-600 hover:text-white px-2 py-1 text-sm font-bold border border-transparent hover:border-red-600 transition whitespace-nowrap">Logout</a>
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
