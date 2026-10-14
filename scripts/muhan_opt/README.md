# 무한매수법 백테스트 설정 탐색 (2026-10 · 수동 실행용 연구 도구)

시뮬레이터(`/muhan-backtest/`)의 모든 설정을 TQQQ·SOXL·UPRO·TECL × 상장 이후·상장 전 포함으로 훑어
CAGR 최고 · 안정 최고(이웃 25곳 중앙값) · 균형(이웃 중앙 CAGR ÷ |MDD|) 설정을 찾는다. 엔진은 `src/index.html` 의 MHE·MHV 를 그대로 읽는다.
사이트 배포·자동 갱신과는 무관 — 필요할 때만 돌린다. 결과(2026-10-13)는 인수인계 문서 ㉓, 평단 LOC 괴리율 0% 고정으로 다시 돈 결과는 ㉗, 거기에 증권사 주문 거부 처리까지 넣은 결과는 ㉝.

**증권사 주문 거부(2026-10-14 ㉝)** — `muhan_opt.js`·`muhan_rob.js`·`prep.js`·`final.js` 는 환경 변수 `REJ=clamp`(한도로 낮춰 넣기) · `REJ=skip`(그날 건너뛰기)를 받는다(없으면 반영 안 함).
매수 지정가 > 그날 시가 × 1.2(1센트 버림)이면 증권사가 주문을 받지 않는다고 보고 엔진 `MHV.run` 의 `o.rej` 로 계산 — 시뮬레이터 '7. 고급 설정 → 증권사 주문 거부'·주소 `rj=c|s` 와 같은 계산.
자료에 시가 `o` 가 있어야 함(`dump.py` 가 화면의 `MBT.withOpen`·`MBT.preOpen` 으로 꺼냄 — 상장 전 재현 구간은 같은 지수 ETF(QQQ·SOXX·SMH·SPY·XLK) 시가 변화 × 3, 그것도 없는 날은 0 = 전날 종가로 봄).
`final.js`·`report.js` 의 시뮬레이터 주소엔 `rj=`·`e=<자료 끝날>` 이 붙어 같은 조건·같은 기간으로 열린다.
**주문 넣는 때(2026-10-14 ㉞)** — 다섯 스크립트(`muhan_opt.js`·`muhan_rob.js`·`prep.js`·`final.js`·`report.js`)는 환경 변수 `FILL=open`(정규장 시작 전 주문: 정규장이 지정가 매도가보다 높게 시작하면 그날 시가에 팔림)
· `FILL=pre`(프리장 시작 — 한국 17~18시 — 주문: 전날 종가가 이미 지정가 이상이면 전날 종가에 팔림, 주문 거부 한도의 기준도 전날 종가)를 받는다(없으면 기존 계산 = 그날 고가가 닿으면 지정가).
엔진 `MHV.run` 의 `o.fill` · 시뮬레이터 '7. 고급 설정 → 주문 넣는 때' · 주소 `ft=o|p` 와 같은 계산이고, `final.js`·`report.js`·`verify.py` 의 주소에도 `ft=` 가 붙는다. `final.js` 계산 저장 열쇠에 FILL(과 시가)이 들어가 다른 시각의 결과를 섞지 않는다.
Actions 는 입력 `fill`(none·open·pre)이 모든 단계에 같은 값으로 들어간다. 일봉엔 프리장 고가가 없어 `pre` 는 갭 상승도 지정가에 팔았다고 보는 보수적 계산.

**GitHub Actions** — 원격 브랜치를 쓰지 않으려고(동시작업 규칙) main 의 `.github/workflows/muhan-opt.yml`(수동 실행 전용)로 돌린다: Actions → '무한매수법 설정 탐색 (수동)' → rej(both·clamp·skip·none)·fix·stage(all·s2·final)·from_run.
한 번 실행으로 자료(dump) → 1단계(칸 = 거부 처리 × 기간 × 버전 × 종목, 동시에 16칸) → 2단계 출발점(regions.js·prep.js) → 2단계 → 최종 정리(final.js·report.js — 종목마다)까지 하고, 결과는 실행의 artifact(`final-<rej>-<종목>`).
앞 단계 결과는 `gh run download` 로 받는다(`actions/download-artifact` 에 run-id 를 주면 artifact 목록을 100개까지만 읽어, ㉝ 첫 실행의 최종 정리에서 1단계 칸이 빠졌음 · 받은 칸 수가 모자라면 경고).
**보고할 숫자는 보고 직전 화면 자료로** — 실행의 자료는 실행을 건 커밋의 시세 봇 자료와 그때 야후 일봉이라, 그 뒤 시세 봇 시가(소수 4자리 반올림)·야후 과거 값(상장 전 재현에 쓰는 지수 ETF, 1e-6 수준)이 바뀌면
화면과 아주 조금 달라진다(㉝: 20:55Z 와 21:50Z 사이에 바뀜). 그래서 ㉝ 은 1·2단계 결과(후보)는 실행 것을 쓰고, `dump.py` 로 다시 꺼낸 화면 자료로 `final.js` 를 로컬에서 돌려 뽑고(이전 탐색 후보·다른 거부 방식의 후보도 `label` 로 함께 넣음), 뽑힌 설정을 화면 주소로 열어 숫자가 같은지 확인했다.

**설정 고정** — 세 스크립트(`muhan_opt.js`·`muhan_rob.js`·`final.js`)와 `cons_starts.js` 모두 환경 변수 `FIX='avgOff=0'` 처럼 `이름=값`(쉼표로 여러 개)을 받는다.
고정한 값은 탐색하지 않고 출발점·기본값에도 그 값을 쓰며, `final.js` 는 다른 값을 가진 후보를 뺀다. 이름은 설정 키(`splits`·`target`·`big`·`lines`·`shares`·`part`·`capP`·`avgOff`·`money`·`exhaust`·`restart`·`tround`·`rebase`·`noBig`·`method`·`harvest`).

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
   — 2단계 결과 폴더는 하위 폴더까지 읽으므로 여러 번의 탐색 결과를 링크로 모아 한 번에 넣을 수 있다. `rob_<종목>_<기간>_cagr.json` 형식(`{tk, per, label, nEval: 0, runs: [{p}]}`)으로
     이전 탐색의 후보를 넣으면 `label` 이 CSV '어디서 나온 후보' 에 그대로 찍힌다(예: 설정을 고정해 다시 돌릴 때, 이전 탐색 후보 중 고정값과 같은 것을 함께 비교).
6. **제약 탐색**(선택 · 상장 이후): `node scripts/muhan_opt/cons_starts.js <1단계 결과> <후보.csv> scripts/muhan_opt/regions.json [이전 추천.csv …]` 로 출발점(`startsK`)을 넣고
   `node scripts/muhan_opt/muhan_rob.js <종목> act cons [버전]` — 가운데·이웃 중앙·원금 10만$ MDD ≥ −60% 와 하방 LOC 10줄 이하 안에서 min(이웃 중앙 CAGR, 10만$ CAGR) 최대
   (조건을 넘은 만큼 10배로 깎음). '세후 CAGR ≥ 35% · MDD ≥ −60%' 같은 조건부 추천을 고를 때 후보를 넓히는 용도.
7. **증권사 주문 거부 점검**(㉝): `node scripts/muhan_opt/modes.js <데이터> src/index.html <이름=final.json> …` — 뽑힌 설정을 반영 안 함·한도로 낮춰 넣기·그날 건너뛰기에 모두 넣어 표로
   · `node scripts/muhan_opt/rejsens.js <데이터> src/index.html <건너뛰기 final.json>` — 한도 배수(×1.15~×1.5)·기준가(시가/전날 종가)를 바꿔도 버티는지(건너뛰기로 뽑힌 높은 숫자는 ×1.2 에만 맞춰진 경우가 많음)
   · `node scripts/muhan_opt/robust.js <데이터> src/index.html <출력.json> <두 방식 후보.csv …>` — 6가지 가정(반영 안 함 · 낮춰 넣기 · 건너뛰기 ×1.2·×1.15·×1.25·전날 종가) 중 가장 나쁜 값으로 최고·안정·균형
8. **주문 넣는 때 점검**(㉞): 1·2단계 결과(후보)는 그대로 두고 `FILL=pre REJ=clamp node scripts/muhan_opt/final.js …` 처럼 최종 정리만 다시 돌리면 같은 후보 안에서 그 시각 기준으로 다시 고른다(전체 격자 재탐색은 Actions 에 `fill` 을 넣어 처음부터)
9. **화면 확인**: `python3 scripts/muhan_opt/verify.py snap <데이터>`(지금 화면 자료와 비교 · `verify/data_now/` 에 씀 → `node scripts/muhan_opt/prep.js - - scripts/muhan_opt/verify/data_now src/index.html` 로 hyb 를 만든 뒤 보고용 final.js 는 이 자료로) · `verify.py picks <final.json …>` · `verify.py urls <목록.json>`
   — 저장소 페이지를 127.0.0.1 로 열고 광고·분석 요청은 막음 · 야후 일봉은 `verify/ysnap/` 에 저장해 같은 원문으로(환경 변수 `VERIFY_DIR`·`CHARTJS` 선택)

## 기준

- 환경 = 시뮬레이터 기본값: 원금 $10,000 · 1주 단위 · 수수료 0.07% + SEC · 분배 원천징수 15% · 양도세 22%(선입선출 · 5월 말 계좌 현금, 모자라면 팔아 냄)
- CAGR = (최종 ÷ 원금)^(365.25 ÷ 일수) − 1 · MDD = 평가금 최고점 대비 최저 (화면과 같음)
- 안정 최고 = 이웃 25곳 중앙 CAGR 최고 · 균형 = 이웃 중앙 CAGR ÷ |이웃 중앙 MDD| 최고 (이웃 중앙 CAGR ≥ 안정 최고의 절반)
- 상장 전 포함 '믿을 만함' = |dh| ≤ 2%p 이고 |dSyn| ≤ 5%p 이며 |dSynG| < 5%p — dh: 상장 뒤 실제 종가에 상장 전과 같은 추정 고가를 붙여 돌린 CAGR − 실제 CAGR(추정 고가 탓) · dSyn: 상장 뒤 재현 종가·추정 고가로 돌린 CAGR − 실제 CAGR(재현 가격 전체 탓, 세후)
  · dSynG: 같은 차이를 세전(수수료·세금 없음)으로 — 시뮬레이터 '상장 전 백테스트 오차' ② 와 같은 값이라, 이 조건으로 고른 설정은 화면에 '상장 전 구간 결과는 믿기 어려워요' ⚠ 이 뜨지 않는다
- 문자 그대로 모든 조합은 약 1.4 × 10^17가지(V2.1 이 대부분)라 격자 + 좌표 탐색 + 이웃 중앙값 탐색으로 줄였음
