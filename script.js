/* ─────────────────────────────────────────────────────────────
   爱豆人生四格 · WebApp
   纯静态，可直接部署到 GitHub Pages。
   要加新模板：把透明 PNG 丢进目录，往 TEMPLATES 里加一条即可。
   frames 的坐标单位 = 模板 PNG 的像素。
   ───────────────────────────────────────────────────────────── */

const TEMPLATES = [
  {
    id: 'gift',
    name: '\u{1F381}',
    file: 'template.png',
    width: 640,
    height: 1644,
    frames: [
      { x: 0, y:    0, w: 640, h: 402 },
      { x: 0, y:  413, w: 640, h: 413 },
      { x: 0, y:  840, w: 640, h: 395 },
      { x: 0, y: 1246, w: 640, h: 398 }
    ]
  }
];

const SHOTS = 4;

/* ── DOM ── */
const $ = (id) => document.getElementById(id);
const views = { home: $('view-home'), shoot: $('view-shoot'), result: $('view-result') };
const cam = $('cam');
const shotPreview = $('shotPreview');
const overlay = $('overlay');
const stage = $('stage');
const strip = $('strip');
const toastEl = $('toast');

/* ── 状态 ── */
let tpl = null;          // 当前模板
let tplImg = null;       // 已加载的模板 Image
let shots = [];          // 每格的 canvas
let idx = 0;             // 当前格
let facing = 'user';     // user | environment
let stream = null;
let busy = false;        // 倒计时中
let camFailed = false;   // 摄像头不可用，走选图兜底
let lastBlobUrl = null;

/* ═════════════ 首页 ═════════════ */

function buildHome() {
  const list = $('tplList');
  list.innerHTML = '';
  TEMPLATES.forEach((t) => {
    const li = document.createElement('li');
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tpl-card';
    card.innerHTML =
      `<span class="tpl-thumb" style="background-image:url('${t.file}')"></span>` +
      `<span class="tpl-meta">` +
        `<h2>${t.name}</h2>` +
        `<span class="tpl-go">开始拍摄 →</span>` +
      `</span>`;
    card.addEventListener('click', () => startSession(t));
    li.appendChild(card);
    list.appendChild(li);
  });

  if (!window.isSecureContext) $('ctxNote').hidden = false;
}

function show(name) {
  Object.values(views).forEach((v) => v.classList.remove('is-on'));
  views[name].classList.add('is-on');
  window.scrollTo(0, 0);
}

/* ═════════════ 拍摄 ═════════════ */

async function startSession(t) {
  tpl = t;
  shots = new Array(SHOTS).fill(null);
  idx = 0;
  buildStrip();
  show('shoot');
  try {
    tplImg = await loadImage(t.file);
  } catch (e) {
    camError('模板图片没加载出来，检查一下 ' + t.file + ' 在不在同一个目录。');
    return;
  }
  setFrame(0);
  openCamera();
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

/* 把模板中「当前这一格」贴到取景框上：整张模板按比例放大后偏移，只露出该格 */
function paintOverlay() {
  const f = tpl.frames[idx];
  const k = stage.clientWidth / f.w;
  if (!k) return;
  overlay.style.backgroundImage = `url('${tpl.file}')`;
  overlay.style.backgroundSize = `${tpl.width * k}px ${tpl.height * k}px`;
  overlay.style.backgroundPosition = `${-f.x * k}px ${-f.y * k}px`;
}

function setFrame(i) {
  idx = i;
  const f = tpl.frames[i];
  stage.style.aspectRatio = `${f.w}/${f.h}`;
  $('stepNow').textContent = i + 1;
  paintOverlay();
  liveMode();
  markStrip();
}

function liveMode() {
  cam.hidden = false;
  shotPreview.hidden = true;
  $('ctrlShoot').hidden = false;
  $('ctrlConfirm').hidden = true;
  $('btnShoot').disabled = !stream;
  $('camState').hidden = !camFailed;
  $('shootHint').textContent = '站到爱豆旁边的空位上';
}

/* ── 摄像头 ── */

async function openCamera() {
  stopCamera();
  $('camState').hidden = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camError('这个浏览器不支持摄像头调用，换 Chrome 或 Safari 试试。');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    cam.srcObject = stream;
    cam.classList.toggle('mirror', facing === 'user');
    shotPreview.classList.toggle('mirror', false);
    await cam.play().catch(() => {});
    camFailed = false;
    $('camState').hidden = true;
    $('btnShoot').disabled = false;
  } catch (err) {
    const map = {
      NotAllowedError: '摄像头权限被拒绝了。到浏览器的网站设置里重新允许，然后刷新页面。',
      NotFoundError: '没找到摄像头设备。',
      NotReadableError: '摄像头被别的应用占用了，关掉它再回来。',
      OverconstrainedError: '这台设备没有对应的镜头，点「翻转镜头」换一个。'
    };
    camError(map[err.name] || ('摄像头打不开：' + err.name + '。注意页面要跑在 https 或 localhost 下。'));
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

function camError(msg) {
  camFailed = true;
  $('camMsg').textContent = msg;
  $('camState').hidden = false;
  $('btnShoot').disabled = true;
}

/* ── 倒计时 + 拍摄 ── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot() {
  if (busy || !stream) return;
  busy = true;
  $('btnShoot').disabled = true;

  const box = $('count'), num = $('countNum');
  box.hidden = false;
  for (let n = 3; n >= 1; n--) {
    num.textContent = n;
    num.style.animation = 'none';
    void num.offsetWidth;
    num.style.animation = '';
    beep(n === 1 ? 880 : 620, 0.07);
    await sleep(760);
  }
  box.hidden = true;

  $('flash').classList.add('go');
  beep(1400, 0.05);
  setTimeout(() => $('flash').classList.remove('go'), 420);

  capture();
  busy = false;
}

function capture() {
  captureFrom(cam, cam.videoWidth, cam.videoHeight, facing === 'user');
}

/* 摄像头和「选一张图」共用这段：按取景框比例居中裁切 */
function captureFrom(src, sw, sh, mirror) {
  const f = tpl.frames[idx];
  const c = document.createElement('canvas');
  c.width = f.w; c.height = f.h;
  const ctx = c.getContext('2d');

  const scale = Math.max(f.w / sw, f.h / sh);
  const dw = sw * scale, dh = sh * scale;

  ctx.save();
  if (mirror) { ctx.translate(f.w, 0); ctx.scale(-1, 1); }   // 与预览一致的镜像
  ctx.drawImage(src, (f.w - dw) / 2, (f.h - dh) / 2, dw, dh);
  ctx.restore();

  shots[idx] = c;
  $('camState').hidden = true;

  shotPreview.width = f.w;
  shotPreview.height = f.h;
  shotPreview.getContext('2d').drawImage(c, 0, 0);
  shotPreview.hidden = false;
  cam.hidden = true;

  $('ctrlShoot').hidden = true;
  $('ctrlConfirm').hidden = false;
  $('btnNext').textContent = shots.every(Boolean) ? '完成，看成片' : '继续';
  markStrip();
}

/* ── 迷你四格进度 ── */

function buildStrip() {
  strip.innerHTML = '';
  for (let i = 0; i < SHOTS; i++) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot';
    b.dataset.n = i + 1;
    b.setAttribute('aria-label', `第 ${i + 1} 格`);
    b.addEventListener('click', () => {
      if (busy) return;
      setFrame(i);
    });
    li.appendChild(b);
    strip.appendChild(li);
  }
}

function markStrip() {
  [...strip.querySelectorAll('.slot')].forEach((el, i) => {
    el.classList.toggle('now', i === idx);
    if (shots[i]) {
      el.classList.add('filled');
      el.style.backgroundImage = `url('${shots[i].toDataURL('image/jpeg', 0.6)}')`;
    } else {
      el.classList.remove('filled');
      el.style.backgroundImage = '';
    }
  });
}

/* ═════════════ 合成 & 结果 ═════════════ */

function compose() {
  const c = document.createElement('canvas');
  c.width = tpl.width; c.height = tpl.height;
  const ctx = c.getContext('2d');
  tpl.frames.forEach((f, i) => {
    if (shots[i]) ctx.drawImage(shots[i], f.x, f.y, f.w, f.h);
  });
  ctx.drawImage(tplImg, 0, 0, tpl.width, tpl.height);   // 模板永远盖在最上层
  return c;
}

function toResult() {
  stopCamera();
  const canvas = compose();
  canvas.toBlob((blob) => {
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = URL.createObjectURL(blob);
    const box = $('print');
    box.innerHTML = '';
    const im = new Image();
    im.src = lastBlobUrl;
    im.alt = '爱豆人生四格成片';
    box.appendChild(im);
    show('result');
  }, 'image/png');
}

function saveImage() {
  if (!lastBlobUrl) return;
  const a = document.createElement('a');
  a.href = lastBlobUrl;
  a.download = `idol-4cut-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已保存。iOS 上如果没反应，长按上面的图片存到相册。');
}

async function shareImage() {
  if (!lastBlobUrl) return;
  try {
    const blob = await (await fetch(lastBlobUrl)).blob();
    const file = new File([blob], 'idol-4cut.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '爱豆人生四格' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  toast('这个浏览器不支持直接分享，先下载再发吧。');
}

function goHome() {
  stopCamera();
  shots = []; idx = 0; tpl = null; busy = false;
  if (lastBlobUrl) { URL.revokeObjectURL(lastBlobUrl); lastBlobUrl = null; }
  $('print').innerHTML = '';
  show('home');
}

/* ── 小提示 ── */
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

/* ── 极简快门音（不依赖音频文件） ── */
let actx = null;
function beep(freq, dur) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.05, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur + 0.02);
  } catch (e) { /* 静音就静音 */ }
}

/* ── 兜底：不用摄像头，直接选一张图 ──
   iframe 预览环境、微信/微博内置浏览器里 getUserMedia 常常拿不到权限，
   这条路走的是系统文件选择器（手机上会直接弹相机/相册），基本哪都能用。 */
function pickFile() {
  if (!tpl) return;
  const inp = $('filePick');
  inp.value = '';
  inp.click();
}

$('filePick').addEventListener('change', async () => {
  const file = $('filePick').files && $('filePick').files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImage(url);
    captureFrom(im, im.naturalWidth, im.naturalHeight, false);
    beep(1400, 0.05);
  } catch (e) {
    toast('这张图读不出来，换一张试试。');
  }
  URL.revokeObjectURL(url);
});

/* ═════════════ 事件绑定 ═════════════ */

$('btnShoot').addEventListener('click', shoot);
$('btnPick').addEventListener('click', pickFile);
$('btnPick2').addEventListener('click', pickFile);

$('btnRetake').addEventListener('click', () => {
  shots[idx] = null;
  markStrip();
  liveMode();
});

$('btnNext').addEventListener('click', () => {
  const next = shots.findIndex((s) => s === null);
  if (next === -1) toResult();
  else setFrame(next);
});

$('btnFlip').addEventListener('click', () => {
  facing = (facing === 'user') ? 'environment' : 'user';
  openCamera();
});

$('btnBack').addEventListener('click', goHome);
$('btnHome').addEventListener('click', goHome);
$('btnSave').addEventListener('click', saveImage);
$('btnShare').addEventListener('click', shareImage);
$('btnAgain').addEventListener('click', () => { const t = tpl; goHome(); startSession(t); });

new ResizeObserver(() => { if (tpl) paintOverlay(); }).observe(stage);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopCamera();
  else if (views.shoot.classList.contains('is-on') && !stream) openCamera();
});

buildHome();
