/* Ember — canvas night scene: sky, stars, moon, treeline, logs, particle fire.
   Exposes window.Scene = { init, setHeat, stoke, toss, anchor } */
window.Scene = (() => {
  let cv, ctx, W = 0, H = 0, dpr = 1;
  let heat = 0.12;                 // 0..1, driven by chat activity
  let stars = [], trees = [], fireflies = [];
  let flames = [], embers = [], smoke = [], tosses = [], bursts = [];
  let spawnAcc = 0, last = 0, t = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // layout: desktop leaves room for the chat panel on the right;
  // mobile raises the fire above the bottom-sheet chat
  const desktop = () => W > 760;
  const fx = () => desktop() ? Math.max(200, (W - 430) / 2) : W * 0.5;
  const fy = () => desktop() ? H * 0.8 : H * 0.38;
  const horizonY = () => desktop() ? H * 0.72 : H * 0.31;

  /* ---- soft round sprites, pre-rendered per hue (fast, glowy) ---- */
  const SPRITE = 64;
  function makeSprite(r, g, b) {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, SPRITE, SPRITE);
    return c;
  }
  // flame ages through these: white-hot core -> yellow -> orange -> red
  const FLAME_SPRITES = [
    makeSprite(255, 249, 220),
    makeSprite(255, 224, 130),
    makeSprite(255, 170, 70),
    makeSprite(255, 110, 40),
    makeSprite(220, 60, 25),
  ];
  const EMBER_SPRITE = makeSprite(255, 200, 120);
  const SMOKE_SPRITE = makeSprite(150, 155, 170);
  const FLY_SPRITE = makeSprite(214, 255, 140);

  /* ---- static scenery, regenerated on resize ---- */
  function buildScenery() {
    stars = [];
    const n = Math.floor((W * H) / 9000);
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * (horizonY() - 14),
        r: Math.random() * 1.3 + 0.3,
        ph: Math.random() * Math.PI * 2,
        sp: 0.4 + Math.random() * 1.2,
      });
    }
    trees = [];
    let x = -20;
    while (x < W + 40) {
      const w = 26 + Math.random() * 46;
      trees.push({ x, w, h: 26 + Math.random() * 58 });
      x += w * 0.62;
    }
    fireflies = [];
    for (let i = 0; i < (reduced ? 3 : 7); i++) {
      fireflies.push({
        x: Math.random() * W,
        y: horizonY() - 6 - Math.random() * 110,
        ph: Math.random() * Math.PI * 2,
        sp: 0.3 + Math.random() * 0.5,
        amp: 18 + Math.random() * 40,
      });
    }
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth;
    H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildScenery();
  }

  /* ---- particles ---- */
  function spawnFlame(burst) {
    const spread = 14 + heat * 26;
    flames.push({
      x: fx() + (Math.random() - 0.5) * spread * 2,
      y: fy() + 4 - Math.random() * 6,
      vx: (Math.random() - 0.5) * 14,
      vy: -(34 + Math.random() * 46) * (0.55 + heat * 0.85) * (burst ? 1.5 : 1),
      size: (9 + Math.random() * 13) * (0.62 + heat * 0.68),
      age: 0,
      lifespan: 0.9 + Math.random() * 0.9,
      wob: Math.random() * Math.PI * 2,
      wf: 3 + Math.random() * 4,
    });
  }
  function spawnEmber(strength = 1) {
    embers.push({
      x: fx() + (Math.random() - 0.5) * 26,
      y: fy() - 8,
      vx: (Math.random() - 0.5) * 26,
      vy: -(55 + Math.random() * 90) * strength,
      size: 1.4 + Math.random() * 2.4,
      age: 0,
      lifespan: 1.8 + Math.random() * 2.6,
      wob: Math.random() * Math.PI * 2,
    });
  }
  function spawnSmoke() {
    smoke.push({
      x: fx() + (Math.random() - 0.5) * 20,
      y: fy() - 26,
      vx: (Math.random() - 0.5) * 8,
      vy: -(16 + Math.random() * 14),
      size: 12 + Math.random() * 16,
      age: 0,
      lifespan: 2.4 + Math.random() * 2,
    });
  }

  /* ---- public: flare the fire (messages, tosses) ---- */
  function stoke(strength = 1) {
    const n = Math.round((reduced ? 8 : 22) * strength);
    for (let i = 0; i < n; i++) spawnFlame(true);
    for (let i = 0; i < Math.round(6 * strength); i++) spawnEmber(1.15);
    bursts.push({ age: 0, strength });
  }

  /* ---- public: toss an emoji into the fire ---- */
  function toss(emoji, from, onLand) {
    const start = from || { x: W * 0.9, y: H * 0.55 };
    tosses.push({
      emoji,
      x0: start.x, y0: start.y,
      x1: fx() + (Math.random() - 0.5) * 24,
      y1: fy() - 6,
      arc: 90 + Math.random() * 70,
      age: 0,
      dur: 0.75 + Math.random() * 0.2,
      spin: (Math.random() - 0.5) * 9,
      onLand,
    });
  }

  /* ---- drawing ---- */
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#05070f");
    g.addColorStop(0.55, "#0a1222");
    g.addColorStop(1, "#0d1526");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      ctx.globalAlpha = 0.25 + tw * 0.55;
      ctx.fillStyle = "#dfe8ff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // moon (kept clear of the chat panel on desktop)
    const mx = desktop() ? W * 0.13 : W * 0.8, my = H * (desktop() ? 0.17 : 0.12);
    const halo = ctx.createRadialGradient(mx, my, 13, mx, my, 52);
    halo.addColorStop(0, "rgba(214,228,255,0.28)");
    halo.addColorStop(0.4, "rgba(214,228,255,0.1)");
    halo.addColorStop(1, "rgba(214,228,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mx, my, 52, 0, 7); ctx.fill();
    const disc = ctx.createRadialGradient(mx - 5, my - 5, 2, mx, my, 15);
    disc.addColorStop(0, "#f4f7ff");
    disc.addColorStop(0.7, "#dbe4f8");
    disc.addColorStop(1, "#b9c6e2");
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(mx, my, 14, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(160,175,210,0.45)";
    ctx.beginPath(); ctx.arc(mx - 4, my + 3, 2.8, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 5, my - 4, 1.9, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + 2, my + 6.5, 1.4, 0, 7); ctx.fill();
  }

  function drawGroundAndTrees() {
    const horizon = horizonY();
    // treeline silhouette
    ctx.fillStyle = "#060a12";
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (const tr of trees) {
      ctx.lineTo(tr.x, horizon);
      ctx.lineTo(tr.x + tr.w / 2, horizon - tr.h);
      ctx.lineTo(tr.x + tr.w, horizon);
    }
    ctx.lineTo(W, horizon);
    ctx.lineTo(W, H); ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    // ground
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, "#0a1018");
    g.addColorStop(1, "#05080d");
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon + 1, W, H - horizon);
  }

  function drawGlow() {
    // warm light cast on the ground & trees — scales with heat
    const r = 130 + heat * 300;
    const flick = 1 + Math.sin(t * 9.7) * 0.05 + Math.sin(t * 23.3) * 0.03;
    const g = ctx.createRadialGradient(fx(), fy(), 8, fx(), fy(), r * flick);
    g.addColorStop(0, `rgba(255,148,54,${0.34 * heat + 0.1})`);
    g.addColorStop(0.5, `rgba(255,110,40,${0.15 * heat + 0.04})`);
    g.addColorStop(1, "rgba(255,110,40,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.fillRect(fx() - r * 1.2, fy() - r * 1.2, r * 2.4, r * 2.4);
    ctx.restore();
  }

  function drawLogs() {
    const x = fx(), y = fy();
    ctx.save();
    ctx.lineCap = "round";
    const log = (x1, y1, x2, y2, w, c1, c2) => {
      const g = ctx.createLinearGradient(x1, y1 - w, x1, y1 + w);
      g.addColorStop(0, c2);
      g.addColorStop(1, c1);
      ctx.strokeStyle = g;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    const lit = 0.25 + heat * 0.75;
    const hi = `rgba(${120 + lit * 120 | 0},${70 + lit * 60 | 0},${40 + lit * 20 | 0},1)`;
    log(x - 52, y + 16, x + 44, y + 2, 13, "#2b1a10", hi);
    log(x - 44, y + 2, x + 52, y + 16, 13, "#241509", hi);
    log(x - 34, y + 22, x + 34, y + 22, 12, "#1d1108", "#3a2415");
    // stones around the pit
    ctx.fillStyle = "#151c28";
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.05 + (i / 8) * 0.9);
      const sx = x + Math.cos(a) * 78, sy = y + 26 + Math.sin(a) * 12;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 9 + (i % 3) * 2.4, 6 + (i % 2) * 2, 0, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSprite(sprite, x, y, size, alpha) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - size, y - size, size * 2, size * 2);
  }

  function step(dt) {
    t += dt;
    // continuous spawn ∝ heat
    spawnAcc += dt * (2.5 + heat * (reduced ? 22 : 46));
    while (spawnAcc >= 1) { spawnFlame(false); spawnAcc -= 1; }
    if (Math.random() < dt * (0.5 + heat * 3.2)) spawnEmber();
    if (heat < 0.4 && Math.random() < dt * 2.2) spawnSmoke();

    const buoy = 26 + heat * 30;
    for (const p of flames) {
      p.age += dt / p.lifespan;
      p.vy -= buoy * dt;
      p.x += (p.vx + Math.sin(t * p.wf + p.wob) * 12) * dt;
      p.y += p.vy * dt;
    }
    flames = flames.filter(p => p.age < 1);

    for (const p of embers) {
      p.age += dt / p.lifespan;
      p.vy -= 14 * dt;
      p.vx *= 1 - 0.4 * dt;
      p.x += (p.vx + Math.sin(t * 2.2 + p.wob) * 16) * dt;
      p.y += p.vy * dt;
    }
    embers = embers.filter(p => p.age < 1 && p.y > -20);

    for (const p of smoke) {
      p.age += dt / p.lifespan;
      p.x += (p.vx + Math.sin(t * 0.9 + p.y * 0.02) * 6) * dt;
      p.y += p.vy * dt;
      p.size += 9 * dt;
    }
    smoke = smoke.filter(p => p.age < 1);

    for (const f of fireflies) {
      f.ph += dt * f.sp;
      f.x += Math.cos(f.ph * 0.7) * f.amp * dt * 0.5;
      f.y += Math.sin(f.ph) * f.amp * dt * 0.3;
      if (f.x < -30) f.x = W + 20; if (f.x > W + 30) f.x = -20;
    }

    for (const b of bursts) b.age += dt * 2.2;
    bursts = bursts.filter(b => b.age < 1);

    for (const o of tosses) {
      o.age += dt / o.dur;
      if (o.age >= 1 && !o.done) {
        o.done = true;
        stoke(o.emoji === "🪵" ? 1.6 : 0.7);
        if (o.onLand) o.onLand();
      }
    }
    tosses = tosses.filter(o => o.age < 1.02);
  }

  function draw() {
    drawSky();
    drawGroundAndTrees();
    drawGlow();
    drawLogs();

    // smoke (normal blend, behind flames)
    for (const p of smoke) {
      drawSprite(SMOKE_SPRITE, p.x, p.y, p.size, 0.1 * (1 - p.age));
    }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // flames
    for (const p of flames) {
      const idx = Math.min(4, Math.floor(p.age * 5.2));
      const size = p.size * (1 - p.age * 0.72);
      drawSprite(FLAME_SPRITES[idx], p.x, p.y, size, (1 - p.age) * 0.85);
    }
    // hot core
    if (heat > 0.04) {
      const coreFlick = 1 + Math.sin(t * 13) * 0.12;
      drawSprite(FLAME_SPRITES[0], fx(), fy() - 4, (10 + heat * 22) * coreFlick, 0.5 + heat * 0.4);
    }
    // embers
    for (const p of embers) {
      const tw = 0.55 + 0.45 * Math.sin(t * 11 + p.wob * 7);
      drawSprite(EMBER_SPRITE, p.x, p.y, p.size * 2.4, (1 - p.age) * tw);
    }
    // burst flash rings
    for (const b of bursts) {
      ctx.globalAlpha = (1 - b.age) * 0.24 * b.strength;
      ctx.strokeStyle = "#ffb066";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx(), fy() - 8, 12 + b.age * 90, 0, 7);
      ctx.stroke();
    }
    // fireflies
    for (const f of fireflies) {
      const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(f.ph * 1.7));
      drawSprite(FLY_SPRITE, f.x, f.y, 4.5, pulse * 0.8);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // toss projectiles (parabola)
    for (const o of tosses) {
      const k = Math.min(1, o.age);
      const x = o.x0 + (o.x1 - o.x0) * k;
      const y = o.y0 + (o.y1 - o.y0) * k - Math.sin(k * Math.PI) * o.arc;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(k * o.spin);
      ctx.font = "22px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(o.emoji, 0, 0);
      ctx.restore();
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
  }

  return {
    init(canvas) {
      cv = canvas;
      ctx = cv.getContext("2d");
      resize();
      addEventListener("resize", resize);
      requestAnimationFrame(now => { last = now; frame(now); });
    },
    setHeat(h) { heat = Math.max(0, Math.min(1, h)); },
    stoke,
    toss,
    // where the fire is, in page coordinates (for wisps & chip layout)
    anchor() {
      const r = cv.getBoundingClientRect();
      return { x: r.left + fx(), y: r.top + fy(), w: W, h: H };
    },
  };
})();
