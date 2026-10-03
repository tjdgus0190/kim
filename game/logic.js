// 순수 게임 규칙 — DOM 의존 없음 (브라우저와 Node 테스트에서 공용)
(function (root) {
  const CFG = {
    WORLD: 3000,
    NPC_COUNT: 150,
    SPIKE_COUNT: 12,
    SPIKE_R: 46,
    START_V: 2,
    WIN_V: 2048,
    MAX_TIER: 14,
    DASH_TIME: 0.22,
    DASH_MULT: 2.6,
    DASH_COOLDOWN: 2.5,
    COMBO_WINDOW: 2.0,
    COMBO_MAX: 10,
    START_INVULN: 2.0,
    HIT_INVULN: 1.0,
    CHASE_LIMIT: 5,
    BORED_TIME: 3,
  };

  const STAGES = [
    { name: '얕은 접시', minTier: 0, bg: '#14121f' },
    { name: '젤리 숲', minTier: 4, bg: '#101a1d' },
    { name: '깊은 배양액', minTier: 7, bg: '#0f1426' },
    { name: '황금 심연', minTier: 10, bg: '#1d1610' },
    { name: '무한', minTier: 12, bg: '#1a1022' },
  ];

  const tierOf = (v) => Math.round(Math.log2(Math.max(1, v)));
  const radiusOf = (v) => 16 + 7 * Math.log2(Math.max(1, v));
  const speedOf = (r) => 300 * Math.pow(23 / r, 0.45);

  function stageOf(v) {
    const t = tierOf(v);
    let idx = 0;
    for (let i = 0; i < STAGES.length; i++) if (t >= STAGES[i].minTier) idx = i;
    return idx;
  }

  // 큰 쪽(bigR)이 작은 쪽(smallR)을 삼킬 만큼 겹쳤는가
  function overlapsToEat(dist, bigR, smallR) {
    return dist < Math.max(bigR - 0.3 * smallR, 0.75 * bigR);
  }

  // 플레이어 V와 상대 v의 관계
  function relation(V, v) {
    if (v < V) return 'food';
    if (v === V) return 'jackpot';
    return 'threat';
  }

  // 먹기 결과 적용. state = {v, p}. 반환: 새 상태 + 이벤트 정보
  function applyEat(state, food) {
    let v = state.v;
    let p = state.p;
    let levels = 0;
    let merged = false;
    if (food === v) {
      v *= 2;
      merged = true;
      levels = 1;
    } else if (food < v) {
      p += food;
      while (p >= v) {
        p -= v;
        v *= 2;
        levels++;
      }
    } else {
      throw new Error('cannot eat bigger blob');
    }
    return { v, p, levels, merged };
  }

  function applySpikeHit(state) {
    return { v: Math.max(CFG.START_V, state.v / 2), p: 0 };
  }

  // 가시가 이 반지름의 젤리에게 위험한가
  const spikeHurts = (r) => r > CFG.SPIKE_R * 1.1;

  function spawnWeights(tier) {
    const stage = stageOf(Math.pow(2, tier));
    return stage < 2
      ? { '-4': 1.5, '-3': 2.5, '-2': 3, '-1': 2.2, '0': 1.0, '1': 1.4, '2': 0.6 }
      : { '-4': 1.2, '-3': 2, '-2': 3, '-1': 2.2, '0': 1.0, '1': 2.0, '2': 1.0 };
  }

  // rand: () => [0,1)
  function sampleValue(playerV, rand) {
    const tier = tierOf(playerV);
    const w = spawnWeights(tier);
    const keys = Object.keys(w);
    let total = 0;
    for (const k of keys) total += w[k];
    let x = rand() * total;
    let off = 0;
    for (const k of keys) {
      x -= w[k];
      if (x <= 0) { off = Number(k); break; }
    }
    const t = Math.min(CFG.MAX_TIER, Math.max(0, tier + off));
    return Math.pow(2, t);
  }

  function nextCombo(combo, sinceLastEat) {
    return sinceLastEat <= CFG.COMBO_WINDOW ? Math.min(CFG.COMBO_MAX, combo + 1) : 1;
  }

  function eatScore(food, combo, merged) {
    return food * combo * (merged ? 2 : 1);
  }

  const Logic = {
    CFG, STAGES, tierOf, radiusOf, speedOf, stageOf, overlapsToEat, relation,
    applyEat, applySpikeHit, spikeHurts, spawnWeights, sampleValue, nextCombo, eatScore,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
  else root.Logic = Logic;
})(typeof window !== 'undefined' ? window : globalThis);
