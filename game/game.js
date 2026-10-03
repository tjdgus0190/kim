(() => {
  const L = window.Logic;
  const C = L.CFG;

  // ---------- 색상 ----------
  const COLORS = {
    1: '#9aa5b1', 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b',
    128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e',
    4096: '#b784f5', 8192: '#5ad1f5', 16384: '#ff7ad9',
  };
  const colorOf = (v) => COLORS[v] || '#ff7ad9';
  const darkText = (v) => v <= 4 || (v >= 128 && v <= 2048);
  const DANGER = '#ff4d6d', GOLD = '#ffd23f', SPIKE = '#8be04e';

  // ---------- 캔버스 ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const ui = {
    hud: $('hud'), score: $('score'), hudBest: $('hudBest'), tile: $('tile'), progressFill: $('progressFill'),
    progressText: $('progressText'), combo: $('combo'), stageLabel: $('stageLabel'), banner: $('banner'),
    dashBtn: $('btnDash'), dashRing: $('dashRing'), title: $('screenTitle'), over: $('screenOver'), pause: $('screenPause'),
    titleBest: $('titleBest'), titleBestV: $('titleBestV'), overScore: $('overScore'), overMaxV: $('overMaxV'),
    overTime: $('overTime'), overEats: $('overEats'), overReason: $('overReason'), newBest: $('newBest'), mute: $('btnMute'),
  };

  // ---------- 저장 ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : Number(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* 무시 */ } },
  };
  let best = store.get('mj_best', 0);
  let bestV = store.get('mj_bestV', 2);
  let muted = store.get('mj_muted', 0) === 1;

  // ---------- 사운드 ----------
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur = 0.1, type = 'sine', vol = 0.15, slideTo = 0, delay = 0) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    eat(combo) { tone(420 * Math.pow(1.0595, combo * 2), 0.09, 'triangle', 0.18, 0); },
    merge() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, 0, i * 0.06)); },
    level() { tone(330, 0.25, 'sine', 0.12, 880); },
    spike() { tone(160, 0.3, 'sawtooth', 0.14, 60); },
    trap() { tone(988, 0.12, 'square', 0.08, 0); tone(1319, 0.2, 'square', 0.08, 0, 0.08); },
    dash() { tone(240, 0.12, 'sine', 0.08, 520); },
    die() { tone(440, 0.6, 'sawtooth', 0.14, 70); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.14, 0, i * 0.09)); },
  };

  // ---------- 상태 ----------
  let mode = 'title'; // title | play | paused | dying | over
  let player, npcs, spikes, particles, floaters, stats, cam, shake, dyingT, recycleT, wonOnce, lastStage;
  let nextId = 1;
  const rand = Math.random;
  const rr = (a, b) => a + rand() * (b - a);

  function viewHalf() { return { hw: W / 2 / cam.zoom, hh: H / 2 / cam.zoom }; }
  function targetZoom(r) { return Math.sqrt(W * H) / (560 + r * 7); }

  function randomFarPos(minDist, offscreen) {
    const { hw, hh } = viewHalf();
    for (let i = 0; i < 30; i++) {
      const x = rr(80, C.WORLD - 80), y = rr(80, C.WORLD - 80);
      const dx = x - player.x, dy = y - player.y;
      if (offscreen && Math.abs(dx) < hw + 120 && Math.abs(dy) < hh + 120) continue;
      if (Math.hypot(dx, dy) < minDist) continue;
      return { x, y };
    }
    return { x: rr(80, C.WORLD - 80), y: rr(80, C.WORLD - 80) };
  }

  function makeNpc(offscreen) {
    const v = L.sampleValue(player.v, rand);
    // 위협 젤리는 시작 지점 가까이에 두지 않음
    const pos = randomFarPos(v > player.v ? 600 : 260, offscreen);
    const a = rand() * Math.PI * 2;
    return { id: nextId++, x: pos.x, y: pos.y, v, r: L.radiusOf(v), vx: 0, vy: 0, dx: Math.cos(a), dy: Math.sin(a),
      wanderT: rr(1, 3), chaseT: 0, boredT: 0, chasing: false, phase: rand() * 10 };
  }
  function makeSpike(offscreen) {
    const pos = randomFarPos(350, offscreen);
    return { x: pos.x, y: pos.y, rot: rand() * 6 };
  }

  function reset() {
    player = { x: C.WORLD / 2, y: C.WORLD / 2, vx: 0, vy: 0, v: C.START_V, p: 0, r: L.radiusOf(C.START_V),
      dashT: 0, dashCd: 0, invuln: C.START_INVULN, maxV: C.START_V, phase: 0, popT: 0 };
    cam = { x: player.x, y: player.y, zoom: targetZoom(player.r) };
    npcs = []; spikes = []; particles = []; floaters = [];
    stats = { score: 0, eats: 0, time: 0, combo: 0, sinceEat: 99, killer: 0 };
    shake = 0; dyingT = 0; recycleT = 0; wonOnce = false; lastStage = 0;
    for (let i = 0; i < C.NPC_COUNT; i++) npcs.push(makeNpc(false));
    for (let i = 0; i < C.SPIKE_COUNT; i++) spikes.push(makeSpike(false));
    hudCache = {};
  }

  // ---------- 입력 ----------
  const keys = new Set();
  const pointer = { x: 0, y: 0, active: false, touch: false };
  function isTouchUI() { return document.body.classList.contains('touch'); }

  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
    if (e.pointerType === 'mouse') pointer.active = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
    if (e.pointerType === 'mouse') { if (e.button === 0) tryDash(); }
    else { pointer.touch = true; document.body.classList.add('touch'); }
  });
  const endTouch = (e) => { if (e.pointerType !== 'mouse') pointer.active = false; };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  ui.dashBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); tryDash(); });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (mode === 'title' || mode === 'over') { startGame(); return; }
      if (mode === 'paused') { togglePause(); return; }
      if (k === ' ') tryDash();
      return;
    }
    if (k === 'p' || k === 'escape') { togglePause(); return; }
    if (k === 'm') { toggleMute(); return; }
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') togglePause(); });

  $('btnStart').addEventListener('click', startGame);
  $('btnRetry').addEventListener('click', startGame);
  $('btnResume').addEventListener('click', togglePause);
  $('btnPause').addEventListener('click', togglePause);
  ui.mute.addEventListener('click', toggleMute);

  function toggleMute() {
    muted = !muted; store.set('mj_muted', muted ? 1 : 0);
    ui.mute.textContent = muted ? '🔇' : '🔊';
  }
  function togglePause() {
    if (mode === 'play') { mode = 'paused'; ui.pause.classList.remove('hidden'); }
    else if (mode === 'paused') { mode = 'play'; ui.pause.classList.add('hidden'); last = performance.now(); }
  }
  function tryDash() {
    if (mode !== 'play' || player.dashCd > 0) return;
    player.dashT = C.DASH_TIME; player.dashCd = C.DASH_COOLDOWN;
    sfx.dash();
    burst(player.x, player.y, 8, 'rgba(124,245,196,.9)', 160, 3);
  }

  function startGame() {
    audio();
    reset();
    mode = 'play';
    ui.title.classList.add('hidden'); ui.over.classList.add('hidden'); ui.pause.classList.add('hidden');
    ui.hud.classList.remove('hidden');
    ui.mute.textContent = muted ? '🔇' : '🔊';
    showBanner('스테이지 1 · ' + L.STAGES[0].name, '작은 숫자를 먹고 같은 숫자를 찾아라!');
  }

  // ---------- 이펙트 ----------
  function burst(x, y, n, color, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, s = rr(0.3, 1) * speed;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rr(0.35, 0.7), max: 0.7, color, size: rr(0.6, 1.2) * size });
    }
  }
  function floater(x, y, text, color, size = 22) {
    floaters.push({ x, y, text, color, size, life: 1.1 });
  }
  let bannerTimer = 0;
  function showBanner(text, sub) {
    ui.banner.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
    ui.banner.classList.remove('hidden');
    ui.banner.style.animation = 'none'; void ui.banner.offsetWidth; ui.banner.style.animation = '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => ui.banner.classList.add('hidden'), 2600);
  }

  // ---------- 업데이트 ----------
  function inputDir() {
    let x = 0, y = 0;
    if (keys.has('arrowleft') || keys.has('a')) x -= 1;
    if (keys.has('arrowright') || keys.has('d')) x += 1;
    if (keys.has('arrowup') || keys.has('w')) y -= 1;
    if (keys.has('arrowdown') || keys.has('s')) y += 1;
    if (x || y) { const m = Math.hypot(x, y); return { x: x / m, y: y / m, f: 1 }; }
    if (!pointer.active) return { x: 0, y: 0, f: 0 };
    const sx = (player.x - cam.x) * cam.zoom + W / 2, sy = (player.y - cam.y) * cam.zoom + H / 2;
    const dx = pointer.x - sx, dy = pointer.y - sy, d = Math.hypot(dx, dy);
    if (d < 4) return { x: 0, y: 0, f: 0 };
    const full = Math.max(60, player.r * cam.zoom * 2.2);
    return { x: dx / d, y: dy / d, f: Math.min(1, d / full) };
  }

  function steer(o, tx, ty, dt, k = 6) {
    const a = Math.min(1, dt * k);
    o.vx += (tx - o.vx) * a; o.vy += (ty - o.vy) * a;
  }
  function clampWorld(o) {
    if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx); if (o.dx !== undefined) o.dx = Math.abs(o.dx); }
    if (o.y < o.r) { o.y = o.r; o.vy = Math.abs(o.vy); if (o.dy !== undefined) o.dy = Math.abs(o.dy); }
    if (o.x > C.WORLD - o.r) { o.x = C.WORLD - o.r; o.vx = -Math.abs(o.vx); if (o.dx !== undefined) o.dx = -Math.abs(o.dx); }
    if (o.y > C.WORLD - o.r) { o.y = C.WORLD - o.r; o.vy = -Math.abs(o.vy); if (o.dy !== undefined) o.dy = -Math.abs(o.dy); }
  }

  function updatePlayer(dt) {
    const dir = inputDir();
    const sp = L.speedOf(player.r) * (player.dashT > 0 ? C.DASH_MULT : 1);
    steer(player, dir.x * sp * dir.f, dir.y * sp * dir.f, dt, player.dashT > 0 ? 14 : 8);
    player.x += player.vx * dt; player.y += player.vy * dt;
    clampWorld(player);
    player.dashT = Math.max(0, player.dashT - dt);
    player.dashCd = Math.max(0, player.dashCd - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.popT = Math.max(0, player.popT - dt);
    player.r += (L.radiusOf(player.v) - player.r) * Math.min(1, dt * 6);
    player.phase += dt;
    if (player.dashT > 0 && rand() < 0.6) particles.push({ x: player.x, y: player.y, vx: 0, vy: 0, life: 0.3, max: 0.3, color: 'rgba(124,245,196,.5)', size: player.r * 0.5 });
  }

  function updateNpc(n, dt) {
    const dx = player.x - n.x, dy = player.y - n.y, d = Math.hypot(dx, dy) || 1;
    const rel = L.relation(player.v, n.v);
    const base = L.speedOf(n.r);
    n.boredT = Math.max(0, n.boredT - dt);
    n.chasing = false;
    let tx, ty;
    if (rel === 'threat' && d < 420 + n.r && n.boredT <= 0 && mode === 'play') {
      n.chasing = true;
      n.chaseT += dt;
      if (n.chaseT > C.CHASE_LIMIT) { n.boredT = C.BORED_TIME; n.chaseT = 0; }
      const px = player.x + player.vx * 0.3 - n.x, py = player.y + player.vy * 0.3 - n.y, pd = Math.hypot(px, py) || 1;
      tx = (px / pd) * base * 0.88; ty = (py / pd) * base * 0.88;
    } else if (rel !== 'threat' && d < (rel === 'jackpot' ? 260 : 220) + n.r && mode === 'play') {
      n.chaseT = 0;
      const f = rel === 'jackpot' ? 0.75 : 0.55;
      tx = (-dx / d) * base * f; ty = (-dy / d) * base * f;
    } else {
      n.chaseT = Math.max(0, n.chaseT - dt);
      n.wanderT -= dt;
      if (n.wanderT <= 0) { const a = rand() * Math.PI * 2; n.dx = Math.cos(a); n.dy = Math.sin(a); n.wanderT = rr(1, 3); }
      tx = n.dx * base * 0.35; ty = n.dy * base * 0.35;
      // 배회 중인 큰 젤리는 가시를 피함 (추격 중일 땐 못 봄 → 유인 전략)
      if (L.spikeHurts(n.r)) {
        for (const s of spikes) {
          const sx = n.x - s.x, sy = n.y - s.y, sd = Math.hypot(sx, sy) || 1;
          if (sd < n.r + C.SPIKE_R + 60) { tx += (sx / sd) * base * 0.6; ty += (sy / sd) * base * 0.6; }
        }
      }
    }
    steer(n, tx, ty, dt, 4);
    n.x += n.vx * dt; n.y += n.vy * dt;
    n.r += (L.radiusOf(n.v) - n.r) * Math.min(1, dt * 6);
    clampWorld(n);
    n.phase += dt;
  }

  function onEat(n) {
    const before = player.v;
    const res = L.applyEat({ v: player.v, p: player.p }, n.v);
    stats.combo = L.nextCombo(stats.combo, stats.sinceEat);
    stats.sinceEat = 0;
    stats.eats++;
    const gain = L.eatScore(n.v, stats.combo, res.merged);
    stats.score += gain;
    player.v = res.v; player.p = res.p;
    player.maxV = Math.max(player.maxV, player.v);
    burst(n.x, n.y, res.merged ? 26 : 8, res.merged ? GOLD : colorOf(n.v), res.merged ? 320 : 180, res.merged ? 6 : 4);
    floater(n.x, n.y - n.r, '+' + gain, res.merged ? GOLD : '#fff', res.merged ? 26 : 20);
    if (res.merged) {
      floater(player.x, player.y - player.r - 30, 'MERGE! ×2', GOLD, 34);
      shake = Math.max(shake, 6); sfx.merge();
    } else sfx.eat(stats.combo);
    if (res.levels > 0) {
      player.popT = 0.35;
      if (!res.merged) sfx.level();
      onLevelUp(before);
    }
  }

  function onLevelUp(before) {
    const st = L.stageOf(player.v);
    if (st > lastStage) {
      lastStage = st;
      const s = L.STAGES[st];
      const sub = st === 1 ? '이제 가시를 조심! 큰 놈을 가시로 유인하세요' : st === 2 ? '대시(클릭/Space)를 적극 활용!' : st === 3 ? '2048까지 얼마 안 남았다!' : '';
      if (st < 4) showBanner('스테이지 ' + (st + 1) + ' · ' + s.name, sub);
    }
    if (!wonOnce && player.v >= C.WIN_V) {
      wonOnce = true;
      showBanner('🏆 2048 달성!', '전설의 황금 젤리! 무한 모드 시작');
      burst(player.x, player.y, 80, GOLD, 520, 7);
      shake = 14; sfx.win();
      if (before < C.WIN_V) stats.score += 2048;
    }
  }

  function die(killer) {
    if (mode !== 'play') return;
    mode = 'dying'; dyingT = 0.7; stats.killer = killer.v;
    player.killer = killer;
    sfx.die(); shake = 12;
    burst(player.x, player.y, 30, colorOf(player.v), 260, 5);
  }

  function finish() {
    mode = 'over';
    const isBest = stats.score > best;
    if (isBest) { best = stats.score; store.set('mj_best', best); }
    if (player.maxV > bestV) { bestV = player.maxV; store.set('mj_bestV', bestV); }
    ui.overScore.textContent = fmt(stats.score);
    ui.overMaxV.textContent = fmt(player.maxV);
    ui.overTime.textContent = fmtTime(stats.time);
    ui.overEats.textContent = stats.eats;
    ui.overReason.textContent = fmt(stats.killer) + ' 젤리에게 먹혔어요';
    ui.newBest.classList.toggle('hidden', !isBest);
    ui.hud.classList.add('hidden');
    ui.over.classList.remove('hidden');
  }

  function respawnSpike(i) { spikes[i] = makeSpike(true); }

  function update(dt) {
    if (mode === 'play') {
      stats.time += dt;
      stats.sinceEat += dt;
      if (stats.sinceEat > C.COMBO_WINDOW) stats.combo = 0;
      updatePlayer(dt);
    }
    const simDt = mode === 'dying' ? dt * 0.3 : dt;
    if (mode === 'play' || mode === 'dying' || mode === 'title') for (const n of npcs) updateNpc(n, simDt);

    if (mode === 'play') {
      // 플레이어 vs 젤리
      for (let i = npcs.length - 1; i >= 0; i--) {
        const n = npcs[i];
        const d = Math.hypot(n.x - player.x, n.y - player.y);
        if (d > player.r + n.r) continue;
        const rel = L.relation(player.v, n.v);
        if (rel !== 'threat') {
          if (L.overlapsToEat(d, player.r, n.r)) { onEat(n); npcs[i] = makeNpc(true); }
        } else if (player.invuln <= 0 && L.overlapsToEat(d, n.r, player.r)) {
          die(n); break;
        }
      }
    }
    if (mode === 'play') {
      // 플레이어 vs 가시
      for (let i = 0; i < spikes.length; i++) {
        const s = spikes[i];
        if (player.invuln > 0 || !L.spikeHurts(player.r)) break;
        if (Math.hypot(s.x - player.x, s.y - player.y) < player.r + C.SPIKE_R * 0.5) {
          const res = L.applySpikeHit(player);
          player.v = res.v; player.p = res.p; player.invuln = C.HIT_INVULN;
          burst(s.x, s.y, 22, SPIKE, 300, 5);
          floater(player.x, player.y - player.r - 20, '아야! ½', SPIKE, 30);
          shake = 10; sfx.spike();
          respawnSpike(i);
          break;
        }
      }
      // 젤리 vs 가시 (TRAP)
      for (const n of npcs) {
        if (!L.spikeHurts(n.r)) continue;
        for (let i = 0; i < spikes.length; i++) {
          const s = spikes[i];
          if (Math.hypot(s.x - n.x, s.y - n.y) < n.r + C.SPIKE_R * 0.5) {
            const wasThreat = n.v > player.v;
            n.v = Math.max(1, n.v / 2);
            n.chasing = false; n.boredT = 1.5;
            burst(s.x, s.y, 16, SPIKE, 240, 4);
            const near = Math.hypot(n.x - player.x, n.y - player.y) < 900;
            if (wasThreat && n.v <= player.v && near) {
              floater(n.x, n.y - n.r - 10, 'TRAP!', GOLD, 32);
              stats.score += n.v; sfx.trap();
            }
            respawnSpike(i);
            break;
          }
        }
      }
      // 화면 밖의 무의미한 젤리 재활용
      recycleT -= dt;
      if (recycleT <= 0) {
        recycleT = 0.5;
        const { hw, hh } = viewHalf();
        for (let i = 0; i < npcs.length; i++) {
          const n = npcs[i];
          const off = Math.abs(n.x - player.x) > hw + 100 || Math.abs(n.y - player.y) > hh + 100;
          if (off && (n.v < player.v / 16 || n.v > player.v * 8)) npcs[i] = makeNpc(true);
        }
      }
    }

    if (mode === 'dying') {
      dyingT -= dt;
      const k = player.killer;
      if (k) { player.x += (k.x - player.x) * Math.min(1, dt * 5); player.y += (k.y - player.y) * Math.min(1, dt * 5); }
      player.r *= Math.pow(0.1, dt);
      if (dyingT <= 0) finish();
    }

    // 이펙트
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt; f.y -= 50 * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }

    // 카메라
    if (player) {
      const a = Math.min(1, dt * 8);
      cam.x += (player.x - cam.x) * a; cam.y += (player.y - cam.y) * a;
      cam.zoom += (targetZoom(Math.max(player.r, 20)) - cam.zoom) * Math.min(1, dt * 2);
    }
    shake = Math.max(0, shake - dt * 30);
  }

  // ---------- 렌더 ----------
  let bgColor = L.STAGES[0].bg;
  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (player) bgColor = L.STAGES[L.stageOf(player.v)].bg;
    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, W, H);
    if (!player) return;

    const sx = shake ? rr(-shake, shake) : 0, sy = shake ? rr(-shake, shake) : 0;
    ctx.save();
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    const { hw, hh } = viewHalf();
    const x0 = cam.x - hw - 100, x1 = cam.x + hw + 100, y0 = cam.y - hh - 100, y1 = cam.y + hh + 100;

    // 격자
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 2 / cam.zoom;
    ctx.beginPath();
    const g = 80;
    for (let x = Math.max(0, Math.floor(x0 / g) * g); x <= Math.min(C.WORLD, x1); x += g) { ctx.moveTo(x, Math.max(0, y0)); ctx.lineTo(x, Math.min(C.WORLD, y1)); }
    for (let y = Math.max(0, Math.floor(y0 / g) * g); y <= Math.min(C.WORLD, y1); y += g) { ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(Math.min(C.WORLD, x1), y); }
    ctx.stroke();
    // 경계
    ctx.strokeStyle = 'rgba(255,77,109,.45)'; ctx.lineWidth = 8;
    ctx.strokeRect(0, 0, C.WORLD, C.WORLD);

    const visible = (o, pad) => o.x > x0 - pad && o.x < x1 + pad && o.y > y0 - pad && o.y < y1 + pad;
    const blobs = npcs.filter((n) => visible(n, n.r));
    if (mode !== 'over' && mode !== 'title') blobs.push(player);
    blobs.sort((a, b) => a.r - b.r);

    const spikeLayer = C.SPIKE_R * 1.1;
    let spikesDrawn = false;
    for (const b of blobs) {
      if (!spikesDrawn && b.r > spikeLayer) { drawSpikes(visible, t); spikesDrawn = true; }
      drawBlob(b, b === player, t);
    }
    if (!spikesDrawn) drawSpikes(visible, t);

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.font = `${f.size / Math.max(0.6, cam.zoom)}px Jua, sans-serif`;
      ctx.lineWidth = 4 / cam.zoom; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (mode === 'play') drawThreatArrows();
  }

  function drawSpikes(visible, t) {
    for (const s of spikes) {
      if (!visible(s, C.SPIKE_R)) continue;
      const n = 18, R = C.SPIKE_R, rot = s.rot + t * 0.0003;
      ctx.beginPath();
      for (let i = 0; i <= n * 2; i++) {
        const a = rot + (i / (n * 2)) * Math.PI * 2, rad = i % 2 ? R * 0.84 : R * 1.08;
        const px = s.x + Math.cos(a) * rad, py = s.y + Math.sin(a) * rad;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(139,224,78,.55)'; ctx.fill();
      ctx.strokeStyle = SPIKE; ctx.lineWidth = 4; ctx.stroke();
    }
  }

  function drawBlob(b, isPlayer, t) {
    const r = b.r;
    if (r < 2) return;
    const rel = isPlayer ? 'me' : L.relation(player.v, b.v);
    const sp = Math.hypot(b.vx, b.vy);
    const ang = Math.atan2(b.vy, b.vx);
    const stretch = Math.min(0.12, sp / 3000);
    const time = t / 1000;

    // 상태 링
    if (rel === 'threat') {
      const pulse = 4 + Math.sin(time * 8 + b.phase) * 3;
      ctx.strokeStyle = b.chasing ? DANGER : 'rgba(255,77,109,.55)';
      ctx.lineWidth = b.chasing ? 5 : 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, r + 6 + pulse, 0, Math.PI * 2); ctx.stroke();
    } else if (rel === 'jackpot') {
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(time * 1.5);
      ctx.setLineDash([10, 8]); ctx.strokeStyle = GOLD; ctx.lineWidth = 4;
      ctx.shadowColor = GOLD; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 몸통 (출렁임 + 늘어남)
    ctx.save();
    ctx.translate(b.x, b.y);
    if (isPlayer && b.invuln > 0 && Math.floor(time * 12) % 2) ctx.globalAlpha = 0.45;
    const popS = isPlayer && b.popT > 0 ? 1 + Math.sin((b.popT / 0.35) * Math.PI) * 0.15 : 1;
    ctx.rotate(ang);
    ctx.scale((1 + stretch) * popS, (1 - stretch * 0.7) * popS);
    ctx.rotate(-ang);
    ctx.beginPath();
    const pts = 22;
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const w = 1 + Math.sin(a * 3 + time * 4 + b.phase) * 0.03 + Math.sin(a * 5 - time * 3 + b.phase) * 0.02;
      const px = Math.cos(a) * r * w, py = Math.sin(a) * r * w;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    const col = colorOf(b.v);
    ctx.fillStyle = col;
    if (isPlayer) { ctx.shadowColor = 'rgba(255,255,255,.45)'; ctx.shadowBlur = 18; }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = isPlayer ? 5 : 3;
    ctx.strokeStyle = isPlayer ? '#ffffff' : 'rgba(0,0,0,.25)';
    ctx.stroke();
    // 하이라이트
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.45, r * 0.28, r * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 눈
    const ex = r * 0.3, ey = -r * 0.32, es = Math.max(2.5, r * 0.15);
    let lx = Math.cos(ang), ly = Math.sin(ang);
    if (sp < 5) { lx = 0; ly = 0.3; }
    if (rel === 'threat' && b.chasing) { const dx = player.x - b.x, dy = player.y - b.y, d = Math.hypot(dx, dy) || 1; lx = dx / d; ly = dy / d; }
    for (const s of [-1, 1]) {
      const cx = b.x + s * ex, cy = b.y + ey;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, es, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#231d2e'; ctx.beginPath(); ctx.arc(cx + lx * es * 0.45, cy + ly * es * 0.45, es * 0.55, 0, Math.PI * 2); ctx.fill();
      if (rel === 'threat') {
        ctx.strokeStyle = '#231d2e'; ctx.lineWidth = Math.max(2, es * 0.45); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - s * es * 1.1, cy - es * 1.6); ctx.lineTo(cx + s * es * 0.9, cy - es * 0.9); ctx.stroke();
      }
    }

    // 숫자
    const label = String(b.v);
    const fs = r * (label.length <= 2 ? 0.72 : label.length === 3 ? 0.58 : 0.46);
    ctx.font = `${fs}px Jua, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = darkText(b.v) ? '#3b3245' : '#ffffff';
    ctx.fillText(label, b.x, b.y + r * 0.28);
  }

  // 화면 밖에서 추격 중인 위협 표시
  function drawThreatArrows() {
    const { hw, hh } = viewHalf();
    for (const n of npcs) {
      if (!n.chasing) continue;
      const dx = n.x - cam.x, dy = n.y - cam.y;
      if (Math.abs(dx) < hw && Math.abs(dy) < hh) continue;
      const a = Math.atan2(dy, dx);
      const m = 34;
      const k = Math.min((W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
      const px = W / 2 + Math.cos(a) * k, py = H / 2 + Math.sin(a) * k;
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = DANGER; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---------- HUD ----------
  const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  let hudCache = {};
  function setText(el, key, val) { if (hudCache[key] !== val) { hudCache[key] = val; el.textContent = val; } }
  function updateHud() {
    if (mode !== 'play' && mode !== 'paused') return;
    setText(ui.score, 'score', fmt(stats.score));
    setText(ui.hudBest, 'best', fmt(Math.max(best, stats.score)));
    if (hudCache.v !== player.v) {
      const grew = hudCache.v !== undefined && player.v > hudCache.v;
      hudCache.v = player.v;
      ui.tile.textContent = fmt(player.v);
      ui.tile.style.background = colorOf(player.v);
      ui.tile.style.color = darkText(player.v) ? '#2b2533' : '#fff';
      if (grew) { ui.tile.classList.remove('pop'); void ui.tile.offsetWidth; ui.tile.classList.add('pop'); }
      const st = L.stageOf(player.v);
      ui.stageLabel.textContent = (st < 4 ? '스테이지 ' + (st + 1) : '∞') + ' · ' + L.STAGES[st].name;
    }
    const pct = Math.min(100, (player.p / player.v) * 100);
    ui.progressFill.style.width = pct.toFixed(1) + '%';
    setText(ui.progressText, 'prog', fmt(player.p) + ' / ' + fmt(player.v));
    if (stats.combo >= 2) {
      ui.combo.classList.remove('hidden');
      if (hudCache.combo !== stats.combo) {
        hudCache.combo = stats.combo;
        ui.combo.textContent = 'COMBO ×' + stats.combo;
        ui.combo.style.fontSize = (20 + stats.combo * 1.5) + 'px';
        ui.combo.classList.remove('bump'); void ui.combo.offsetWidth; ui.combo.classList.add('bump');
      }
    } else { ui.combo.classList.add('hidden'); hudCache.combo = 0; }
    const cd = player.dashCd / C.DASH_COOLDOWN;
    ui.dashRing.style.strokeDashoffset = String(289 * cd);
    ui.dashBtn.classList.toggle('cooling', cd > 0);
  }

  // ---------- 루프 ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (mode !== 'paused') update(dt);
    draw(now);
    updateHud();
    requestAnimationFrame(frame);
  }

  // 타이틀 배경용 데모 월드
  ui.titleBest.textContent = fmt(best);
  ui.titleBestV.textContent = fmt(bestV);
  ui.mute.textContent = muted ? '🔇' : '🔊';
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
  reset();
  requestAnimationFrame(frame);

  // QA용 읽기/디버그 훅
  window.__game = {
    get mode() { return mode; },
    get player() { return player; },
    get npcs() { return npcs; },
    get spikes() { return spikes; },
    get stats() { return stats; },
    start: startGame,
    step(dt) { update(dt); updateHud(); },
  };
})();
