// 生产环境 Service Worker：缓存应用外壳，装到主屏后二次启动可离线秒开。
// 只在 npm run build 的产物里生效（注册见 src/pwa.js），开发态不缓存。
// 缓存名带注册 URL 上的构建号（?v=，见 pwa.js）：新构建注册进来时 URL 变化即触发 SW 更新，
// activate 顺手清掉旧构建号的缓存——绕开 GitHub Pages 对 sw.js 长达 4 小时的 HTTP 缓存。
const BUILD_ID = new URL(self.location.href).searchParams.get('v') ?? 'v1'
const CACHE = `quiz-app-${BUILD_ID}`
// 不随构建改名的固定外壳；assets 文件名带 hash，安装时从 index.html 里解析
const STATIC_SHELL = ['./manifest.webmanifest', './favicon.svg', './icons/icon-192.png', './icons/icon-512.png']

async function precache() {
  const cache = await caches.open(CACHE)
  await cache.addAll(STATIC_SHELL)
  try {
    const response = await fetch('./index.html')
    if (!response.ok) return
    const html = await response.clone().text()
    await cache.put('./index.html', response)
    // HTML 里引用的 hash 资源一并预缓存，否则离线时只有空壳
    const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((match) => match[1])
    await cache.addAll(assets)
  } catch {
    // 拿不到 index/资源就保留已有缓存：联网照常可用，只是没有离线兜底
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  // 导航：返回缓存的 index.html 保证秒开，同时后台拉新；没缓存时才等网络
  if (request.mode === 'navigate') {
    const update = refreshShell(request)
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match('./index.html'))
        .then((cached) => cached || update),
    )
    event.waitUntil(update.catch(() => {}))
    return
  }

  // 只有带 hash 的构建产物可以永久缓存；manifest/图标走网络优先，改动后能及时生效
  const isHashedAsset = new URL(request.url).pathname.includes('/assets/')
  event.respondWith(isHashedAsset ? cacheFirst(request) : networkFirst(request))
})

async function refreshShell(request) {
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(CACHE)
    await cache.put('./index.html', response.clone())
  }
  return response
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE)
      await cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) return cached
    throw error
  }
}

// 构建产物带 hash，内容不会变：命中缓存直接返回，没命中再走网络并留一份
async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(CACHE)
    await cache.put(request, response.clone())
  }
  return response
}
