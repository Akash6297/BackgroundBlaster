/* =========================================================
   BackgroundBlaster — app logic
   ---------------------------------------------------------
   Flow:  upload → normalise → remove.bg → composite at full
          resolution → Fabric.js editor → export (PNG/JPG/WEBP/
          AVIF/BMP, print sheet, clipboard)
   ========================================================= */
(() => {
  'use strict';

  /* ---------------- Configuration ---------------- */
  const CONFIG = {
    // Shared key with a small free quota. NOTE: any key in front-end code is
    // public. For production, proxy remove.bg through a small server function.
    sharedApiKey: '6A2FddUNck3phNAi34P2tGqc',
    apiBase: 'https://api.remove.bg/v1.0',
    contactEmail: 'akashmandal6297@gmail.com',
    maxFileBytes: 40 * 1024 * 1024,
    maxWorkSide: 4096,          // working copy limits (keeps mobile memory sane)
    maxWorkPixels: 12e6,
    maxExportPixels: 40e6,
    previewUploadSide: 1600,    // free "preview" calls return ≤0.25 MP anyway
    requestTimeoutMs: 90000,
  };

  // Passport presets are 300 DPI. `head` = target crown-to-chin height as a
  // fraction of photo height; `crown` = space above the head (fraction).
  const PRESETS = {
    original:          { label: 'Original size' },
    trim:              { label: 'Trimmed to subject' },
    'passport-us':     { w: 600, h: 600, dpi: 300, head: 0.60, crown: 0.10, label: '2 × 2 in' },
    'passport-eu':     { w: 413, h: 531, dpi: 300, head: 0.70, crown: 0.08, label: '35 × 45 mm' },
    'passport-ca':     { w: 591, h: 827, dpi: 300, head: 0.48, crown: 0.14, label: '50 × 70 mm' },
    'passport-cn':     { w: 390, h: 567, dpi: 300, head: 0.63, crown: 0.08, label: '33 × 48 mm' },
    'social-square':   { w: 1080, h: 1080 },
    'social-portrait': { w: 1080, h: 1350 },
    'social-story':    { w: 1080, h: 1920 },
    profile:           { w: 800, h: 800 },
    youtube:           { w: 1280, h: 720 },
    product:           { w: 2000, h: 2000 },
    custom:            {},
  };

  const FORMATS = {
    png:  { mime: 'image/png',  ext: 'png',  label: 'PNG',  alpha: true,  lossy: false },
    jpeg: { mime: 'image/jpeg', ext: 'jpg',  label: 'JPG',  alpha: false, lossy: true },
    webp: { mime: 'image/webp', ext: 'webp', label: 'WEBP', alpha: true,  lossy: true },
    avif: { mime: 'image/avif', ext: 'avif', label: 'AVIF', alpha: true,  lossy: true },
    bmp:  { mime: 'image/bmp',  ext: 'bmp',  label: 'BMP',  alpha: false, lossy: false },
  };

  const STORAGE = { apiKey: 'bb-api-key', theme: 'bb-theme' };

  /* ---------------- State ---------------- */
  const state = {
    fileName: 'image',
    original: null,      // canvas: oriented, size-capped working copy
    cutout: null,        // canvas: same size as original, background removed
    analysis: null,      // { bbox, head, touchesBottom }
    removed: false,
    quality: null,       // 'hd' | 'preview' | null
    subject: null,       // fabric.Image
    fitScale: 1,
    blurCanvas: null,
    bg: { type: 'transparent', color: '#ffffff', image: null },
    preset: 'original',
    out: { w: 0, h: 0 },
    format: 'png',
    lossyQuality: 0.92,
    scale: 1,
    abort: null,
    ready: false,
    busy: false,
  };
  let canvas = null;
  const accountCache = new Map();

  /* ---------------- DOM ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    navbar: $('#navbar'), navLinks: $('#nav-links'), burger: $('#burger'),
    themeBtn: $('#theme-btn'), settingsBtn: $('#settings-btn'),
    fileInput: $('#file-input'), dropzone: $('#dropzone'), dropOverlay: $('#drop-overlay'),
    editor: $('#editor'), fileName: $('#file-name'), statusChip: $('#status-chip'),
    quickDownload: $('#quick-download'),
    stageArea: $('#stage-area'), canvasHolder: $('#canvas-holder'), canvasEl: $('#editor-canvas'),
    compareImg: $('#compare-img'), loading: $('#stage-loading'), loadingText: $('#loading-text'),
    loadingPreview: $('#loading-preview'), cancelBtn: $('#cancel-btn'),
    error: $('#stage-error'), errorTitle: $('#error-title'), errorMessage: $('#error-message'),
    errorActions: $('#error-actions'), errorIcon: $('#stage-error .error-icon'),
    compareBtn: $('#compare-btn'), fitBtn: $('#fit-btn'), centerBtn: $('#center-btn'),
    flipBtn: $('#flip-btn'), resetBtn: $('#reset-btn'),
    sidebar: $('#sidebar'), bgNote: $('#bg-note'), retryRemovalBtn: $('#retry-removal-btn'),
    swatches: $$('#swatches [data-bg]'), customColor: $('#custom-color'),
    blurBtn: $('#blur-bg-btn'), bgImageBtn: $('#bg-image-btn'), bgImageInput: $('#bg-image-input'),
    sizeSelect: $('#size-select'), customSize: $('#custom-size'), customW: $('#custom-w'), customH: $('#custom-h'),
    sizeInfo: $('#size-info'),
    zoomRange: $('#zoom-range'), zoomValue: $('#zoom-value'),
    formatBtns: $$('#format-group [data-format]'), formatNote: $('#format-note'),
    qualityRow: $('#quality-row'), qualityRange: $('#quality-range'), qualityValue: $('#quality-value'),
    scaleBtns: $$('#scale-group [data-scale]'), outputInfo: $('#output-info'),
    downloadBtn: $('#download-btn'), copyBtn: $('#copy-btn'), sheetBtn: $('#sheet-btn'),
    dialog: $('#settings-dialog'), dialogClose: $('#settings-close'), quotaBox: $('#quota-box'),
    quotaText: $('#quota-text'), keyInput: $('#api-key-input'), toggleKeyBtn: $('#toggle-key-btn'),
    keyError: $('#key-error'), saveKeyBtn: $('#save-key-btn'), removeKeyBtn: $('#remove-key-btn'),
    contactForm: $('#contact-form'), toastStack: $('#toast-stack'), year: $('#year'),
  };

  /* =========================================================
     Utilities
     ========================================================= */
  class AppError extends Error {
    constructor(code, title, message) { super(message || title); this.code = code; this.title = title; }
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function fitScale(w, h, maxSide, maxPixels) {
    let s = Math.min(1, maxSide / Math.max(w, h));
    if (maxPixels && w * h * s * s > maxPixels) s = Math.sqrt(maxPixels / (w * h));
    return s;
  }

  function scaledCopy(src, scale, fill) {
    const c = makeCanvas(src.width * scale, src.height * scale);
    const ctx = c.getContext('2d');
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function decodeImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); img.naturalWidth ? resolve(img) : reject(new Error('empty')); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  function imageToCanvas(img, maxSide, maxPixels) {
    const s = fitScale(img.naturalWidth, img.naturalHeight, maxSide, maxPixels);
    const c = makeCanvas(img.naturalWidth * s, img.naturalHeight * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function canvasToBlob(c, mime, quality) {
    return new Promise((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), mime, quality);
    });
  }

  function supportsEncoding(mime) {
    try { return makeCanvas(1, 1).toDataURL(mime).startsWith(`data:${mime}`); } catch { return false; }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const clampInt = (v, min, max, fallback) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const formatBytes = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
  const baseName = (name) => (name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'image';
  const isImageFile = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i.test(f.name || '');

  /* ---------------- Toasts ---------------- */
  function toast(message, type = 'info', ms = 4000) {
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const icon = document.createElement('i');
    icon.className = `fa-solid ${icons[type] || icons.info}`;
    const text = document.createElement('span');
    text.textContent = message;
    el.append(icon, text);
    els.toastStack.appendChild(el);
    while (els.toastStack.children.length > 3) els.toastStack.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400);
    }, ms);
  }

  /* =========================================================
     remove.bg API
     ========================================================= */
  const getApiKey = () => store.get(STORAGE.apiKey) || CONFIG.sharedApiKey;
  const usingOwnKey = () => !!store.get(STORAGE.apiKey);

  async function fetchAccount(key, signal) {
    let res;
    try {
      res = await fetch(`${CONFIG.apiBase}/account`, { headers: { 'X-Api-Key': key }, signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new AppError('network', 'Connection problem', 'Check your internet connection and try again.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new AppError('auth_failed', 'API key not accepted', 'The remove.bg API key is invalid or disabled.');
    }
    if (!res.ok) throw new AppError('server', 'Could not check quota');
    const json = await res.json().catch(() => ({}));
    const a = (json && json.data && json.data.attributes) || {};
    return {
      credits: Number(a.credits && a.credits.total) || 0,
      freeCalls: Number(a.api && a.api.free_calls) || 0,
    };
  }

  // Decide the request size from the account balance so we never waste a
  // call: credits → full resolution ("hd"), otherwise the free "preview" size.
  async function chooseMode(key, signal) {
    let acc = accountCache.get(key);
    if (!acc) {
      try {
        acc = await fetchAccount(key, signal);
        accountCache.set(key, acc);
      } catch (e) {
        if (e.name === 'AbortError' || e.code === 'auth_failed') throw e;
        return 'hd'; // couldn't check — try HD, we fall back to preview on 402
      }
    }
    if (acc.credits >= 1) return 'hd';
    if (acc.freeCalls >= 1) return 'preview';
    throw quotaError();
  }

  function quotaError() {
    return usingOwnKey()
      ? new AppError('quota', 'Your API key is out of free images', 'Your remove.bg key has used its free images for this month. Buy credits on remove.bg or use a different key.')
      : new AppError('quota', 'Free monthly limit reached', 'The shared free quota is used up for this month. Add your own free remove.bg API key to continue — it takes about a minute.');
  }

  function mapApiError(status, code, title) {
    if (status === 402 || code === 'insufficient_credits') return quotaError();
    if (status === 401 || status === 403 || code === 'auth_failed') {
      return new AppError('auth_failed', 'API key not accepted', 'The remove.bg API key is invalid or disabled. Update it in API settings.');
    }
    if (status === 429) return new AppError('rate_limit', 'Too many requests', 'Please wait a few seconds and try again.');
    if (code === 'unknown_foreground' || /foreground/i.test(title || '')) {
      return new AppError('no_subject', "Couldn't find a clear subject", 'Try a photo where the person or object stands out clearly from the background.');
    }
    if (status === 400) return new AppError('bad_image', 'This image could not be processed', title || 'Please try a different photo.');
    return new AppError('server', 'The service is having trouble', 'Please try again in a moment.');
  }

  async function callRemoveBg(key, mode, signal) {
    const o = state.original;
    const scale = mode === 'hd' ? 1 : fitScale(o.width, o.height, CONFIG.previewUploadSide);
    // Re-encoding from our canvas applies EXIF orientation and strips metadata (e.g. GPS).
    const upload = scaledCopy(o, scale, '#ffffff');
    const blob = await canvasToBlob(upload, 'image/jpeg', mode === 'hd' ? 0.95 : 0.9);

    const form = new FormData();
    form.append('image_file', blob, 'image.jpg');
    form.append('size', mode === 'hd' ? 'auto' : 'preview');
    form.append('format', 'png');

    let res;
    try {
      res = await fetch(`${CONFIG.apiBase}/removebg`, { method: 'POST', headers: { 'X-Api-Key': key }, body: form, signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new AppError('network', 'Connection problem', 'Check your internet connection and try again.');
    }
    if (!res.ok) {
      let code = '', title = '';
      try {
        const j = await res.json();
        code = (j.errors && j.errors[0] && j.errors[0].code) || '';
        title = (j.errors && j.errors[0] && j.errors[0].title) || '';
      } catch { /* non-JSON error */ }
      throw mapApiError(res.status, code, title);
    }
    const acc = accountCache.get(key);
    if (acc) {
      if (mode === 'hd') acc.credits = Math.max(0, acc.credits - 1);
      else acc.freeCalls = Math.max(0, acc.freeCalls - 1);
    }
    return res.blob();
  }

  /* =========================================================
     Image pipeline
     ========================================================= */
  async function handleFile(file) {
    if (!file) return;
    if (!isImageFile(file)) { toast("That file isn't an image. Please choose a JPG, PNG or WEBP.", 'error'); return; }
    if (file.size > CONFIG.maxFileBytes) { toast('That image is larger than 40 MB. Please choose a smaller file.', 'error'); return; }

    let img;
    try {
      img = await decodeImage(file);
    } catch {
      toast("Your browser can't open this image format. Please use JPG, PNG or WEBP.", 'error');
      return;
    }

    if (state.abort) { state.abort.abort(); state.abort = null; }
    state.fileName = baseName(file.name);
    state.original = imageToCanvas(img, CONFIG.maxWorkSide, CONFIG.maxWorkPixels);
    state.cutout = null;
    state.analysis = null;
    state.subject = null;
    state.blurCanvas = null;
    state.removed = false;
    state.quality = null;
    setReady(false);

    const prev = scaledCopy(state.original, fitScale(state.original.width, state.original.height, 1200), '#ffffff');
    const previewURL = prev.toDataURL('image/jpeg', 0.85);
    els.loadingPreview.src = previewURL;
    els.compareImg.src = previewURL;

    els.fileName.textContent = file.name || 'Pasted image';
    els.fileName.title = file.name || '';
    revealEditor();
    runRemoval();
  }

  function revealEditor() {
    const wasHidden = els.editor.hidden;
    els.editor.hidden = false;
    ensureCanvas();
    if (wasHidden || els.editor.getBoundingClientRect().top > window.innerHeight * 0.5 || els.editor.getBoundingClientRect().bottom < 0) {
      els.editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function runRemoval() {
    if (!state.original) return;
    if (state.abort) state.abort.abort();
    const ctrl = new AbortController();
    state.abort = ctrl;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, CONFIG.requestTimeoutMs);

    setReady(false);
    showStage('loading');
    els.loadingText.textContent = 'Preparing your image…';

    try {
      const key = getApiKey();
      let mode = await chooseMode(key, ctrl.signal);
      els.loadingText.textContent = 'Removing background…';
      let blob;
      try {
        blob = await callRemoveBg(key, mode, ctrl.signal);
      } catch (e) {
        if (e.code === 'quota' && mode === 'hd') {
          mode = 'preview';
          blob = await callRemoveBg(key, mode, ctrl.signal);
        } else {
          throw e;
        }
      }
      els.loadingText.textContent = 'Finishing up…';
      let result;
      try { result = await decodeImage(blob); } catch { throw new AppError('server', 'Unexpected response', 'The service returned an unreadable image. Please try again.'); }
      if (ctrl !== state.abort) return; // superseded by a newer upload

      const cutout = buildCutout(result, mode);
      loadSubject(cutout, { removed: true, quality: mode });
      toast(mode === 'hd' ? 'Background removed in full resolution.' : 'Background removed!', 'success');
    } catch (err) {
      if (ctrl !== state.abort) return; // superseded
      let e = err;
      if (err && err.name === 'AbortError') {
        e = timedOut
          ? new AppError('timeout', 'This is taking too long', 'The service did not respond in time. Please try again.')
          : new AppError('cancelled', 'Cancelled', 'Background removal was cancelled.');
      } else if (!(err instanceof AppError)) {
        console.error(err);
        e = new AppError('server', 'Something went wrong', 'Please try again.');
      }
      showError(e);
    } finally {
      clearTimeout(timer);
      if (state.abort === ctrl) state.abort = null;
    }
  }

  // Build a full-resolution cutout. In "preview" mode remove.bg returns a small
  // image, so we use it only as an alpha mask over the sharp original pixels.
  function buildCutout(resultImg, mode) {
    const W = state.original.width, H = state.original.height;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (mode === 'preview') {
      ctx.drawImage(state.original, 0, 0);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(resultImg, 0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(resultImg, 0, 0, W, H);
    }
    return c;
  }

  // Find the subject's bounding box and (for portraits) estimate the head
  // position from the silhouette: widest row near the top = head, narrowest
  // row below it = neck, wider rows after that = shoulders.
  function analyzeSubject(cut, opaque) {
    const W = cut.width, H = cut.height;
    if (opaque) return { bbox: { x: 0, y: 0, w: W, h: H }, head: null, touchesBottom: true };

    const s = Math.min(1, 400 / Math.max(W, H));
    const sw = Math.max(1, Math.round(W * s)), sh = Math.max(1, Math.round(H * s));
    const small = makeCanvas(sw, sh);
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(cut, 0, 0, sw, sh);
    const data = sctx.getImageData(0, 0, sw, sh).data;

    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    const rowL = new Int32Array(sh).fill(-1);
    const rowR = new Int32Array(sh).fill(-1);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const a = data[(y * sw + x) * 4 + 3];
        if (a > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (a > 128) {
          if (rowL[y] < 0) rowL[y] = x;
          rowR[y] = x;
        }
      }
    }
    if (maxX < 0) return null;

    const inv = 1 / s;
    const x0 = Math.max(0, Math.floor((minX - 1) * inv));
    const y0 = Math.max(0, Math.floor((minY - 1) * inv));
    const x1 = Math.min(W, Math.ceil((maxX + 2) * inv));
    const y1 = Math.min(H, Math.ceil((maxY + 2) * inv));
    return {
      bbox: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) },
      head: detectHead(rowL, rowR, minY, maxY, inv),
      touchesBottom: maxY >= sh - 2 - Math.round(sh * 0.02),
    };
  }

  function detectHead(L, R, top, bottom, inv) {
    const bh = bottom - top + 1;
    if (bh < 24) return null;
    const width = (y) => (L[y] < 0 ? 0 : R[y] - L[y] + 1);

    let headMax = 0, headMaxY = top;
    for (let y = top; y <= top + Math.floor(bh * 0.4); y++) {
      const w = width(y);
      if (w > headMax) { headMax = w; headMaxY = y; }
    }
    if (!headMax) return null;

    let neckW = Infinity, neckY = -1;
    const end = Math.min(bottom, top + Math.floor(bh * 0.75));
    for (let y = headMaxY; y <= end; y++) {
      const w = width(y);
      if (w > 0 && w < neckW) { neckW = w; neckY = y; }
    }
    if (neckY < 0) return null;

    let belowMax = 0;
    for (let y = neckY; y <= bottom; y++) belowMax = Math.max(belowMax, width(y));
    if (!(neckW < headMax * 0.9 && belowMax > headMax * 1.25)) return null;

    const headH = (neckY - top) * 0.92;
    if (headH < bh * 0.12) return null;

    let sum = 0, n = 0;
    for (let y = top; y <= neckY; y++) {
      if (L[y] >= 0) { sum += (L[y] + R[y]) / 2; n++; }
    }
    if (!n) return null;
    return { top: top * inv, height: headH * inv, cx: (sum / n + 0.5) * inv };
  }

  /* =========================================================
     Editor (Fabric.js)
     ========================================================= */
  function ensureCanvas() {
    if (canvas) return canvas;
    if (!window.fabric) {
      toast('The editor failed to load. Please check your connection and refresh.', 'error', 8000);
      throw new Error('fabric missing');
    }
    fabric.Object.prototype.set({
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#4f46e5',
      borderColor: '#4f46e5',
      cornerStyle: 'circle',
      cornerSize: 12,
      touchCornerSize: 32,
      borderScaleFactor: 1.5,
      padding: 0,
    });
    canvas = new fabric.Canvas(els.canvasEl, {
      preserveObjectStacking: true,
      selection: false,
      controlsAboveOverlay: true,
      backgroundColor: '',
    });
    canvas.on('object:scaling', syncZoomSlider);
    canvas.on('object:modified', syncZoomSlider);
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => fitDisplay()).observe(els.stageArea);
    } else {
      window.addEventListener('resize', fitDisplay);
    }
    return canvas;
  }

  function loadSubject(cutout, { removed, quality }) {
    const analysis = analyzeSubject(cutout, !removed);
    if (!analysis) {
      throw new AppError('no_subject', "Couldn't find a clear subject", 'Try a photo where the person or object stands out clearly from the background.');
    }
    state.cutout = cutout;
    state.removed = removed;
    state.quality = quality;
    state.analysis = analysis;

    const { bbox } = analysis;
    const sub = makeCanvas(bbox.w, bbox.h);
    sub.getContext('2d').drawImage(cutout, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);

    ensureCanvas();
    canvas.clear();
    const obj = new fabric.Image(sub, {
      originX: 'center',
      originY: 'center',
      objectCaching: false,   // render from the full-res source (crisp exports)
      lockScalingFlip: true,
    });
    obj.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
    state.subject = obj;
    canvas.add(obj);

    showStage('ready');
    applyLayout(true);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    setReady(true);
    updateStatus();
  }

  function editWithoutRemoval() {
    if (!state.original) return;
    if (state.abort) { state.abort.abort(); state.abort = null; }
    loadSubject(state.original, { removed: false, quality: null });
    toast('Editing the original photo. You can still resize and convert it.', 'info');
  }

  function computeOutputSize() {
    const p = state.preset;
    if (p === 'original') return { w: state.original.width, h: state.original.height };
    if (p === 'trim') {
      const b = state.analysis.bbox;
      const pad = state.removed ? Math.round(Math.max(b.w, b.h) * 0.04) : 0;
      return { w: b.w + pad * 2, h: b.h + pad * 2 };
    }
    if (p === 'custom') {
      return { w: clampInt(els.customW.value, 16, 8000, 1080), h: clampInt(els.customH.value, 16, 8000, 1080) };
    }
    return { w: PRESETS[p].w, h: PRESETS[p].h };
  }

  function applyLayout(refit) {
    if (!state.subject) return;
    state.out = computeOutputSize();
    if (refit) placeSubject();
    applyBackground();
    fitDisplay();
    updateSizeInfo();
    updateExportUI();
  }

  function placeSubject() {
    const obj = state.subject;
    const { bbox, head, touchesBottom } = state.analysis;
    const W = state.out.w, H = state.out.h;
    const P = PRESETS[state.preset] || {};
    const bcx = bbox.x + bbox.w / 2, bcy = bbox.y + bbox.h / 2;
    let s, cx, cy;

    if (state.preset === 'original') {
      s = 1; cx = bcx; cy = bcy;                                   // exactly where it was
    } else if (!state.removed) {
      s = Math.max(W / bbox.w, H / bbox.h); cx = W / 2; cy = H / 2; // cover (no gaps)
    } else if (state.preset === 'trim') {
      s = 1; cx = W / 2; cy = H / 2;
    } else if (P.head && head) {
      s = (P.head * H) / head.height;                               // passport framing
      cx = W / 2 + (bcx - head.cx) * s;
      cy = P.crown * H + (bcy - head.top) * s;
    } else if (touchesBottom) {
      s = Math.min((W * 0.9) / bbox.w, (H * 0.88) / bbox.h);        // portrait: sit on bottom edge
      cx = W / 2; cy = H - (bbox.h * s) / 2;
    } else {
      s = Math.min((W * 0.84) / bbox.w, (H * 0.84) / bbox.h);       // object: centered
      cx = W / 2; cy = H / 2;
    }
    obj.set({ scaleX: s, scaleY: s, left: cx, top: cy, angle: 0 });
    obj.setCoords();
    state.fitScale = s;
    syncZoomSlider();
  }

  function getBlurCanvas() {
    if (state.blurCanvas) return state.blurCanvas;
    const o = state.original;
    const tiny = scaledCopy(o, 40 / Math.max(o.width, o.height));
    const mid = scaledCopy(tiny, 4);
    state.blurCanvas = scaledCopy(mid, 960 / Math.max(mid.width, mid.height));
    return state.blurCanvas;
  }

  function applyBackground() {
    if (!canvas) return;
    const { type, color } = state.bg;
    const W = state.out.w, H = state.out.h;
    canvas.backgroundColor = type === 'color' ? color : '';
    const src = type === 'blur' ? getBlurCanvas() : type === 'image' ? state.bg.image : null;
    let bgImg = null;
    if (src) {
      const s = Math.max(W / src.width, H / src.height);
      bgImg = new fabric.Image(src, {
        originX: 'left', originY: 'top',
        left: (W - src.width * s) / 2, top: (H - src.height * s) / 2,
        scaleX: s, scaleY: s, objectCaching: false, selectable: false, evented: false,
      });
    }
    canvas.setBackgroundImage(bgImg, () => canvas.requestRenderAll());
    canvas.requestRenderAll();
  }

  // Display the canvas scaled to fit the stage. The scene is always laid out
  // in output pixels; Fabric's zoom maps it to screen size.
  function fitDisplay() {
    if (!canvas || !state.out.w || els.canvasHolder.hidden) return;
    const box = els.stageArea.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const pad = window.innerWidth < 640 ? 14 : 28;
    const availW = Math.max(60, box.width - pad * 2);
    const availH = Math.max(60, box.height - pad * 2);
    const z = Math.min(availW / state.out.w, availH / state.out.h);
    const dw = Math.max(1, Math.floor(state.out.w * z));
    const dh = Math.max(1, Math.floor(state.out.h * z));
    if (canvas.getWidth() !== dw || canvas.getHeight() !== dh) canvas.setDimensions({ width: dw, height: dh });
    canvas.setZoom(dw / state.out.w);
    canvas.calcOffset();
    canvas.requestRenderAll();
  }

  function syncZoomSlider() {
    if (!state.subject || !state.fitScale) return;
    const pct = Math.round((state.subject.scaleX / state.fitScale) * 100);
    els.zoomRange.value = String(Math.min(300, Math.max(10, pct)));
    els.zoomValue.textContent = `${pct}%`;
  }

  /* =========================================================
     Stage states & status
     ========================================================= */
  function showStage(mode) {
    els.loading.hidden = mode !== 'loading';
    els.error.hidden = mode !== 'error';
    els.canvasHolder.hidden = mode !== 'ready';
    if (mode !== 'ready') setCompare(false);
    if (mode === 'ready') requestAnimationFrame(fitDisplay);
  }

  function showError(err) {
    showStage('error');
    setReady(false);
    els.errorTitle.textContent = err.title || 'Something went wrong';
    els.errorMessage.textContent = err.message && err.message !== err.title ? err.message : '';
    els.errorIcon.classList.toggle('warning', ['quota', 'cancelled', 'no_subject'].includes(err.code));

    const actions = [];
    const retry = { label: 'Try again', icon: 'fa-rotate-right', run: runRemoval };
    const original = { label: 'Edit without removing', icon: 'fa-pen', run: editWithoutRemoval };
    const settings = { label: usingOwnKey() ? 'Update API key' : 'Add your API key', icon: 'fa-key', run: openSettings };
    const another = { label: 'Upload another', icon: 'fa-arrow-up-from-bracket', run: pickFile };
    switch (err.code) {
      case 'quota':
      case 'auth_failed': actions.push(settings, original); break;
      case 'no_subject':
      case 'bad_image': actions.push(another, original); break;
      default: actions.push(retry, original);
    }
    els.errorActions.replaceChildren(...actions.map((a, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-ghost'}`;
      b.innerHTML = `<i class="fa-solid ${a.icon}"></i> `;
      b.append(a.label);
      b.addEventListener('click', a.run);
      return b;
    }));
  }

  function setReady(ready) {
    state.ready = ready;
    [els.downloadBtn, els.quickDownload, els.copyBtn, els.sheetBtn,
      els.compareBtn, els.fitBtn, els.centerBtn, els.flipBtn, els.resetBtn].forEach((b) => { b.disabled = !ready; });
    els.zoomRange.disabled = !ready;
    if (!ready) els.statusChip.hidden = true;
  }

  function updateStatus() {
    const chip = els.statusChip;
    chip.hidden = false;
    chip.className = 'status-chip';
    chip.title = '';
    chip.replaceChildren();
    const icon = document.createElement('i');
    if (state.removed && state.quality === 'hd') {
      chip.classList.add('success');
      icon.className = 'fa-solid fa-circle-check';
      chip.append(icon, ' Background removed · HD');
    } else if (state.removed) {
      chip.classList.add('success');
      icon.className = 'fa-solid fa-circle-check';
      chip.append(icon, ' Background removed');
      chip.title = 'Free quality. Edges are upscaled from a smaller mask — add a remove.bg key with credits for full-HD edges.';
    } else {
      icon.className = 'fa-regular fa-image';
      chip.append(icon, ' Original photo');
    }
    els.sidebar.classList.toggle('bg-disabled', !state.removed);
    els.bgNote.hidden = state.removed;
  }

  function setCompare(on) {
    els.compareBtn.setAttribute('aria-pressed', String(on));
    els.compareImg.hidden = !on;
    if (els.canvasHolder) els.canvasHolder.style.visibility = on ? 'hidden' : '';
  }

  /* =========================================================
     Export
     ========================================================= */
  function renderOutput(scale, flatten) {
    const active = canvas.getActiveObject();
    if (active) canvas.discardActiveObject();
    const outW = Math.max(1, Math.round(state.out.w * scale));
    const outH = Math.max(1, Math.round(state.out.h * scale));
    const m = scale / canvas.getZoom();
    // The cropping box is in display pixels; the +0.25 guards against float
    // truncation so the canvas comes out at exactly outW × outH.
    const el = canvas.toCanvasElement(m, { left: 0, top: 0, width: (outW + 0.25) / m, height: (outH + 0.25) / m });
    if (active) canvas.setActiveObject(active);
    canvas.requestRenderAll();
    if (!flatten) return el;
    const flat = makeCanvas(el.width, el.height);
    const ctx = flat.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(el, 0, 0);
    return flat;
  }

  function currentDpi() {
    const p = PRESETS[state.preset];
    return p && p.dpi ? Math.round(p.dpi * state.scale) : null;
  }

  async function encode(el, formatKey, dpi) {
    const f = FORMATS[formatKey];
    if (formatKey === 'bmp') return encodeBMP(el, dpi || 96);
    const blob = await canvasToBlob(el, f.mime, f.lossy ? state.lossyQuality : undefined);
    if (dpi && formatKey === 'png') return setPngDpi(blob, dpi);
    if (dpi && formatKey === 'jpeg') return setJpegDpi(blob, dpi);
    return blob;
  }

  async function withBusy(btn, fn) {
    if (state.busy) return;
    state.busy = true;
    btn.classList.add('is-busy');
    try { await nextFrame(); await fn(); } finally { state.busy = false; btn.classList.remove('is-busy'); }
  }

  function doDownload(triggerBtn) {
    if (!state.ready) return;
    return withBusy(triggerBtn || els.downloadBtn, async () => {
      const f = FORMATS[state.format];
      try {
        const el = renderOutput(state.scale, !f.alpha);
        const blob = await encode(el, state.format, currentDpi());
        downloadBlob(blob, `${state.fileName}-backgroundblaster.${f.ext}`);
        toast(`Saved ${f.label} · ${el.width} × ${el.height} px · ${formatBytes(blob.size)}`, 'success');
      } catch (e) {
        console.error(e);
        toast('Could not export the image. Try a lower resolution or another format.', 'error');
      }
    });
  }

  function doCopy() {
    if (!state.ready) return;
    if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) {
      toast("Copying images isn't supported in this browser — use Download instead.", 'error');
      return;
    }
    return withBusy(els.copyBtn, async () => {
      try {
        const blobPromise = canvasToBlob(renderOutput(state.scale, false), 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
        toast('Image copied to clipboard.', 'success');
      } catch (e) {
        console.error(e);
        toast("Couldn't copy the image. Use Download instead.", 'error');
      }
    });
  }

  // Lay out as many copies as fit on 4 × 6 in photo paper at 300 DPI.
  function doPrintSheet() {
    if (!state.ready) return;
    return withBusy(els.sheetBtn, async () => {
      const P = PRESETS[state.preset];
      let tile = renderOutput(P && P.dpi ? 1 : Math.min(4, 600 / state.out.h), true); // non-print sizes → 2 in tall
      if (tile.width > 1800) tile = scaledCopy(tile, 1800 / tile.width);

      const layouts = [[1800, 1200], [1200, 1800]].map(([sw, sh]) => {
        const cols = Math.floor(sw / tile.width), rows = Math.floor(sh / tile.height);
        return { sw, sh, cols, rows, n: cols * rows };
      }).sort((a, b) => b.n - a.n);
      const L = layouts[0];
      if (!L.n) { toast('This size is too large for a 4 × 6 in sheet.', 'error'); return; }

      const sheet = makeCanvas(L.sw, L.sh);
      const ctx = sheet.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, L.sw, L.sh);
      const gx = (L.sw - L.cols * tile.width) / (L.cols + 1);
      const gy = (L.sh - L.rows * tile.height) / (L.rows + 1);
      ctx.strokeStyle = '#c9ced8';
      ctx.lineWidth = 1;
      for (let r = 0; r < L.rows; r++) {
        for (let c = 0; c < L.cols; c++) {
          const x = Math.round(gx + c * (tile.width + gx));
          const y = Math.round(gy + r * (tile.height + gy));
          ctx.drawImage(tile, x, y);
          ctx.strokeRect(x + 0.5, y + 0.5, tile.width - 1, tile.height - 1); // cut guide
        }
      }
      try {
        const blob = await setJpegDpi(await canvasToBlob(sheet, 'image/jpeg', 0.95), 300);
        downloadBlob(blob, `${state.fileName}-print-4x6.jpg`);
        toast(`${L.n} photos on a 4 × 6 in sheet. Print at 100% ("actual size").`, 'success', 6000);
      } catch (e) {
        console.error(e);
        toast('Could not create the print sheet.', 'error');
      }
    });
  }

  /* ---------- Encoders / metadata ---------- */
  function encodeBMP(c, dpi) {
    const w = c.width, h = c.height;
    const data = c.getContext('2d').getImageData(0, 0, w, h).data;
    const rowSize = Math.ceil((w * 3) / 4) * 4;
    const size = 54 + rowSize * h;
    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    const ppm = Math.round(dpi / 0.0254);
    u8[0] = 0x42; u8[1] = 0x4d;
    dv.setUint32(2, size, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(34, rowSize * h, true);
    dv.setInt32(38, ppm, true);
    dv.setInt32(42, ppm, true);
    for (let y = 0; y < h; y++) {
      let o = 54 + (h - 1 - y) * rowSize;
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        u8[o++] = data[i + 2];
        u8[o++] = data[i + 1];
        u8[o++] = data[i];
      }
    }
    return new Blob([buf], { type: 'image/bmp' });
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Write a pHYs chunk so printers/apps know the physical size.
  async function setPngDpi(blob, dpi) {
    try {
      const src = new Uint8Array(await blob.arrayBuffer());
      const ppm = Math.round(dpi / 0.0254);
      const chunk = new Uint8Array(21);
      const dv = new DataView(chunk.buffer);
      dv.setUint32(0, 9);
      chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
      dv.setUint32(8, ppm);
      dv.setUint32(12, ppm);
      chunk[16] = 1; // unit: metre
      dv.setUint32(17, crc32(chunk.subarray(4, 17)));

      // Walk chunks; replace an existing pHYs or insert one after IHDR.
      let pos = 8, insertAt = -1;
      const view = new DataView(src.buffer);
      while (pos + 8 <= src.length) {
        const len = view.getUint32(pos);
        const type = String.fromCharCode(src[pos + 4], src[pos + 5], src[pos + 6], src[pos + 7]);
        if (type === 'IHDR') insertAt = pos + 12 + len;
        if (type === 'pHYs') {
          const out = new Uint8Array(src);
          out.set(chunk.subarray(8), pos + 8);
          new DataView(out.buffer).setUint32(pos + 17, crc32(out.subarray(pos + 4, pos + 17)));
          return new Blob([out], { type: 'image/png' });
        }
        if (type === 'IDAT') break;
        pos += 12 + len;
      }
      if (insertAt < 0) return blob;
      return new Blob([src.subarray(0, insertAt), chunk, src.subarray(insertAt)], { type: 'image/png' });
    } catch {
      return blob;
    }
  }

  // Set JFIF density (DPI) if the encoder wrote a JFIF APP0 header.
  async function setJpegDpi(blob, dpi) {
    try {
      const u8 = new Uint8Array(await blob.arrayBuffer());
      const isJfif = u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff && u8[3] === 0xe0 &&
        u8[6] === 0x4a && u8[7] === 0x46 && u8[8] === 0x49 && u8[9] === 0x46 && u8[10] === 0;
      if (!isJfif) return blob;
      u8[13] = 1; // dots per inch
      u8[14] = dpi >> 8; u8[15] = dpi & 0xff;
      u8[16] = dpi >> 8; u8[17] = dpi & 0xff;
      return new Blob([u8], { type: 'image/jpeg' });
    } catch {
      return blob;
    }
  }

  /* =========================================================
     Sidebar UI
     ========================================================= */
  function updateSizeInfo() {
    const P = PRESETS[state.preset] || {};
    let text = `${state.out.w} × ${state.out.h} px`;
    if (P.dpi) text += ` · ${P.label} at ${P.dpi} DPI. Head position is estimated — check official rules.`;
    else if (state.preset === 'original') text += ' · same as your photo';
    els.sizeInfo.textContent = text;
  }

  function updateExportUI() {
    const f = FORMATS[state.format];
    els.formatBtns.forEach((b) => {
      const on = b.dataset.format === state.format;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    els.qualityRow.hidden = !f.lossy;
    els.downloadBtn.querySelector('span').textContent = `Download ${f.label}`;

    const transparentBg = state.removed && state.bg.type === 'transparent';
    if (!f.alpha && transparentBg) els.formatNote.textContent = `${f.label} doesn't support transparency — transparent areas will be white. Choose PNG or WEBP to keep them.`;
    else if (state.format === 'png') els.formatNote.textContent = 'Best quality. Keeps transparency.';
    else if (state.format === 'jpeg') els.formatNote.textContent = 'Smallest files. Accepted everywhere.';
    else if (state.format === 'webp') els.formatNote.textContent = 'Small files with transparency. Great for websites.';
    else if (state.format === 'avif') els.formatNote.textContent = 'Next-gen format with very small files.';
    else els.formatNote.textContent = 'Uncompressed bitmap for older software.';

    const W = state.out.w, H = state.out.h;
    els.scaleBtns.forEach((b) => {
      const s = parseFloat(b.dataset.scale);
      const tooBig = W * H * s * s > CONFIG.maxExportPixels;
      b.disabled = !!W && tooBig;
      if (b.disabled && state.scale === s) state.scale = 1;
    });
    els.scaleBtns.forEach((b) => {
      const on = parseFloat(b.dataset.scale) === state.scale;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    if (W) {
      const ow = Math.round(W * state.scale), oh = Math.round(H * state.scale);
      const dpi = currentDpi();
      els.outputInfo.textContent = `Output: ${ow} × ${oh} px${dpi ? ` · ${dpi} DPI` : ''}`;
    }
  }

  function selectBackground(type, color) {
    state.bg.type = type;
    if (color) state.bg.color = color;
    els.swatches.forEach((s) => {
      const on = (type === 'transparent' && s.dataset.bg === 'transparent') ||
        (type === 'color' && s.dataset.bg && s.dataset.bg.toLowerCase() === (color || '').toLowerCase());
      s.classList.toggle('active', on);
      s.setAttribute('aria-checked', String(on));
    });
    const customOn = type === 'color' && !els.swatches.some((s) => s.classList.contains('active'));
    els.customColor.parentElement.classList.toggle('active', customOn);
    els.blurBtn.classList.toggle('active', type === 'blur');
    els.bgImageBtn.classList.toggle('active', type === 'image');
    applyBackground();
    updateExportUI();
  }

  function pickFile() {
    els.fileInput.value = '';
    els.fileInput.click();
  }

  /* =========================================================
     Settings dialog
     ========================================================= */
  function setQuota(text, kind) {
    els.quotaText.textContent = text;
    els.quotaBox.className = `quota-box${kind ? ` ${kind}` : ''}`;
  }

  function describeAccount(acc, own) {
    const who = own ? 'Your key' : 'Built-in key';
    if (acc.credits >= 1) return [`${who}: ${acc.credits} credits (full-HD results) · ${acc.freeCalls} free images left this month.`, 'ok'];
    if (acc.freeCalls >= 1) return [`${who}: ${acc.freeCalls} free images left this month.`, 'ok'];
    return [`${who}: no free images left this month.${own ? '' : ' Add your own free key below.'}`, 'warn'];
  }

  async function refreshQuota() {
    const key = getApiKey();
    setQuota('Checking quota…');
    try {
      const acc = await fetchAccount(key);
      accountCache.set(key, acc);
      const [t, k] = describeAccount(acc, usingOwnKey());
      setQuota(t, k);
    } catch (e) {
      setQuota(e.code === 'auth_failed' ? 'The current key was rejected by remove.bg.' : "Couldn't check the quota right now.", 'warn');
    }
  }

  function openSettings() {
    els.keyInput.value = store.get(STORAGE.apiKey) || '';
    els.keyInput.type = 'password';
    els.keyError.hidden = true;
    els.removeKeyBtn.hidden = !usingOwnKey();
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
    refreshQuota();
    setTimeout(() => els.keyInput.focus(), 50);
  }

  function closeSettings() {
    if (typeof els.dialog.close === 'function') els.dialog.close();
    else els.dialog.removeAttribute('open');
  }

  async function saveKey() {
    const key = els.keyInput.value.trim();
    els.keyError.hidden = true;
    if (!key) { els.keyError.textContent = 'Please paste your API key.'; els.keyError.hidden = false; return; }
    els.saveKeyBtn.classList.add('is-busy');
    try {
      const acc = await fetchAccount(key);
      accountCache.set(key, acc);
      store.set(STORAGE.apiKey, key);
      const [t, k] = describeAccount(acc, true);
      setQuota(t, k);
      toast('API key saved.', 'success');
      closeSettings();
      if (state.original && !els.error.hidden) runRemoval();
    } catch (e) {
      els.keyError.textContent = e.code === 'auth_failed' ? 'remove.bg rejected this key. Please check it and try again.' : "Couldn't verify the key. Check your connection.";
      els.keyError.hidden = false;
    } finally {
      els.saveKeyBtn.classList.remove('is-busy');
    }
  }

  function removeKey() {
    store.remove(STORAGE.apiKey);
    els.keyInput.value = '';
    els.removeKeyBtn.hidden = true;
    toast('Switched back to the built-in key.', 'info');
    refreshQuota();
  }

  /* =========================================================
     Wiring
     ========================================================= */
  function setupNav() {
    const onScroll = () => els.navbar.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    els.burger.addEventListener('click', () => {
      const open = els.navLinks.classList.toggle('open');
      els.burger.setAttribute('aria-expanded', String(open));
      els.burger.innerHTML = open ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
    });
    $$('.nav-link').forEach((a) => a.addEventListener('click', () => {
      els.navLinks.classList.remove('open');
      els.burger.setAttribute('aria-expanded', 'false');
      els.burger.innerHTML = '<i class="fa-solid fa-bars"></i>';
    }));

    // Scroll-spy
    if ('IntersectionObserver' in window) {
      const links = new Map($$('.nav-link').map((a) => [a.getAttribute('href').slice(1), a]));
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          links.forEach((a) => a.classList.remove('active'));
          const a = links.get(e.target.id);
          if (a) a.classList.add('active');
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      links.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
    }
  }

  function setupTheme() {
    const isDark = () => {
      const t = document.documentElement.getAttribute('data-theme');
      if (t) return t === 'dark';
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    };
    const paint = () => { els.themeBtn.innerHTML = isDark() ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>'; };
    els.themeBtn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      store.set(STORAGE.theme, next);
      paint();
    });
    paint();
  }

  function setupUpload() {
    $$('[data-action="pick-file"]').forEach((b) => b.addEventListener('click', pickFile));
    $$('[data-action="open-settings"]').forEach((b) => b.addEventListener('click', openSettings));
    els.dropzone.addEventListener('click', (e) => { if (e.target === els.dropzone) pickFile(); });
    els.fileInput.addEventListener('change', () => handleFile(els.fileInput.files[0]));

    // Drop anywhere on the page
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const hide = () => { depth = 0; els.dropOverlay.hidden = true; els.dropzone.classList.remove('dragover'); };
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      els.dropOverlay.hidden = false;
      els.dropzone.classList.add('dragover');
    });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) hide();
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      hide();
      handleFile(e.dataTransfer.files[0]);
    });

    // Paste from clipboard
    window.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          e.preventDefault();
          handleFile(it.getAsFile());
          return;
        }
      }
    });
  }

  function setupEditorControls() {
    els.cancelBtn.addEventListener('click', () => { if (state.abort) state.abort.abort(); });
    els.retryRemovalBtn.addEventListener('click', runRemoval);

    els.compareBtn.addEventListener('click', () => setCompare(els.compareBtn.getAttribute('aria-pressed') !== 'true'));
    els.fitBtn.addEventListener('click', () => { placeSubject(); canvas.requestRenderAll(); });
    els.centerBtn.addEventListener('click', () => {
      state.subject.set({ left: state.out.w / 2, top: state.out.h / 2 });
      state.subject.setCoords();
      canvas.requestRenderAll();
    });
    els.flipBtn.addEventListener('click', () => {
      state.subject.set('flipX', !state.subject.flipX);
      canvas.requestRenderAll();
    });
    els.resetBtn.addEventListener('click', () => {
      state.subject.set('flipX', false);
      selectBackground('transparent');
      placeSubject();
      canvas.requestRenderAll();
      toast('Edits reset.', 'info');
    });

    els.zoomRange.addEventListener('input', () => {
      if (!state.subject) return;
      const v = parseInt(els.zoomRange.value, 10) / 100;
      state.subject.scale(state.fitScale * v);
      state.subject.setCoords();
      els.zoomValue.textContent = `${Math.round(v * 100)}%`;
      canvas.requestRenderAll();
    });

    // Background
    els.swatches.forEach((s) => s.addEventListener('click', () => {
      const v = s.dataset.bg;
      if (v === 'transparent') selectBackground('transparent');
      else if (v === 'blur') selectBackground('blur');
      else selectBackground('color', v);
    }));
    els.customColor.addEventListener('input', () => selectBackground('color', els.customColor.value));
    els.blurBtn.addEventListener('click', () => selectBackground('blur'));
    els.bgImageBtn.addEventListener('click', () => { els.bgImageInput.value = ''; els.bgImageInput.click(); });
    els.bgImageInput.addEventListener('change', async () => {
      const f = els.bgImageInput.files[0];
      if (!f) return;
      try {
        const img = await decodeImage(f);
        state.bg.image = imageToCanvas(img, 3000, 8e6);
        selectBackground('image');
      } catch {
        toast("Couldn't open that background image.", 'error');
      }
    });

    // Size
    els.sizeSelect.addEventListener('change', () => {
      state.preset = els.sizeSelect.value;
      els.customSize.hidden = state.preset !== 'custom';
      applyLayout(true);
    });
    [els.customW, els.customH].forEach((inp) => inp.addEventListener('change', () => {
      inp.value = clampInt(inp.value, 16, 8000, 1080);
      if (state.preset === 'custom') applyLayout(true);
    }));

    // Export
    els.formatBtns.forEach((b) => b.addEventListener('click', () => { state.format = b.dataset.format; updateExportUI(); }));
    els.scaleBtns.forEach((b) => b.addEventListener('click', () => { state.scale = parseFloat(b.dataset.scale); updateExportUI(); }));
    els.qualityRange.addEventListener('input', () => {
      state.lossyQuality = parseInt(els.qualityRange.value, 10) / 100;
      els.qualityValue.textContent = `${els.qualityRange.value}%`;
    });
    els.downloadBtn.addEventListener('click', () => doDownload(els.downloadBtn));
    els.quickDownload.addEventListener('click', () => doDownload(els.quickDownload));
    els.copyBtn.addEventListener('click', doCopy);
    els.sheetBtn.addEventListener('click', doPrintSheet);
    if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) els.copyBtn.hidden = true;

    // Hide formats this browser can't encode
    els.formatBtns.forEach((b) => {
      const k = b.dataset.format;
      if (k === 'webp' || k === 'avif') b.hidden = !supportsEncoding(FORMATS[k].mime);
    });

    // Ctrl/Cmd + S → download
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.ready) {
        e.preventDefault();
        doDownload(els.downloadBtn);
      }
    });
  }

  function setupSettings() {
    els.settingsBtn.addEventListener('click', openSettings);
    els.dialogClose.addEventListener('click', closeSettings);
    els.saveKeyBtn.addEventListener('click', saveKey);
    els.removeKeyBtn.addEventListener('click', removeKey);
    els.keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } });
    els.toggleKeyBtn.addEventListener('click', () => {
      const show = els.keyInput.type === 'password';
      els.keyInput.type = show ? 'text' : 'password';
      els.toggleKeyBtn.innerHTML = show ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
      els.toggleKeyBtn.setAttribute('aria-label', show ? 'Hide key' : 'Show key');
    });
    els.dialog.addEventListener('click', (e) => { if (e.target === els.dialog) closeSettings(); });
  }

  function setupContact() {
    els.contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fields = ['c-name', 'c-email', 'c-message'].map((id) => document.getElementById(id));
      let valid = true;
      fields.forEach((f) => {
        const ok = f.value.trim() && f.checkValidity();
        f.closest('.form-field').classList.toggle('invalid', !ok);
        if (!ok) valid = false;
      });
      if (!valid) { toast('Please fill in your name, a valid email and a message.', 'error'); return; }
      const [name, email, message] = fields.map((f) => f.value.trim());
      const subject = encodeURIComponent(`BackgroundBlaster — message from ${name}`);
      const body = encodeURIComponent(`${message}\n\n— ${name} (${email})`);
      window.location.href = `mailto:${CONFIG.contactEmail}?subject=${subject}&body=${body}`;
      toast('Opening your email app…', 'info');
    });
    els.contactForm.addEventListener('input', (e) => {
      const field = e.target.closest('.form-field');
      if (field) field.classList.remove('invalid');
    });
  }

  /* ---------------- Init ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    els.year.textContent = String(new Date().getFullYear());
    setupNav();
    setupTheme();
    setupUpload();
    setupEditorControls();
    setupSettings();
    setupContact();
    setReady(false);
  });
})();
