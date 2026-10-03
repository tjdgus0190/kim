# 🟡 MERGE JELLY — 같은 숫자를 먹으면 2배!

**Agar.io(먹고 커지기) × 2048(같은 숫자 합체)** 를 섞은 브라우저 게임입니다.

- 작은 숫자 젤리 → 먹어서 진행도를 채움
- **같은 숫자 젤리 → 즉시 합체 ×2 (잭팟!)**
- 큰 숫자 젤리 → 먹히면 게임 오버
- 가시 → 32부터 닿으면 반토막. 대신 쫓아오는 큰 젤리를 가시로 유인하면 그 녀석이 반토막 (TRAP!)
- 목표: **2048** 달성, 이후 무한 모드

## 플레이
빌드 과정 없음. `game/index.html`을 브라우저로 열면 됩니다.
```bash
npx serve game   # 또는 python3 -m http.server -d game
```

| 조작 | PC | 모바일 |
|---|---|---|
| 이동 | 마우스 / WASD·방향키 | 화면 터치 |
| 대시 | 클릭 / Space | ⚡ 버튼 |
| 일시정지 | P / Esc | ⏸ |

## 제작 과정 문서
1. [시장 분석 (마케터)](docs/01-market-analysis.md)
2. [컨셉 & 비주얼 기획서 (서브 기획자)](docs/02-concept.md)
3. [게임 디자인 기획서 — 재미 검증·로직·레벨 (메인 기획자)](docs/03-game-design.md)
4. [UI/UX 디자인 명세 (디자이너)](docs/04-ui-ux.md)
5. 구현 (개발자) — `game/logic.js`(순수 규칙), `game/game.js`(렌더·입력·AI), `game/style.css`
6. [QA 보고서](docs/05-qa-report.md)

## 테스트
```bash
npm test          # 규칙 + 밸런스 시뮬레이션
npm run test:e2e  # Playwright 브라우저 QA (봇 자동 플레이)
```
