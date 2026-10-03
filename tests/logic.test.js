// 실행: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const L = require('../game/logic.js');

test('작은 젤리를 먹으면 진행도가 쌓이고, 다 차면 2배', () => {
  let s = { v: 8, p: 0 };
  s = L.applyEat(s, 4); assert.deepStrictEqual([s.v, s.p, s.levels], [8, 4, 0]);
  s = L.applyEat(s, 2); assert.deepStrictEqual([s.v, s.p], [8, 6]);
  s = L.applyEat(s, 4); assert.deepStrictEqual([s.v, s.p, s.levels], [16, 2, 1]);
});

test('같은 숫자 = 잭팟, 진행도와 무관하게 즉시 2배 (진행도 유지)', () => {
  const s = L.applyEat({ v: 32, p: 20 }, 32);
  assert.strictEqual(s.v, 64);
  assert.strictEqual(s.p, 20);
  assert.strictEqual(s.merged, true);
});

test('큰 젤리는 먹을 수 없음', () => {
  assert.throws(() => L.applyEat({ v: 4, p: 0 }, 8));
});

test('관계 판정', () => {
  assert.strictEqual(L.relation(16, 8), 'food');
  assert.strictEqual(L.relation(16, 16), 'jackpot');
  assert.strictEqual(L.relation(16, 32), 'threat');
});

test('가시는 32부터 위험, 피격 시 반토막 & 진행도 초기화', () => {
  assert.strictEqual(L.spikeHurts(L.radiusOf(16)), false);
  assert.strictEqual(L.spikeHurts(L.radiusOf(32)), true);
  assert.deepStrictEqual(L.applySpikeHit({ v: 128, p: 50 }), { v: 64, p: 0 });
  assert.deepStrictEqual(L.applySpikeHit({ v: 2, p: 1 }), { v: 2, p: 0 });
});

test('커질수록 느려지고, 반지름은 단조 증가', () => {
  let prevR = 0, prevS = Infinity;
  for (let t = 0; t <= 14; t++) {
    const r = L.radiusOf(2 ** t), s = L.speedOf(r);
    assert.ok(r > prevR); assert.ok(s < prevS);
    prevR = r; prevS = s;
  }
});

test('먹기 판정: 같은 크기는 75% 겹쳐야, 작은 건 쉽게', () => {
  const r = 50;
  assert.ok(L.overlapsToEat(37, r, r));
  assert.ok(!L.overlapsToEat(40, r, r));
  assert.ok(L.overlapsToEat(40, 60, 20));
});

test('콤보: 2초 이내 연속이면 증가, 최대 10', () => {
  assert.strictEqual(L.nextCombo(0, 99), 1);
  assert.strictEqual(L.nextCombo(3, 1.5), 4);
  assert.strictEqual(L.nextCombo(10, 0.1), 10);
  assert.strictEqual(L.nextCombo(5, 2.5), 1);
});

test('스폰 값은 항상 2의 거듭제곱이며 범위 내', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const V of [2, 16, 256, 2048]) {
    const t = L.tierOf(V);
    for (let i = 0; i < 2000; i++) {
      const v = L.sampleValue(V, rand);
      const vt = Math.log2(v);
      assert.ok(Number.isInteger(vt));
      assert.ok(vt >= Math.max(0, t - 4) && vt <= t + 2);
    }
  }
});

test('밸런스: 2048까지 고수 15회 이상(이론상 최단), 무작위 섭취 25~45회', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sim = (visible) => {
  const runs = [];
  for (let k = 0; k < 300; k++) {
    let s = { v: 2, p: 0 }, eats = 0, guard = 0;
    while (s.v < 2048 && guard++ < 100000) {
      // 화면에 보이는 젤리 visible개 중 가장 가치 있는 먹이를 고르는 플레이어
      let bestV = 0;
      for (let i = 0; i < visible; i++) { const v = L.sampleValue(s.v, rand); if (v <= s.v && v > bestV) bestV = v; }
      if (!bestV) continue;
      s = L.applyEat(s, bestV); eats++;
    }
    runs.push(eats);
  }
  return runs.reduce((a, b) => a + b, 0) / runs.length;
  };
  const expert = sim(6), casual = sim(1);
  console.log('  2048까지 평균 먹기 횟수 — 고수(보이는 6개 중 최선):', expert.toFixed(1), '/ 무작위:', casual.toFixed(1));
  assert.ok(expert >= 15, 'expert=' + expert);
  assert.ok(casual >= 25 && casual <= 45, 'casual=' + casual);
});
