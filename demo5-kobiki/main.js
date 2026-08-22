/* ============================================================
   木挽舎 — 一本の丸太が、柱になるまで
   コンセプトの1語 =「木取り」。動きは 切る・現れる・積む の3種だけ。

   構成:
     [A] DOM層  … 出現・木取り線・オドメーター（Three.jsに依存しない）
     [B] 3D層   … Three.js。読み込みに失敗しても [A] は動く

   スクロールは乗っ取らない。ネイティブのまま読み、カメラ側が lerp 0.08 で追う。
   ============================================================ */

"use strict";

const root = document.documentElement;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = matchMedia("(max-width: 700px)").matches;
const DEBUG = /[?&]debug\b/.test(location.search);

/* easing。CSS変数と同じ曲線を3種だけ使う */
const outQuart = (t) => 1 - Math.pow(1 - t, 4);
const inoutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sub = (v, a, b) => clamp01((v - a) / (b - a));   /* 全体進捗から部分進捗を切り出す */

/* ════════════════════════════════════════════════════════════
   [A] DOM層
   ════════════════════════════════════════════════════════════ */

/* ── A-1. 出現（マスク内せり上がり／フェード）──────────────── */
function initReveal() {
  const targets = document.querySelectorAll(".js-rise, .js-fade");
  if (reduce || !("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-show"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-show");
        io.unobserve(e.target);
      });
    },
    { rootMargin: "0px 0px -18% 0px", threshold: 0.01 }
  );
  targets.forEach((el) => io.observe(el));
}

/* ── A-2. 木取り線（署名の瞬間）────────────────────────────
   線を1本ずつ引く。800ms/本・間隔120ms・out-quart。
   引き終えてから芯の印と部材の記入が入る（同時に動かさない）。 */
const kizuri = (() => {
  const svg = document.getElementById("kizuri");
  const lines = svg ? [...svg.querySelectorAll(".kd-anim")] : [];
  const late = svg ? [...svg.querySelectorAll(".k-late")] : [];
  let done = false;

  /* 実際のパス長を測って dasharray を上書きする（HTMLの概算値より正確） */
  lines.forEach((p) => {
    const len = p.getTotalLength();
    p.style.setProperty("--len", len.toFixed(1));
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
  });

  function paint(t) {
    lines.forEach((p, i) => {
      const len = p.getTotalLength();
      const f = outQuart(sub(t, i * 120, i * 120 + 800));
      p.style.strokeDashoffset = (len * (1 - f)).toFixed(1);
    });
    const lateF = outQuart(sub(t, 1400, 2200));
    late.forEach((g, i) => (g.style.opacity = outQuart(sub(t, 1400 + i * 160, 2200 + i * 160)).toFixed(3)));
    return lateF;
  }

  function draw() {
    if (done || !svg) return;
    done = true;
    if (reduce) { paint(9999); return; }
    const t0 = performance.now();
    (function step(now) {
      const t = now - t0;
      paint(t);
      if (t < 2400) requestAnimationFrame(step);
    })(t0);
  }

  return { draw, paint, get done() { return done; } };
})();

/* ── A-3. オドメーター（含水率・経過月）────────────────────
   桁ごとに縦へ転がす。1の位を速く、10の位を遅く回す。 */
function initOdometer() {
  const els = [...document.querySelectorAll(".odo")];
  if (!els.length) return;

  const reels = els.map((el) => {
    const to = Number(el.dataset.odo);
    const from = Number(el.dataset.from);
    const digits = Number(el.dataset.fixed || String(to).length);
    el.textContent = "";
    el.setAttribute("aria-label", String(to));
    const cols = [];
    for (let i = 0; i < digits; i++) {
      const d = document.createElement("span");
      d.className = "odo-d";
      d.setAttribute("aria-hidden", "true");
      const i2 = document.createElement("i");
      i2.textContent = "0123456789012".split("").join("\n");
      i2.style.whiteSpace = "pre";
      d.appendChild(i2);
      el.appendChild(d);
      cols.push(i2);
    }
    return { el, from, to, digits, cols };
  });

  function render(r, value) {
    const s = String(Math.round(value)).padStart(r.digits, "0").slice(-r.digits);
    for (let i = 0; i < r.digits; i++) {
      /* 1桁ぶんの高さ = 1em。数字列は 0..9 を並べてあるので digit 分だけ上げる */
      r.cols[i].style.transform = `translate3d(0, ${-Number(s[i])}em, 0)`;
    }
  }

  /* 初期表示は「到達値」。ここを from にすると、何かの理由で回らなかったときに
     32%（乾く前の値）が出たままになり、数字が嘘になる */
  reels.forEach((r) => render(r, r.to));

  function run() {
    if (reduce) return;                       /* すでに到達値が出ている */
    reels.forEach((r) => render(r, r.from));  /* 回す直前に開始値へ戻す */
    const t0 = performance.now();
    (function step(now) {
      const t = now - t0;
      let alive = false;
      reels.forEach((r, idx) => {
        const dur = 1500 + idx * 200;            /* 行ごとに尺を変える */
        const f = inoutQuart(sub(t, idx * 180, idx * 180 + dur));
        render(r, r.from + (r.to - r.from) * f);
        if (t < idx * 180 + dur) alive = true;
      });
      if (alive) requestAnimationFrame(step);
    })(t0);
  }

  const g = document.getElementById("gauge");
  if (!g || !("IntersectionObserver" in window)) { run(); return; }
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) { io.disconnect(); run(); } });
  }, { threshold: 0.6 });
  io.observe(g);
}

/* ── A-4. 章の位置を測る ──────────────────────────────────
   発注文の 15 / 35 / 60 / 80% は「章の切れ目」のこと。
   数字を焼き込まず、実際のレイアウトから測る（画面幅が変わっても崩れない）。 */
const track = {
  marks: [],
  max: 1,
  measure() {
    const ids = ["ch2", "ch3", "ch4", "ch5"];
    const tops = ids.map((id) => {
      const el = document.querySelector("." + id);
      return el ? el.getBoundingClientRect().top + window.scrollY : 0;
    });
    this.max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    this.marks = [0, ...tops, this.max];
  },
  /* 現在地を「第n幕 + その中の進捗」に割る */
  stageAt(y) {
    const m = this.marks;
    for (let i = 0; i < m.length - 1; i++) {
      if (y < m[i + 1] || i === m.length - 2) {
        return { i, f: clamp01((y - m[i]) / Math.max(1, m[i + 1] - m[i])) };
      }
    }
    return { i: 0, f: 0 };
  },
  percent(y) { return clamp01(y / this.max); },
};

/* ════════════════════════════════════════════════════════════
   [B] 3D層
   ════════════════════════════════════════════════════════════ */

/* ── B-1. 手ざわりを作るテクスチャ（すべてその場で描く）──────
   外部の画像もモデルも取りに行かない。木口の実写1枚だけが例外。 */

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}

/* 樹皮：縦に裂けた繊維。丸太の長さ方向へ走らせる */
function barkCanvas() {
  const [c, g] = makeCanvas(512, 512);
  g.fillStyle = "#4B3826";
  g.fillRect(0, 0, 512, 512);
  /* 縦に走る樹皮の板。幅を大きくばらして、麺のような等間隔にしない */
  let px = 0;
  while (px < 532) {
    const wPlate = 14 + Math.random() * 44;
    const tone = 0.55 + Math.random() * 0.75;
    g.fillStyle = `rgb(${Math.round(84 * tone)},${Math.round(62 * tone)},${Math.round(41 * tone)})`;
    g.beginPath();
    g.moveTo(px, -20);
    let x = px, y = -20;
    while (y < 532) { y += 40 + Math.random() * 90; x += (Math.random() - 0.5) * 16; g.lineTo(x, y); }
    let x2 = px + wPlate, y2 = 532;
    g.lineTo(x2, y2);
    while (y2 > -20) { y2 -= 40 + Math.random() * 90; x2 += (Math.random() - 0.5) * 16; g.lineTo(x2, y2); }
    g.closePath();
    g.fill();
    /* 板と板のあいだの深い溝 */
    g.strokeStyle = `rgba(14,10,6,${0.55 + Math.random() * 0.4})`;
    g.lineWidth = 1.5 + Math.random() * 4;
    g.stroke();
    px += wPlate + 1 + Math.random() * 5;
  }
  /* 板の中の繊維。細く、控えめに */
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = i % 2 ? `rgba(20,14,9,${0.1 + Math.random() * 0.3})` : `rgba(146,118,84,${0.05 + Math.random() * 0.14})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath();
    let x = Math.random() * 512, y = Math.random() * 380 - 30;
    g.moveTo(x, y);
    const end = y + 90 + Math.random() * 210;
    while (y < end) { y += 24 + Math.random() * 40; x += (Math.random() - 0.5) * 7; g.lineTo(x, y); }
    g.stroke();
  }
  /* 粗い粒。無菌にしないための不揃い */
  const im = g.getImageData(0, 0, 512, 512), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(im, 0, 0);
  return c;
}

/* 板目：山形の木理。seed を変えて5枚とも別の顔にする。
   1枚だけ節を入れる（「節は出ます」の裏付け） */
function grainCanvas(seed, knots) {
  const [c, g] = makeCanvas(512, 512);
  let s = seed * 9781 + 1013;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  g.fillStyle = "#9C8163";
  g.fillRect(0, 0, 512, 512);
  const bow = 90 + rnd() * 150;          /* 木理の山の高さ */
  const shift = rnd() * 512;
  for (let i = 0; i < 130; i++) {
    const y = (i / 130) * 620 - 60 + shift % 8;
    const late = i % 4 === 0;             /* 晩材＝濃い筋 */
    g.strokeStyle = late
      ? `rgba(78,58,38,${0.3 + rnd() * 0.3})`
      : `rgba(132,109,81,${0.1 + rnd() * 0.16})`;
    g.lineWidth = late ? 1.6 + rnd() * 2.4 : 0.9 + rnd() * 1.4;
    g.beginPath();
    g.moveTo(-20, y);
    g.bezierCurveTo(150, y - bow * (0.5 + rnd() * 0.2), 360, y + bow * (0.35 + rnd() * 0.25), 532, y - 8);
    g.stroke();
  }
  for (let k = 0; k < knots; k++) {
    const kx = 120 + rnd() * 280, ky = 120 + rnd() * 280, kr = 16 + rnd() * 16;
    for (let r = kr; r > 0; r -= 1.6) {
      g.strokeStyle = `rgba(58,38,20,${0.14 + (1 - r / kr) * 0.5})`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(kx, ky, r, r * (0.55 + rnd() * 0.2), rnd() * 0.6, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const im = g.getImageData(0, 0, 512, 512), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 20;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(im, 0, 0);
  return c;
}

/* 土間コンクリート。作業灯の輪をここに焼いておく（後処理は使わない） */
function floorCanvas() {
  const [c, g] = makeCanvas(512, 512);
  g.fillStyle = "#17150F";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5200; i++) {
    const r = Math.random();
    g.fillStyle = r < 0.5 ? "rgba(12,11,9,.55)" : "rgba(96,89,78,.22)";
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  /* 灯りの輪。中心が明るく、外へ落ちる */
  const rad = g.createRadialGradient(256, 256, 40, 256, 256, 250);
  rad.addColorStop(0, "rgba(255,236,206,.20)");
  rad.addColorStop(0.40, "rgba(180,158,128,.055)");
  rad.addColorStop(1, "rgba(8,7,6,.97)");
  g.fillStyle = rad;
  g.fillRect(0, 0, 512, 512);
  /* 落ちた鋸屑。掃き跡の線ではなく、粒で置く（線を引くと板張りに見える） */
  for (let i = 0; i < 380; i++) {
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 170;
    g.fillStyle = `rgba(178,155,118,${0.008 + Math.random() * 0.014})`;
    g.fillRect(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 1, 1 + Math.random());
  }
  return c;
}

/* ── B-2. 場面 ────────────────────────────────────────────── */
async function init3D() {
  if (reduce) return;
  const canvas = document.getElementById("stage");
  if (!canvas) return;

  /* WebGLが無い環境ではここで降りる。物語はHTML側に全部ある */
  try {
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return;
  } catch (_) { return; }

  let THREE;
  try { THREE = await import("three"); }
  catch (e) { console.warn("[木挽舎] three.js を読み込めませんでした。静的な章立てで表示します。", e); return; }

  /* ---- 寸法。すべてメートル。実寸そのまま ---------------- */
  const R = 0.18;          /* 末口径 360mm の半径 */
  const LEN = 3.2;         /* 玉切りの長さ */
  const XCAP = -LEN / 2;   /* 木口の位置 */
  /* 木取り：6本の線が作る5つの部材（幅・厚み・断面中心。単位m） */
  const PIECES = [
    { w: 0.199, t: 0.048, y: -0.126, seed: 3, knots: 0 },
    { w: 0.297, t: 0.048, y: -0.078, seed: 11, knots: 1 },
    { w: 0.343, t: 0.058, y: -0.025, seed: 7, knots: 0 },
    { w: 0.275, t: 0.112, y: 0.060, seed: 5, knots: 1, post: true },  /* 芯を含む＝柱取り */
    { w: 0.193, t: 0.036, y: 0.134, seed: 19, knots: 0 },
  ];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isPhone, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.5 : 2));
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  if (!isPhone) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x141312, 2.6, 8.5);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
  camera.position.set(2.4, 1.0, 2.9);

  /* ---- 光：key 1灯 + fill 1灯 + 環境光。bloom等は使わない ---- */
  const key = new THREE.DirectionalLight(0xffe6c6, 3.0);
  key.position.set(-1.6, 2.9, 2.4);
  if (!isPhone) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const s = key.shadow.camera;
    s.left = -2.6; s.right = 2.6; s.top = 2.2; s.bottom = -2.2; s.near = 0.5; s.far = 9;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
  }
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8fa4b8, 0.7);
  fill.position.set(3.2, 1.1, -2.6);
  scene.add(fill);

  scene.add(new THREE.AmbientLight(0x5d5449, 0.46));

  /* ---- 床。丸太の影を受けるためだけに置く ---------------- */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(floorCanvas()), roughness: 0.97, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.215;          /* 丸太も桟積みもこの上に載る */
  floor.receiveShadow = !isPhone;
  scene.add(floor);

  /* ---- テクスチャ ---------------------------------------- */
  const bark = new THREE.CanvasTexture(barkCanvas());
  bark.colorSpace = THREE.SRGBColorSpace;
  bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
  bark.repeat.set(2.1, 1.5);
  bark.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  /* 木口の実写は <picture> が選んだ img を流用する。TextureLoader で取り直すと
     同じ画像を2回落とすことになるため。ただし <img> をそのまま Texture に渡すと
     CSS上の表示サイズ（562px等）で登録されてしまうので、実寸のキャンバスに写す。 */
  const koguchiImg = document.querySelector("#koguchi img");
  const [kc, kg] = makeCanvas(isPhone ? 512 : 1024, isPhone ? 512 : 1024);
  const koguchi = new THREE.CanvasTexture(kc);
  koguchi.colorSpace = THREE.SRGBColorSpace;
  koguchi.center.set(0.5, 0.5);
  koguchi.anisotropy = bark.anisotropy;
  let onKoguchiReady = null;
  function paintKoguchi() {
    if (!koguchiImg || !koguchiImg.naturalWidth) return;
    kg.drawImage(koguchiImg, 0, 0, kc.width, kc.height);
    koguchi.needsUpdate = true;
    if (onKoguchiReady) onKoguchiReady();
  }
  if (koguchiImg) {
    if (koguchiImg.complete && koguchiImg.naturalWidth) paintKoguchi();
    else koguchiImg.addEventListener("load", paintKoguchi, { once: true });
  }

  const barkMat = new THREE.MeshStandardMaterial({ map: bark, bumpMap: bark, bumpScale: 1.6, roughness: 0.94, metalness: 0 });
  const capMat = new THREE.MeshStandardMaterial({ map: koguchi, roughness: 0.88, metalness: 0 });

  /* ---- 丸太。CylinderGeometry を寝かせて長さをX軸に取る ---- */
  const world = new THREE.Group();
  scene.add(world);

  const spin = new THREE.Group();          /* 自転させる入れ物 */
  world.add(spin);

  const logGeo = new THREE.CylinderGeometry(R, R * 1.045, LEN, 64, 1, false);
  const log = new THREE.Mesh(logGeo, [barkMat, capMat, capMat]);
  log.rotation.z = Math.PI / 2;            /* 軸をXへ。+Y側の蓋が -X（手前）に来る */
  log.castShadow = !isPhone;
  spin.add(log);

  /* ---- 5つの部材 ----------------------------------------- */
  /* 板の木口（両端の面）は、丸太の木口写真から「その板が取れた場所」を切り出して貼る。
     CylinderGeometry の蓋UVは u←ワールドZ（幅）・v←ワールドY（厚み）なので、
     写真の矩形をそのまま切り出せば向きが合う。 */
  function endGrainTexture(p) {
    const S = kc.width, half = S / 2, perM = half / R;     /* 1mあたりのpx */
    const sx = half - (p.w / 2) * perM, sw = p.w * perM;
    const sy = half - (p.y + p.t / 2) * perM, sh = p.t * perM;
    const cw = Math.max(24, Math.round(p.w * 700)), chh = Math.max(12, Math.round(p.t * 700));
    const [ec, eg] = makeCanvas(cw, chh);
    eg.fillStyle = "#9C7B55"; eg.fillRect(0, 0, cw, chh);
    if (koguchiImg && koguchiImg.naturalWidth) eg.drawImage(kc, sx, sy, sw, sh, 0, 0, cw, chh);
    const t = new THREE.CanvasTexture(ec);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = bark.anisotropy;
    return t;
  }

  const boards = PIECES.map((p, i) => {
    const tex = new THREE.CanvasTexture(grainCanvas(p.seed, p.knots));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2.2, 1);
    tex.anisotropy = bark.anisotropy;
    const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 0.35, roughness: 0.9, metalness: 0 });
    const endMat = new THREE.MeshStandardMaterial({ map: endGrainTexture(p), roughness: 0.92, metalness: 0 });
    p.endMat = endMat;
    /* 面の順は [+X, -X, +Y, -Y, +Z, -Z]。±X が木口。
       6グループのままだと板1枚で6回描くので、木口2面と側面4面の2グループに束ねる */
    const geo = new THREE.BoxGeometry(LEN, p.t, p.w);
    geo.clearGroups();
    geo.addGroup(0, 12, 0);    /* +X, -X = 木口 */
    geo.addGroup(12, 24, 1);   /* 残り4面 = 板目 */
    const m = new THREE.Mesh(geo, [endMat, mat]);
    m.position.set(0, p.y, 0);
    m.castShadow = !isPhone;
    m.receiveShadow = !isPhone;
    m.visible = false;
    spin.add(m);
    return { mesh: m, mat, ...p, base: p.y };
  });

  /* ---- 鋸が通ったところに出る木口（挽いた瞬間の断面）------ */
  const cutFace = new THREE.Mesh(new THREE.CircleGeometry(R, 64), capMat.clone());
  cutFace.rotation.y = -Math.PI / 2;
  cutFace.visible = false;
  spin.add(cutFace);

  /* ---- 桟木。1回の描画でまとめて出す ---------------------- */
  const STICK_X = [-1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35];
  const stickCount = STICK_X.length * 4;
  const sticks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.03, 0.03, 0.30),
    new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.95, metalness: 0 }),
    stickCount
  );
  sticks.castShadow = !isPhone;
  sticks.visible = false;
  world.add(sticks);

  /* ---- 背景の桟積み（先月挽いたぶん）。モバイルは半分 ------ */
  const BG_N = isPhone ? 8 : 16;
  const bgStack = new THREE.InstancedMesh(
    new THREE.BoxGeometry(LEN * 0.96, 1, 1),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(grainCanvas(23, 1)), roughness: 0.96, metalness: 0 }),
    BG_N
  );
  bgStack.visible = false;
  world.add(bgStack);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < BG_N; i++) {
      const th = 0.03 + (i % 3) * 0.012;
      m.compose(
        new THREE.Vector3(0.05 * ((i % 5) - 2) - 0.35, -0.19 + i * 0.043, -1.75),
        q,
        new THREE.Vector3(1, th, 0.22 + (i % 4) * 0.035)
      );
      bgStack.setMatrixAt(i, m);
    }
    bgStack.instanceMatrix.needsUpdate = true;
  }

  /* ---- 粉塵。製材所の空気。ごく遅く漂うだけ -------------- */
  const DUST_N = isPhone ? 120 : 280;
  const dustPos = new Float32Array(DUST_N * 3);
  const dustV = new Float32Array(DUST_N);
  for (let i = 0; i < DUST_N; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 5.2;
    dustPos[i * 3 + 1] = Math.random() * 1.6 - 0.2;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 3.0;
    dustV[i] = 0.004 + Math.random() * 0.012;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0xc8ac7e, size: 0.008, sizeAttenuation: true, transparent: true, opacity: 0.14, depthWrite: false })
  );
  scene.add(dust);

  /* ---- 挽き割り用の面。頂点は動かさない ------------------ */
  const planeLog = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);    /* x >= xs を残す */
  const planeCut = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);   /* x <= xs を残す */
  barkMat.clippingPlanes = [planeLog];
  capMat.clippingPlanes = [planeLog];
  boards.forEach((b) => { b.mat.clippingPlanes = [planeCut]; b.endMat.clippingPlanes = [planeCut]; });

  /* 写真が遅れて届いた場合は、板の木口を貼り直す */
  onKoguchiReady = () => boards.forEach((b) => {
    b.endMat.map.dispose();
    b.endMat.map = endGrainTexture(b);
    b.endMat.needsUpdate = true;
  });
  if (koguchiImg && koguchiImg.complete && koguchiImg.naturalWidth) onKoguchiReady();

  root.classList.add("webgl");

  /* ── B-3. カメラの道筋 ────────────────────────────────
     第0幕 0–15%  丸太の側面に沿って移動
     第1幕 15–35% 木口の正面へ回り込む
     第2幕 35–60% 鋸が通る／板が扇状に開く
     第3幕 60–80% 桟積み・光が暖色へ
     第4幕 80–100% 柱が立つ                                   */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const camPos = new THREE.Vector3().copy(camera.position);
  const camTgt = new THREE.Vector3(0, 0, 0);
  const wantPos = new THREE.Vector3();
  const wantTgt = new THREE.Vector3();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  /* 縦長の画面では、3.2mの丸太を横に置いたままでは絶対に収まらない
     （縦画角34度・アスペクト0.46だと横に見える幅が距離の0.28倍しかない）。
     だから縦のときは「木口の側から見て、長さを奥へ逃がす」構図に差し替える。
     柱が立つ章5だけは縦画面のほうが有利なので、そのまま活かす。 */
  let portrait = window.innerHeight > window.innerWidth * 1.15;

  const KEY_P = [
    /* i=0 章0→章1：木口の手前から、長さは奥へ */
    { p0: V(-3.05, 0.88, 1.90), t0: V(-1.15, 0.02, 0), p1: V(-2.35, 0.30, 0.95), t1: V(-1.45, 0, 0), off: 0, ease: outQuart },
    /* i=1 章2 木取り：木口が画面幅いっぱいに来る距離 */
    { p0: V(-2.35, 0.30, 0.95), t0: V(-1.45, 0, 0), p1: V(XCAP - 1.36, 0, 0.02), t1: V(XCAP, 0, 0), off: 0, ease: inoutQuart },
    /* i=2 章3 製材：切り口の側から、扇の開きを見る */
    { p0: V(XCAP - 1.36, 0, 0.02), t0: V(XCAP, 0, 0), p1: V(-3.15, 0.95, 1.65), t1: V(-1.05, 0.10, 0), off: 0, ease: outQuart },
    /* i=3 章4 桟積み：山の木口側。桟の隙間が段になって見える */
    { p0: V(-3.15, 0.95, 1.65), t0: V(-1.05, 0.10, 0), p1: V(-2.45, 0.55, 1.35), t1: V(-1.15, -0.02, 0), off: 0, ease: inoutQuart },
    /* i=4 章5 柱：縦画面がいちばん効く場面 */
    { p0: V(-2.45, 0.55, 1.35), t0: V(-1.15, -0.02, 0), p1: V(1.35, 0.55, 3.15), t1: V(-0.62, 0.72, 0.28), off: 0, ease: inoutQuart },
  ];

  const KEY_L = [
    /* i=0 章0→章1：全景から、丸太の側面に沿って寄る */
    { p0: V(2.60, 1.15, 3.85), t0: V(0.30, 0.0, 0), p1: V(-1.05, 0.34, 1.95), t1: V(-0.30, 0, 0), off: 0.13, ease: outQuart },
    /* i=1 章2 木取り：木口の正面へ回り込む。ここだけ画面中央に戻す */
    { p0: V(-1.05, 0.34, 1.95), t0: V(-0.30, 0, 0), p1: V(XCAP - 0.78, 0, 0.02), t1: V(XCAP, 0, 0), off: 0.0, ease: inoutQuart },
    /* i=2 章3 製材：手前から見て奥へ逃がす。長さが縮んで扇が大きく見える */
    { p0: V(XCAP - 0.78, 0, 0.02), t0: V(XCAP, 0, 0), p1: V(-2.75, 1.15, 2.85), t1: V(-0.10, 0.06, 0), off: 0.11, ease: outQuart },
    /* i=3 章4 桟積み：段と桟が読める高さまで下りる */
    { p0: V(-2.75, 1.15, 2.85), t0: V(-0.10, 0.06, 0), p1: V(2.35, 0.62, 2.95), t1: V(-0.15, 0.0, -0.55), off: 0.11, ease: inoutQuart },
    /* i=4 章5 柱：根元まで寄って見上げる */
    { p0: V(2.35, 0.62, 2.95), t0: V(-0.15, 0.0, -0.55), p1: V(1.25, 0.30, 3.05), t1: V(-0.70, 0.62, 0.10), off: 0.10, ease: inoutQuart },
  ];

  const KEY = () => (portrait ? KEY_P : KEY_L);

  /* 桟積みの段の高さ（下から：柱・板58・板48・板48・板36）*/
  const STACK_ORDER = [3, 2, 1, 0, 4];
  const stackY = (() => {
    const out = new Array(5);
    let y = -0.21;
    STACK_ORDER.forEach((idx) => {
      out[idx] = y + boards[idx].t / 2;
      y += boards[idx].t + 0.03;
    });
    return out;
  })();

  /* ── B-4. 状態 ──────────────────────────────────────── */
  let spinAngle = 0;
  let settleFrom = null;
  let scrollY = window.scrollY;
  let viewOffX = 0, viewOffY = 0;
  const keyWarm = new THREE.Color(0xffe6c6);
  const warmTarget = new THREE.Color(0xffd39a);
  let running = true, last = performance.now();

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    portrait = h > w * 1.15;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyViewOffset(w, h);
  }
  function applyViewOffset(w, h) {
    if (Math.abs(viewOffX) < 0.001 && Math.abs(viewOffY) < 0.001) camera.clearViewOffset();
    else camera.setViewOffset(w, h, w * viewOffX, h * viewOffY, w, h);
    camera.updateProjectionMatrix();
  }

  const koguchiEl = document.getElementById("koguchi");

  function frame(now) {
    if (!running) return;
    frameBody(now);
    requestAnimationFrame(frame);
  }

  function frameBody(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const { i, f } = track.stageAt(scrollY);
    const T = KEY();
    const k = T[Math.min(i, T.length - 1)];
    const e = k.ease(f);

    /* --- カメラの目標値。スクロールは奪わず、カメラだけが追う --- */
    wantPos.copy(k.p0).lerp(k.p1, e);
    wantTgt.copy(k.t0).lerp(k.t1, e);
    /* 画面のずらしは「前の幕の値 → この幕の値」。木口の幕(i=1)だけ 0＝中央に戻す */
    const offPrev = i === 0 ? T[0].off : T[i - 1].off;
    const nextOff = offPrev + (k.off - offPrev) * e;
    const wantOffX = isPhone ? 0 : nextOff;
    /* 縦画面は被写体を少し上へ逃がして、下半分を文字に譲る。
       木口の幕(i=1)だけは中央へ戻す（DOMの木口と重ねるため） */
    const wantOffY = portrait ? 0.14 * (i === 1 ? 1 - e : 1) : 0;

    camPos.lerp(wantPos, 0.08);
    camTgt.lerp(wantTgt, 0.08);
    camera.position.copy(camPos);
    camera.lookAt(camTgt);

    if (Math.abs(wantOffX - viewOffX) > 0.0005 || Math.abs(wantOffY - viewOffY) > 0.0005) {
      viewOffX += (wantOffX - viewOffX) * 0.08;
      viewOffY += (wantOffY - viewOffY) * 0.08;
      applyViewOffset(window.innerWidth, window.innerHeight);
    }

    /* --- 自転：1周90秒。木取りに入ったら、線を引ける向きで止める --- */
    if (i < 1) {
      spinAngle += (Math.PI * 2 / 90) * dt;
      settleFrom = null;
    } else {
      if (settleFrom === null) settleFrom = spinAngle;
      const goal = Math.round(settleFrom / (Math.PI * 2)) * Math.PI * 2;
      const sf = i === 1 ? outQuart(clamp01(f / 0.35)) : 1;
      spinAngle = settleFrom + (goal - settleFrom) * sf;
    }
    spin.rotation.x = spinAngle;

    /* --- 第1幕：3Dの木口とDOMの木口を重ねる（線はDOM側で引く）--- */
    if (koguchiEl) {
      const op = i < 1 ? 0 : i > 1 ? 0 : Math.min(sub(f, 0.20, 0.44), 1 - sub(f, 0.88, 1.0));
      koguchiEl.style.setProperty("--kop", op.toFixed(3));
      if (i === 1 && f > 0.46) kizuri.draw();
    }

    /* --- 第2幕：鋸が通る → 板が扇状に開く --- */
    const sawF = i < 2 ? 0 : i > 2 ? 1 : inoutQuart(clamp01(f / 0.5));
    const xs = XCAP + LEN * sawF;
    planeLog.constant = -xs;
    planeCut.constant = xs;
    log.visible = sawF < 1;
    cutFace.visible = sawF > 0.001 && sawF < 0.999;
    cutFace.position.set(xs + 0.0015, 0, 0);

    const fanF = i < 2 ? 0 : i > 2 ? 1 : clamp01((f - 0.5) / 0.5);
    const stackF = i < 3 ? 0 : i > 3 ? 1 : inoutQuart(f);
    const riseF = i < 4 ? 0 : inoutQuart(f);

    boards.forEach((b, idx) => {
      b.mesh.visible = sawF > 0.001;
      /* 扇：板ごとに 0.055 ずつ遅らせる（＝発注文の「遅延150ms」） */
      const lag = idx * 0.055;
      const bf = inoutQuart(clamp01((fanF - lag) / (1 - 4 * 0.055)));
      const spread = (idx - 2) * 0.115;

      const fanY = b.base + spread * 1.15 * bf + 0.24 * bf;   /* 上へ逃がす。床にめり込ませない */
      const fanRot = spread * 1.5 * bf;

      /* 桟積みへ。柱は最後にここから立ち上がる */
      const py = fanY + (stackY[idx] - fanY) * stackF;
      const pr = fanRot * (1 - stackF);
      const pz = 0 + (0.02 * ((idx % 2) * 2 - 1)) * stackF;

      if (b.post) {
        /* 112×275 の柱取りを 105mm角へ挽き直しながら垂直に立てる。
           厚み(112→105)と幅(275→105)では詰める量が違うので、別々に効かせる */
        b.mesh.scale.set(1, 1 + (105 / 112 - 1) * riseF, 1 + (105 / 275 - 1) * riseF);
        /* 立つと重心は 1.385m（長さ3.2mの半分 − 床の高さ）。根元を土間に着ける */
        b.mesh.position.set(
          -0.72 * riseF,
          py + (1.385 - py) * riseF,
          pz + (0.30 - pz) * riseF
        );
        b.mesh.rotation.set(pr * (1 - riseF), 0, (Math.PI / 2) * riseF);
      } else {
        b.mesh.position.set(0, py, pz);
        b.mesh.rotation.set(pr, 0, 0);
      }
    });

    sticks.visible = stackF > 0.02;
    if (sticks.visible) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
      let n = 0;
      for (let g = 0; g < 4; g++) {
        const below = STACK_ORDER[g], above = STACK_ORDER[g + 1];
        const yTop = stackY[below] + boards[below].t / 2;
        for (let sx = 0; sx < STICK_X.length; sx++) {
          m.compose(new THREE.Vector3(STICK_X[sx], yTop + 0.015, 0), q, sc);
          sticks.setMatrixAt(n++, m);
        }
        void above;
      }
      sticks.instanceMatrix.needsUpdate = true;
      sticks.count = n;
    }
    bgStack.visible = stackF > 0.05;

    /* --- 光が暖色へ寄る（累積の linear）--- */
    const warm = Math.max(stackF, riseF);
    keyWarm.set(0xffe6c6).lerp(warmTarget, warm);
    key.color.copy(keyWarm);
    key.intensity = 3.0 + warm * 0.5;

    /* --- 粉塵 --- */
    const dp = dustGeo.attributes.position.array;
    for (let n = 0; n < DUST_N; n++) {
      dp[n * 3 + 1] += dustV[n] * dt;
      if (dp[n * 3 + 1] > 1.4) dp[n * 3 + 1] = -0.2;
    }
    dustGeo.attributes.position.needsUpdate = true;

    renderer.render(scene, camera);
    if (DEBUG) hud(now, renderer, track.percent(scrollY), i, f);
  }

  /* スクロールでは値を控えるだけ。描画はRAFに任せる */
  addEventListener("scroll", () => { scrollY = window.scrollY; }, { passive: true });
  addEventListener("resize", () => { resize(); track.measure(); }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    /* 見えていないタブでは回さない */
    if (document.hidden) { running = false; }
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  });

  resize();
  track.measure();
  requestAnimationFrame(frame);

  /* ?debug のときだけ、外から1コマ進められるようにする（検品用）*/
  if (DEBUG) {
    window.__kobiki = {
      renderer, scene, camera, track, boards, log,
      /* 指定位置までカメラを収束させて1枚撮る */
      shot(y, times) {
        scrollY = y;
        window.scrollTo(0, y);
        const base = performance.now();
        for (let n = 0; n < (times || 120); n++) frameBody(base + n * 16.7);
        return canvas.toDataURL("image/png");
      },
      state() {
        const st = track.stageAt(scrollY);
        return { marks: track.marks, max: track.max, stage: st, pct: track.percent(scrollY),
                 calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
      },
    };
  }
}

/* ── B-5. 開発用のフレーム計測（?debug）──────────────────── */
let hudEl = null, hudT = 0, hudN = 0, hudMin = 999;
function hud(now, renderer, pct, stage, f) {
  if (!hudEl) {
    hudEl = document.createElement("div");
    hudEl.className = "hud";
    document.body.appendChild(hudEl);
    hudT = now;
  }
  hudN++;
  const el = performance.now();
  if (now - hudT >= 1000) {
    const fps = (hudN * 1000) / (now - hudT);
    hudMin = Math.min(hudMin, fps);
    const r = renderer.info.render;
    hudEl.textContent =
      `fps ${fps.toFixed(1)}  最低 ${hudMin.toFixed(1)}\n` +
      `drawcall ${r.calls}  三角 ${r.triangles}\n` +
      `進捗 ${(pct * 100).toFixed(1)}%  第${stage}幕 ${(f * 100).toFixed(0)}%\n` +
      `DPR ${renderer.getPixelRatio()}`;
    console.log(`[木挽舎] fps=${fps.toFixed(1)} 最低=${hudMin.toFixed(1)} drawcall=${r.calls} 三角=${r.triangles} 進捗=${(pct * 100).toFixed(1)}%`);
    hudT = now; hudN = 0;
  }
  void el;
}

/* ════════════════════════════════════════════════════════════
   起動
   ════════════════════════════════════════════════════════════ */
root.classList.add("js-ready");
initReveal();
initOdometer();
track.measure();
addEventListener("load", () => track.measure());

/* 木取り線の保険。
   本筋は3Dのカメラが木口の正面に来た時点で引くが、描画ループが回らない状況
   （WebGL無し・タブ非表示のまま戻ってきた・three.jsの読み込み失敗）でも
   署名の仕掛けを落とさないよう、交差監視でも引けるようにしておく。draw() は一度きり。 */
if (document.getElementById("koguchi")) {
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        kizuri.draw();
      });
    }, { threshold: 0.62 });
    io.observe(document.getElementById("koguchi"));
  } else {
    /* 交差監視が無い環境では、隠したままにせず即座に引き切る */
    kizuri.draw();
  }
}

if (DEBUG) window.__kizuri = kizuri;

/* ── 書体サブセットの抜けを見張る（?debug のときだけ）────────────
   Google Fonts の text= 指定は「使う字だけ」を取り寄せるので速いが、
   文言を足したときに字を足し忘れると、その字だけ端末の書体で出てしまう。
   リンクの text= を読んで、画面に出ている字と突き合わせる。 */
if (DEBUG) {
  const subsets = [...document.querySelectorAll('link[href*="fonts.googleapis.com"][href*="text="]')].map((l) => {
    const u = new URL(l.href);
    const fam = (u.searchParams.get("family") || "").split(":")[0];
    return { fam, chars: new Set(u.searchParams.get("text") || "") };
  });
  const missing = new Map();
  (function walk(n) {
    if (n.nodeType === 3) {
      const el = n.parentElement;
      if (!el) return;
      const fam = getComputedStyle(el).fontFamily;
      const hit = subsets.find((sset) => fam.includes(sset.fam));
      if (!hit) return;
      for (const ch of n.textContent) {
        if (/\s/.test(ch) || hit.chars.has(ch)) continue;
        if (!missing.has(hit.fam)) missing.set(hit.fam, new Set());
        missing.get(hit.fam).add(ch);
      }
      return;
    }
    if (n.nodeType !== 1 || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(n.tagName)) return;
    n.childNodes.forEach(walk);
  })(document.body);
  if (missing.size) {
    missing.forEach((set, fam) => console.warn(`[木挽舎] ${fam} のサブセットに無い字: ${[...set].join("")} — index.html の text= に足すこと`));
  } else {
    console.log("[木挽舎] 書体サブセット: 画面の字はすべて含まれています");
  }
}

init3D();
