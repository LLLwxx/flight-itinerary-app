/*
 * 行程单助手 Service Worker（v31）
 *
 * 为什么需要：
 *   GitHub Pages 对静态资源的响应头是 `Cache-Control: max-age=600`，只有 10 分钟。
 *   识别模型（6.3MB）与 ORT 推理内核（14MB）体积大、又是不可变内容，
 *   每超过 10 分钟再打开就要重下一遍 —— 手机上体感极差。
 *
 * 策略（保守，只碰真正需要缓存的路径）：
 *   - 仅拦截同源下 /paddleocr-models/ 与 /ort/ 前缀的 GET 请求，cache-first；
 *   - 页面 HTML、_next 脚本、模板 docx/xlsx、tessdata 等**一律不缓存**，直接走网络，
 *     这样应用发版后不会出现「用户被旧缓存卡住」的问题。
 *
 * 更新机制：
 *   资源文件名本身带版本（PP-OCRv6_tiny_...、ort-wasm-simd-threaded.wasm），
 *   内容变化时升级 CACHE_VERSION 即可整体换新；activate 会清理旧版本缓存。
 */
const CACHE_VERSION = "v31-1";
const CACHE_NAME = `ocr-assets-${CACHE_VERSION}`;
const ASSET_PATTERNS = [/\/paddleocr-models\//, /\/ort\//];

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
