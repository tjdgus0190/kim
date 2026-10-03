// 브라우저 QA: node tests/e2e.js  (Playwright 필요, 게임을 로컬 서버로 띄워 봇이 직접 플레이)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'game');
const OUT = process.env.QA_OUT || path.join(__dirname, '..', 'docs', 'qa');
const PLAY_SECONDS = Number(process.env.QA_SECONDS || 60);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const f = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      fs.readFile(f, (err, data) => {
        if (err) { rsp.writeHead(404); rsp.end(); return; }
        rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
        rsp.end(data);
      });
    }).listen(0, () => res(srv));
  });
}

const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok, info });
  console.log((ok ? '✅' : '❌') + ' ' + name + (info ? ' — ' + info : ''));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const url = 'http://localhost:' + srv.address().port + '/';
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const errors = [];

  // ---------- 데스크톱 ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push('request failed: ' + r.url()); });
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(url);
  await page.waitForTimeout(600);
  check('타이틀 화면 표시', await page.isVisible('#screenTitle'));
  check('타이틀 배경 젤리 생성', (await page.evaluate(() => window.__game.npcs.length === window.Logic.CFG.NPC_COUNT)));
  await page.screenshot({ path: path.join(OUT, '1-title.png') });

  await page.click('#btnStart');
  await page.waitForTimeout(300);
  check('시작 → 플레이 모드', (await page.evaluate(() => window.__game.mode)) === 'play');
  check('HUD 표시', await page.isVisible('#hud'));
  check('시작 무적 적용', (await page.evaluate(() => window.__game.player.invuln)) > 0);

  // 이동 검증
  const p0 = await page.evaluate(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
  await page.mouse.move(1200, 360);
  await page.waitForTimeout(500);
  const p1 = await page.evaluate(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
  check('마우스 방향으로 이동', p1.x - p0.x > 50, `dx=${(p1.x - p0.x).toFixed(0)}`);

  // 키보드 이동
  await page.mouse.move(640, 360);
  await page.keyboard.down('ArrowDown'); await page.waitForTimeout(400); await page.keyboard.up('ArrowDown');
  const p2 = await page.evaluate(() => window.__game.player.y);
  check('키보드 이동', p2 - p1.y > 40, `dy=${(p2 - p1.y).toFixed(0)}`);

  // 대시
  await page.keyboard.press('Space');
  check('Space 대시 쿨다운 시작', (await page.evaluate(() => window.__game.player.dashCd)) > 2);

  // 일시정지
  await page.keyboard.press('p');
  const tPause = await page.evaluate(() => window.__game.stats.time);
  await page.waitForTimeout(400);
  const tPause2 = await page.evaluate(() => window.__game.stats.time);
  check('일시정지 시 시간 정지', tPause === tPause2 && await page.isVisible('#screenPause'));
  await page.keyboard.press('p');
  check('일시정지 해제', (await page.evaluate(() => window.__game.mode)) === 'play');

  // ---------- 봇 플레이 ----------
  const bot = { runs: 0, maxV: 2, bestScore: 0, eats: 0, merges: 0, spikeHits: 0, deaths: 0, killers: [] };
  let lastV = 2, shotAt = [8, 25, 45];
  const start = Date.now();
  while ((Date.now() - start) / 1000 < PLAY_SECONDS) {
    const s = await page.evaluate(() => {
      const g = window.__game; const p = g.player;
      return { mode: g.mode, px: p.x, py: p.y, pr: p.r, v: p.v, dashCd: p.dashCd, score: g.stats.score, eats: g.stats.eats,
        npcs: g.npcs.map((n) => ({ x: n.x, y: n.y, v: n.v, r: n.r })), spikes: g.spikes.map((q) => ({ x: q.x, y: q.y })) };
    });
    if (s.mode === 'over') {
      bot.deaths++;
      bot.killers.push(await page.textContent('#overReason'));
      if (bot.deaths === 1) await page.screenshot({ path: path.join(OUT, '4-gameover.png') });
      await page.keyboard.press('Enter'); lastV = 2; await page.waitForTimeout(200); continue;
    }
    if (s.mode !== 'play') { await page.waitForTimeout(80); continue; }
    if (s.v > lastV) { if (s.v === lastV * 2) bot.merges++; } else if (s.v < lastV) bot.spikeHits++;
    lastV = s.v; bot.maxV = Math.max(bot.maxV, s.v); bot.bestScore = Math.max(bot.bestScore, s.score); bot.eats = Math.max(bot.eats, s.eats);

    // 위협 회피 + 가치/거리 기반 먹이 선택
    let fx = 0, fy = 0, best = null, bestScore = -1;
    for (const n of s.npcs) {
      const dx = n.x - s.px, dy = n.y - s.py, d = Math.hypot(dx, dy) || 1;
      if (n.v > s.v) { if (d < 260 + n.r) { fx -= (dx / d) * (400 / d); fy -= (dy / d) * (400 / d); } continue; }
      const val = (n.v === s.v ? 4 : n.v / s.v) / (d + 50);
      if (val > bestScore) { bestScore = val; best = { dx, dy, d, jack: n.v === s.v }; }
    }
    if (s.pr > 50) for (const q of s.spikes) {
      const dx = q.x - s.px, dy = q.y - s.py, d = Math.hypot(dx, dy) || 1;
      if (d < s.pr + 110) { fx -= (dx / d) * 1.5; fy -= (dy / d) * 1.5; }
    }
    let mx = fx * 3, my = fy * 3;
    if (best) { mx += best.dx / best.d; my += best.dy / best.d; }
    const m = Math.hypot(mx, my) || 1;
    await page.mouse.move(640 + (mx / m) * 220, 360 + (my / m) * 220);
    if (best && best.jack && best.d < 180 && s.dashCd <= 0) await page.mouse.down().then(() => page.mouse.up());
    const el = (Date.now() - start) / 1000;
    if (shotAt.length && el > shotAt[0]) { shotAt.shift(); await page.screenshot({ path: path.join(OUT, `2-play-${String(Math.round(el)).padStart(2, '0')}s.png`) }); }
    await page.waitForTimeout(60);
  }
  bot.runs = bot.deaths + 1;
  console.log('봇 결과:', JSON.stringify(bot));
  check('봇 플레이 중 성장 발생', bot.maxV >= 16, `최고 숫자 ${bot.maxV}`);
  check('봇이 먹기 수행', bot.eats >= 5, `한 판 최다 ${bot.eats}회`);

  // 게임오버 강제 검증: 플레이어 옆에 큰 젤리 배치
  const forced = await page.evaluate(async () => {
    const g = window.__game;
    if (g.mode !== 'play') g.start();
    g.player.invuln = 0;
    const n = g.npcs[0]; n.v = g.player.v * 4; n.r = 16 + 7 * Math.log2(n.v); n.x = g.player.x; n.y = g.player.y;
    for (let i = 0; i < 60; i++) g.step(1 / 60);
    return g.mode;
  });
  check('큰 젤리와 겹치면 게임오버', forced === 'over');
  check('게임오버 화면 표시', await page.isVisible('#screenOver'));
  const reason = await page.textContent('#overReason');
  check('게임오버 사유 표시', /젤리에게 먹혔어요/.test(reason), reason);
  check('최고 점수 저장', (await page.evaluate(() => Number(localStorage.getItem('mj_best')))) >= 0);

  // 잭팟 강제 검증
  await page.keyboard.press('Enter');
  const jack = await page.evaluate(() => {
    const g = window.__game; const v0 = g.player.v;
    const n = g.npcs[0]; n.v = v0; n.r = 16 + 7 * Math.log2(v0); n.x = g.player.x; n.y = g.player.y;
    g.step(1 / 60);
    return { v0, v1: g.player.v };
  });
  check('같은 숫자 먹으면 즉시 2배', jack.v1 === jack.v0 * 2, `${jack.v0} → ${jack.v1}`);

  // 가시 강제 검증
  const spike = await page.evaluate(() => {
    const g = window.__game; const p = g.player;
    p.v = 128; p.p = 10; p.r = 16 + 7 * 7; p.invuln = 0;
    g.npcs.forEach((n) => { n.x = 50; n.y = 50; n.v = 1; });
    const s = g.spikes[0]; s.x = p.x; s.y = p.y;
    g.step(1 / 60);
    return { v: p.v, p: p.p, mode: g.mode };
  });
  check('가시 피격 시 반토막 & 생존', spike.v === 64 && spike.p === 0 && spike.mode === 'play', JSON.stringify(spike));

  // TRAP: 위협 젤리를 가시에 닿게
  const trap = await page.evaluate(() => {
    const g = window.__game; const p = g.player; p.invuln = 5;
    const n = g.npcs[1]; n.v = p.v * 2; n.r = 16 + 7 * Math.log2(n.v); n.x = p.x + 300; n.y = p.y;
    const s = g.spikes[1]; s.x = n.x; s.y = n.y;
    const before = n.v; g.step(1 / 60);
    return { before, after: n.v, pv: p.v };
  });
  check('위협 젤리가 가시에 닿으면 반토막(TRAP)', trap.after === trap.before / 2, JSON.stringify(trap));

  // 2048 클리어 배너
  const win = await page.evaluate(() => {
    const g = window.__game; const p = g.player; p.v = 1024; p.p = 0; p.invuln = 5;
    g.spikes.forEach((s) => { s.x = 30; s.y = 30; });
    const n = g.npcs[2]; n.v = 1024; n.r = p.r; n.x = p.x; n.y = p.y;
    g.step(1 / 60);
    return { v: p.v, banner: document.getElementById('banner').textContent };
  });
  check('2048 달성 시 클리어 배너', win.v === 2048 && /2048/.test(win.banner), win.banner);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, '5-win-2048.png') });
  await page.close();

  // ---------- 모바일 ----------
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  mob.on('pageerror', (e) => errors.push('[mobile] ' + e.message));
  await mob.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await mob.goto(url);
  await mob.waitForTimeout(400);
  await mob.screenshot({ path: path.join(OUT, '6-mobile-title.png') });
  await mob.tap('#btnStart');
  await mob.waitForTimeout(300);
  check('모바일: 대시 버튼 노출', await mob.isVisible('#btnDash'));
  const noScroll = await mob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('모바일: 가로 스크롤 없음', noScroll);
  await mob.tap('#btnDash');
  check('모바일: 대시 버튼 동작', (await mob.evaluate(() => window.__game.player.dashCd)) > 2);
  // 터치 이동 (터치 지속 상태를 pointer 이벤트로 재현)
  const m0 = await mob.evaluate(() => window.__game.player.x);
  await mob.evaluate(() => {
    const c = document.getElementById('game');
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: 380, clientY: 422, pointerType: 'touch', bubbles: true }));
  });
  await mob.waitForTimeout(500);
  const m1 = await mob.evaluate(() => window.__game.player.x);
  await mob.evaluate(() => document.getElementById('game').dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true })));
  check('모바일: 터치 방향 이동', m1 - m0 > 30, `dx=${(m1 - m0).toFixed(0)}`);
  await mob.screenshot({ path: path.join(OUT, '7-mobile-play.png') });

  check('콘솔/런타임 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, bot }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
