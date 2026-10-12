# 무한매수법 백테스트 설정 탐색 (2026-10 · 수동 실행용 연구 도구)

시뮬레이터(`/muhan-backtest/`)의 모든 설정을 TQQQ·SOXL·UPRO·TECL × 상장 이후·상장 전 포함으로 훑어
CAGR 최고 · 안정 최고(이웃 25곳 중앙값) · 균형(이웃 중앙 CAGR ÷ |MDD|) 설정을 찾는다. 엔진은 `src/index.html` 의 MHE·MHV 를 그대로 읽는다.
사이트 배포·자동 갱신과는 무관 — 필요할 때만 돌린다. 결과(2026-10-13)는 인수인계 문서 ㉓.

## 순서

1. `python scripts/build_pages.py` → `python scripts/muhan_opt/dump.py` → `node scripts/muhan_opt/prep.js - - scripts/muhan_opt/data src/index.html`
   (`data/<종목>_act|pre|late|hyb.json` — 화면과 같은 일봉·재현 일봉·원/달러. 광고·분석 요청은 막고 엶)
2. **1단계** (GitHub Actions 권장 — 1칸 5~140분, 4코어): 칸마다 `node scripts/muhan_opt/muhan_opt.js <종목> <act|pre> <1.0|2.0|2.1|2.2|3.0|4.0>`
   — 분할 2~100 × 목표 0.5~50(0.5)+55~100(5) × 버전의 모든 선택 조합 격자 → 상위 출발점에서 모든 설정을 UI 범위 전체로 좌표 탐색 → `out/<종목>_<기간>_<버전>.json`
   (matrix: per [pre, act] × ver × tk = 48칸 · `timeout-minutes: 340` · `max-parallel: 16` · `scripts/muhan_opt/out/` 을 artifact 로)
3. `node scripts/muhan_opt/regions.js <1단계 결과 폴더> scripts/muhan_opt/regions.json` → `node scripts/muhan_opt/prep.js <1단계 결과 폴더> scripts/muhan_opt/regions.json scripts/muhan_opt/data src/index.html`
4. **2단계**: `node scripts/muhan_opt/muhan_rob.js <종목> <act|pre> <cagr|calmar|cagrC|calmarC>` (act 는 cagr·calmar 만 · 1칸 3~12분)
   — 이웃 25곳(분할 ±2 × 목표 ±1, 0.5 간격) 중앙값을 목표로 좌표 탐색 · 살 수 없는 날(nob) 있는 설정 제외 · C = 상장 전 재현 믿음도(|dh| ≤ 2%p) 조건
5. `CACHE=<폴더> node scripts/muhan_opt/final.js <1단계 결과> <2단계 결과> scripts/muhan_opt/data src/index.html <출력>` (`ONLY=TQQQ,SOXL` 로 나눠 돌릴 수 있음)
   → `final.json` · `무한매수법_설정탐색_후보.csv`(후보 전부 + 시뮬레이터 주소) → `node scripts/muhan_opt/report.js <final.json …>` 보고용 표 · `node scripts/muhan_opt/perver.js <후보.csv …>` 버전별 안정 최고 표

## 기준

- 환경 = 시뮬레이터 기본값: 원금 $10,000 · 1주 단위 · 수수료 0.07% + SEC · 분배 원천징수 15% · 양도세 22%(선입선출 · 5월 말 계좌 현금, 모자라면 팔아 냄)
- CAGR = (최종 ÷ 원금)^(365.25 ÷ 일수) − 1 · MDD = 평가금 최고점 대비 최저 (화면과 같음)
- 안정 최고 = 이웃 25곳 중앙 CAGR 최고 · 균형 = 이웃 중앙 CAGR ÷ |이웃 중앙 MDD| 최고 (이웃 중앙 CAGR ≥ 안정 최고의 절반)
- 상장 전 포함 '믿을 만함' = |dh| ≤ 2%p 이고 |dSyn| ≤ 5%p — dh: 상장 뒤 실제 종가에 상장 전과 같은 추정 고가를 붙여 돌린 CAGR − 실제 CAGR(추정 고가 탓) · dSyn: 상장 뒤 재현 종가·추정 고가로 돌린 CAGR − 실제 CAGR(재현 가격 전체 탓)
- 문자 그대로 모든 조합은 약 1.4 × 10^17가지(V2.1 이 대부분)라 격자 + 좌표 탐색 + 이웃 중앙값 탐색으로 줄였음
