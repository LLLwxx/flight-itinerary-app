/*
 * 行程单助手 Service Worker（v33）
 *
 * 为什么需要：
 *   GitHub Pages 对静态资源的响应头是 `Cache-Control: max-age=600`，只有 10 分钟。
 *   识别模型（6.3MB）、ORT 推理内核（14MB）、PaddleOCR.js 的 SDK chunk（9.99MB）
 *   体积大、又是不可变内容，每超过 10 分钟再打开就要重下一遍 —— 手机上体感极差。
 *
 * 策略：
 *   - 拦截同源下四类 GET：/paddleocr-models/、/ort/、/_next/static/chunks/、
 *     /_next/static/media/ort*，一律 cache-first；
 *   - 页面 HTML、模板 docx/xlsx、tessdata 等**不缓存**，直接走网络，
 *     这样应用发版后不会出现「用户被旧缓存卡住」的问题。
 *
 * v33 变更：
 *   补上 `_next/static/chunks/` —— 实测二次访问时 3.31MB 的 SDK chunk 仍要重下 3.17s，
 *   这是除模型/内核外最大的一块，缓存后二次访问端到端 4.7s → 约 1.5s。
 *   Next 的 chunk 文件名带内容 hash，缓存旧文件不会顶替新文件；CACHE_VERSION 升级会整体清理。
 *
 * 更新机制：
 *   内容变化时升级 CACHE_VERSION 即可整体换新；activate 会清理旧版本缓存。
 */
const CACHE_VERSION = "v33-1";
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
