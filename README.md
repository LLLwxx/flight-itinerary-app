# 电子客票行程单助手（flight-itinerary-app）

拍照识别行程单（机票 / 火车票 / 酒店确认单）→ 自动填充 Word / Excel 模板 → 导出下载。

- 在线使用：<https://lllwxx.github.io/flight-itinerary-app/>
- 全程浏览器本地处理（OCR + 模板填充），图片不上传，手机 / 电脑通用。
- OCR 引擎链（三级自动回退）：本地 PaddleOCR 服务（开发机）→ **PaddleOCR.js 浏览器端
  （PP-OCRv5 + onnxruntime-web WASM/WebGPU，模型与推理内核全部同源自托管）** → Tesseract.js。
  静态站无 COOP/COEP 头，ORT 以单线程 WASM 运行（`numThreads:1 + proxy:false`），手机可用。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:3000
```

## 静态导出（GitHub Pages 部署）

```bash
node scripts/build-static.mjs        # 产出 out/（STATIC_EXPORT=1 + basePath=/flight-itinerary-app）
python scripts/upload-gh-pages.py out LLLwxx flight-itinerary-app   # GITHUB_TOKEN=ghp_xxx 全量上传
```

注意：部署需在仓库根放置空 `.nojekyll` 文件，否则 GitHub Pages(Jekyll) 会忽略 `_next` 目录导致资源 404。
