/*
 * 行程单助手 Service Worker（v34）
 *
 * 两件事：
 *   A. 资源持久缓存（v31 起）
 *   B. 跨域隔离注入（v34 新增，iOS Safari 修复）
 *
 * ── A. 为什么需要缓存 ──
 *   GitHub Pages 对静态资源的响应头只有 `Cache-Control: max-age=600`（10 分钟）。
 *   识别模型（6.3MB）、ORT 推理内核（14MB）、PaddleOCR.js 的 SDK chunk（3.3MB gzip）
 *   体积大、又是不可变内容，每超过 10 分钟再打开就要重下一遍 —— 手机上体感极差。
 *
 *   策略：拦截同源下四类 GET：/paddleocr-models/、/ort/、/_next/static/chunks/、
 *   /_next/static/media/ort*，一律 cache-first；页面 HTML、模板 docx/xlsx、tessdata
 *   等**不缓存**，直接走网络，这样应用发版后不会出现「用户被旧缓存卡住」的问题。
 *
 * ── B. 为什么要注入 COOP/COEP（v34）──
 *   onnxruntime-web 1.29 只提供 `ort-wasm-simd-threaded.wasm`（pthreads 构建），
 *   其 JS glue 在**模块求值阶段**就无条件执行：
 *       new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true })
 *   共享内存需要 SharedArrayBuffer，而 Safari/iOS 只在**跨域隔离**（cross-origin isolated）
 *   的页面里才允许。GitHub Pages 不能自定义响应头 —— 于是 iOS 上模型下载到 100% 后
 *   这一步直接抛错，引擎②失效、静默落回 Tesseract（用户看到的就是「进度到 99% 自动降级」）。
 *   Chrome 桌面放宽了这条限制（非隔离也能分配 shared memory），所以只在苹果设备暴露。
 *
 *   解法即 coi-serviceworker 思路：由 SW 在**导航响应**上补 COOP/COEP，
 *   页面即获得 crossOriginIsolated = true，SAB 与共享内存恢复可用。
 *   本站所有子资源均为同源（字体已由 next/font 自托管），因此 require-corp 无副作用。
 *
 * 更新机制：内容变化时升级 CACHE_VERSION 即可整体换新；activate 会清理旧版本缓存。
 */
const CACHE_VERSION = "v34-1";
const CACHE_NAME = `ocr-assets-${CACHE_VERSION}`;
const ASSET_PATTERNS = [
  /\/paddleocr-models\//,
  /\/ort\//,
  // PaddleOCR.js 的 SDK chunk（含 onnxruntime-web 的 JS glue）
  /\/_next\/static\/chunks\//,
  // ORT 可能从打包目录取用的 wasm / mjs 加载器（文件名带 hash）
  /\/_next\/static\/media\/ort/,
];

self.addEventListener("install", () => {
  // 立即进入等待→激活流程，不等旧 worker
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith("ocr-assets-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        );
      } catch {
        /* 忽略：清理失败不影响主流程 */
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * 导航请求：原样取 HTML，但补上 COOP/COEP 使其成为跨域隔离页面。
 *
 * 注意：`cache: "no-store"` 一是避免条件请求返回 304（304 无法携带 body 重建 Response），
 * 二是保证发版后用户立刻拿到新 HTML。HTML 只有十几 KB，可以接受。
 */
async function navigateWithIsolation(request) {
  const res = await fetch(request.url, {
    method: "GET",
    credentials: "same-origin",
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.body || res.status === 204 || res.status === 205 || res.status === 304) return res;
  const headers = new Headers(res.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 导航请求（页面本身）→ 注入跨域隔离头
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      navigateWithIsolation(req).catch(async () => {
        // 网络失败时退回浏览器默认行为（不吞掉错误页）
        return fetch(req);
      }),
    );
    return;
  }

  if (!ASSET_PATTERNS.some((re) => re.test(url.pathname))) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      // 只缓存完整成功的 200 响应（避免把 206/错误页缓存下来）
      if (res && res.status === 200 && res.type === "basic") {
        try {
          await cache.put(req, res.clone());
        } catch {
          /* 忽略：QuotaExceeded 等不影响本次响应 */
        }
      }
      return res;
    })(),
  );
});
