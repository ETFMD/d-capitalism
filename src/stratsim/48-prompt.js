/* ── [STRATSIM] 48 사용자 전략 프롬프트 ─────────────────────────────────────
   '프롬프트 복사'로 ChatGPT·Claude 같은 AI 에 붙여 넣는 글. 앱이 run(data, p) 에 넘기는 값과 돌려받을 모양을
   빠짐없이 적어 AI 가 추측하지 않게 함. 앱과 코드 사이의 약속(입력·출력 모양)은 원본 앱과 같아서
   원본용으로 만든 전략 코드도 그대로 돌아감 — 글과 예시 전략은 이 사이트가 새로 씀 */

// 예시 전략 안에 들어가는 '출금 처리' 부분 (설명 3-3 과 같은 내용)
const SS_WITHDRAW_SNIPPET = [
  '        // 출금 처리 — 현금으로 먼저 내고, 모자라면 들고 있는 종목을 그날 종가에 필요한 만큼만 팔아 메움(비용 포함).',
  '        // 그래도 모자라면 다 판 것으로 끝 — 계좌는 0 아래로 내려가지 않음',
  '        if (cash < 0) {',
  '          const px = close(hold, i);',
  '          if (units > 0 && px > 0) {',
  '            const sellAmt = Math.min(units * px, -cash / (1 - cost));',
  '            units -= sellAmt / px; fee += sellAmt * cost; cash += sellAmt * (1 - cost);',
  '            note = "출금 — " + hold.toUpperCase() + " 일부 매도";',
  '          }',
  '          if (cash < 0) cash = 0;',
  '        }',
].join('\n');

const SS_PROMPT = `# 백테스트 전략 코드 부탁

맨 아래 '10. 내 전략'에 적은 매매 규칙을 그대로 따르는 백테스트 전략을, 자바스크립트 객체 하나로 만들어 주세요.
이 객체는 '투자전략 시뮬레이터'라는 차트 앱에 붙여 넣어 실행됩니다. 아래 1~9 는 그 앱과 맞추기 위한 약속입니다.

## 1. 답하는 방법
1) 답 전체가 코드 블록(\`\`\`js 로 시작해 \`\`\` 로 끝남) 하나여야 합니다. 블록 앞뒤에 설명 글을 붙이지 마세요.
   채팅 화면에 맨 코드를 쓰면 따옴표가 둥근 따옴표로 바뀌는 등 글자가 망가져, 복사해도 돌아가지 않습니다.
2) 블록 안은 { 로 시작해 } 로 끝나는 객체 그대로. 변수에 담거나 괄호로 감싸거나 export 하지 마세요.
3) 코드는 같은 입력이면 늘 같은 결과를 내는 동기 코드여야 합니다.
   쓰면 안 되는 것: import·require, async·await, fetch·XMLHttpRequest, setTimeout·setInterval, 화면(DOM),
   Math.random, run 의 두 인자(data, p) 밖의 값. 오류를 던지지 말고, 가격이 0 이거나 없을 때를 미리 막으세요.
4) 빨라야 합니다. 앱은 화면 값을 바꿀 때마다 다시 돌리고, 설정 목록을 펼치면 선택지 수만큼(30번 넘게) 더 돌립니다.
   이동 평균·이동 합계는 날마다 하나 더하고 하나 빼는 식으로 이어 가고, 날짜 반복 안에서 지난 기록 전체를 다시 훑지 마세요.
5) 사람이 읽는 글(name, label, tip, note, 판단판 글)은 모두 한국어로. 종목 이름은 TQQQ 처럼 영문 그대로 둡니다.

## 2. 객체 모양
{
  name: "짧은 전략 이름",
  params:  [ ... ],   // 설정 칸 — 5장
  columns: [ ... ],   // 기록 표에 새로 만든 열의 이름·설명 — 6장
  lines:   [ ... ],   // 작은 신호 차트에 그릴 기준선 — 6장
  run(data, p) {
    // 날마다 계좌를 계산해 기록(log)을 남기고(4장), 마지막 날 규칙의 상태를 알려 줍니다(7장)
    return { log: log, signals: { cards: [ ... ], decision: { ... } } };
  }
}

## 3. 앱이 run(data, p) 에 넘기는 것

### 3-1. data — 날마다의 값 (모든 배열은 길이가 같고, 같은 번호 i 는 같은 날)
- data.dates : "YYYY-MM-DD" 글자, 오래된 날부터. 거래일만 있어 주말·휴일은 빠져 있습니다.
- 일별 종가(분배금 재투자 반영)
  - data.qqq  QQQ  (나스닥100)
  - data.spy  SPY  (S&P 500)
  - data.qld  QLD  (나스닥100 2배)
  - data.tqqq TQQQ (나스닥100 3배)
  - data.sso  SSO  (S&P 500 2배)
  - data.spxl SPXL (S&P 500 3배)
  - data.sqqq SQQQ (나스닥100 −3배 인버스 — 나스닥이 내리면 오름)
  상장 전 기간은 지수로 재현한 값이라 TQQQ·SQQQ 도 1971년 2월 5일(자료 첫날)부터 있습니다.
- data.nfci : 미국 시카고 연은 금융 여건 지수(NFCI). 주간 발표값을 발표 지연(7일)을 두고 거래일마다 채운 것이라 미리 알 수 없는 값은 없습니다.
  가격이 아니라 지표입니다(0 보다 크면 평소보다 돈줄이 빡빡함, +0.5 넘으면 신용 불안). 자료 첫날 무렵 발표 전 날은 NaN 일 수 있으니 쓰기 전에 isFinite() 로 확인하세요.
- 종목 id(위 소문자 이름)로 data[id] 처럼 꺼낼 수 있습니다 — 종목을 설정으로 고르게 할 때 이렇게 쓰세요.
- 아주 이른 날짜 몇 개는 가격이 0 일 수 있습니다. 나눗셈 전에 막으세요.
- 배열은 전체 기간입니다. 이동 평균을 미리 채우려고 p.startIdx 앞의 값을 읽는 것은 괜찮지만,
  기록(log)에는 p.startIdx ~ p.endIdx 안의 날짜만 넣으세요.

### 3-2. p — 이번 계산의 조건
- p.initial : 시작 금액(현금). p.startIdx 날에 들어 있습니다.
- p.contributions : { "YYYY-MM-DD": 금액 } — 돈이 들어오거나 나가는 모든 날. 적립이 없어도 빈 객체 {} 입니다(null 아님).
  보통은 달마다 양수 하나(매달 적립)지만, 사용자가 실제 거래내역을 넣으면 날짜가 불규칙하고 출금(음수)도 있습니다.
  적립금은 반드시 이 객체로 처리하고 직접 계산하지 마세요. 날짜 반복 안에서:
    const amt = p.contributions[data.dates[i]] || 0;
    if (amt !== 0) { cash += amt; contributed = amt; invested += amt; action = "contribution"; }
- p.monthly, p.annualRaise : 화면의 '매달 적립'·'해마다 늘림' 값. 실제 거래내역을 쓸 때는 맞지 않으니 계산에 쓰지 마세요.
- p.startIdx, p.endIdx : 계산할 첫날과 마지막 날의 번호(둘 다 포함).
- p.entryDate, p.exitDate : 그 두 날의 날짜 글자(data.dates[p.startIdx], data.dates[p.endIdx]).
- p.weeklyDisplay : 차트 가로축이 주 단위면(대략 10년보다 짧은 기간) true, 아니면 false 또는 없음. 기록을 얼마나 자주 남길지에만 씁니다(4-3).
- p.<설정 id> : 5장의 설정마다 사용자가 고른 값. 숫자 선택지는 숫자, [true, false] 는 참·거짓, 나머지는 글자로 옵니다.

### 3-3. 출금 처리
출금으로 현금이 0 아래가 될 수 있습니다. 그 즉시(같은 날) 들고 있는 종목을 그날 종가에 모자란 만큼만 팔아 현금을 0 으로 돌리세요.
거래 비용을 계산하는 전략이면 이 매도에도 비용을 매깁니다. 계좌 전체로도 모자라면 다 팔고 현금 0. 하루가 끝날 때 현금은 늘 0 이상입니다.
9장 예시의 '출금 처리' 부분을 그대로 써도 됩니다.

## 4. 돌려줄 것 — 기록(log)
log 는 날짜순 배열이고, 한 줄이 기록 표의 한 행, 키 하나가 한 열입니다. 꼭 있어야 하는 키는 date 와 value 이지만,
아래에서 해당하는 키는 모두 채워야 표와 차트 표시가 제대로 나옵니다.

### 4-1. 줄마다 넣을 키
- date : data.dates 의 그 날짜 글자
- value : 그날 계좌 전체 금액 = 현금 + 보유 종목 평가액
- action : 그날 한 일 — 4-2 의 낱말로 시작
- note : 짧은 메모 (예: "중심선보다 6.2% 위", "5번 중 3번째 매수")
- held : 이 줄 뒤에 들고 있는 것, 대문자 ("TQQQ", "CASH", "TQQQ+CASH") — 모든 줄에. 차트 거래 표시의 테두리 색이 이것으로 정해집니다
- price : held 종목의 그날 종가 (현금이면 0 또는 생략)
- shares : 보유 주수
- holdingsValue : 현금을 뺀 보유 평가액
- cash : 현금
- invested : 지금까지 넣은 돈 합계 (시작 금액 + 적립, 출금은 뺌)
- contributed : 그날 들어온 돈 (출금은 음수, 없으면 0)
- fee : 그날 낸 거래 비용 (없으면 0)
- 그 밖에 규칙 판단에 쓴 숫자를 키로 더 넣으세요(신호 종목 종가, 기준선 값, 차이 % 등). 종목을 설정으로 바꿀 수 있으니
  키 이름에 종목 이름을 넣지 말고 assetPrice·signalPrice 처럼 역할로 지으세요.
- 표는 키 이름으로 서식을 정합니다: price·sma·ema·median·avg·mean 이 들어가면 가격, share·unit·qty 는 주수,
  pct·percent 는 %, 그 밖의 숫자는 금액($). 이에 맞춰 이름을 지으세요(개수·일수처럼 금액이 아닌 값은 log 대신 7장 판단판에).

### 4-2. action 낱말 (소문자로, 이 중 하나로 시작)
- "start" : 첫날 시작 평가
- "buy" : 현금으로 종목을 삼
- "sell" : 종목을 팔고 현금으로
- "switch" : 한 종목을 팔고 바로 다른 종목으로
- "rebalance" : 다 바꾸지 않고 비중만 맞춤
- "ease-in" : 나눠 사기 중 한 번
- "contribution" : 돈이 들어오거나(입금) 나감(출금) — 매매 판단 없음
- "hold" : 거래 없는 정기 평가
- "end" : 마지막 날 평가
낱말 뒤에 설명을 이어 써도 됩니다("buy — 5번 중 3번째"). 앱은 앞 낱말만 봅니다.

### 4-3. 기록을 남기는 날
- 첫날(start)과 마지막 날(end)
- 사고판 날, 비중을 맞춘 날, 나눠 산 날마다
- p.contributions 에 있는 날마다(출금 포함 — action "contribution", contributed = 그날 금액)
- 그리고 거래가 없어도 달마다 한 번(p.weeklyDisplay 가 true 면 주마다 한 번) "hold" 줄
  앱은 기록 줄 사이를 이어 그리므로, 주 단위 화면에서 주마다 줄이 없으면 선이 계단처럼 납작해집니다. 날짜 반복 안에서 이렇게 확인하면 됩니다:
    const next = i < p.endIdx ? data.dates[i + 1] : null;
    const weekOf = (d) => Math.floor((Date.parse(d) / 86400000 + 3) / 7);   // 월요일에 바뀌는 주 번호
    const lastOfMonth = !next || next.slice(0, 7) !== data.dates[i].slice(0, 7);
    const lastOfWeek = p.weeklyDisplay && (!next || weekOf(next) !== weekOf(data.dates[i]));

### 4-4. 차트와 표가 기록을 쓰는 법
- buy·sell·switch·rebalance 줄은 그 날짜의 전략 선 위에 표시로 그려지고, 표시에 마우스를 올리면 그 줄이 풍선으로 보입니다.
  contribution·ease-in·hold·start·end 는 표시 없이 표에만 나옵니다.
- 기록 표는 모든 줄을 보여 주고, 적립 줄·나눠 사기 줄을 숨기는 칸이 있습니다. 표의 줄에 마우스를 올리면 차트의 그 표시가 밝아집니다.

## 5. 설정 칸(params) 만들기
설정 칸 하나가 화면 옆 드롭다운 하나가 되고, 고른 값이 run 에서 p.<id> 로 들어옵니다.
- 모양: { id: "자바스크립트 이름", label: "칸 이름", options: [ ... ], default: options 중 하나 }
- 선택지는 숫자·글자 또는 { value, label }. 예: { value: "tqqq", label: "TQQQ" } 는 TQQQ 로 보이고 "tqqq" 가 넘어갑니다. label 은 꾸미지 말고 종목 이름 그대로.
- 켬·끔은 options: [true, false].
- 칸이 많으면 { section: "소제목" } (id 없음)을 사이에 넣어 묶을 수 있습니다. 예: "보유 종목", "신호", "실행·비용".

### 5-1. 어떤 칸을 만드나 — 설명에 적힌 것만
설정 칸은 '10. 내 전략'에 적힌 종목·숫자·기간을 바꿔 보게 하려는 것입니다. 칸마다 설명의 어느 말에서 나왔는지 댈 수 있어야 하고,
댈 수 없으면 만들지 마세요. 설명에 없는 장치를 넣으면 내가 시키지 않은 규칙이 전략을 바꿔 버립니다. 설명이 짧으면 칸도 적어야 맞습니다.
특히 내가 말하지 않았다면 넣지 말 것: 다시 사는 별도 문턱(나가는 규칙이 풀리면 다시 사는 것으로 충분), 완충 띠·확인 일수,
추가 필터·손절·나눠 사기·최소 보유 기간, 매매 종목과 다른 '신호 종목'('A 를 보고 B 를 사고판다'고 했을 때만).

꼭 만들어야 하는 칸:
1) 매매 종목 — 내가 말한 종목이 기본값, 선택지는 비슷한 종목들(tqqq, qld, spxl, sso, qqq, spy · 헤지 전략이면 sqqq). 코드에서는 data[p.<id>] 로 꺼냅니다(data.tqqq 처럼 고정하지 않기).
2) 빠져 있을 때 들고 있을 것 — 빠지는 상태가 있는 전략만. "cash" 를 꼭 넣으세요. 예: ["cash", "qqq", "spy", "sso", "qld"], 기본 "cash".
   "cash" 는 아무것도 사지 않은 현금 상태이고 data["cash"] 는 없으니 가격을 꺼내기 전에 막으세요.
3) 설명에 나온 문턱·기간·비율 하나하나("55% 위", "250일 중앙값", "300일 평균") — 숫자를 코드에 박지 말고 칸으로.
4) 현금 이자(연 %) — 현금으로 있을 수 있는 전략만. 예: [0, 0.5, 1, …, 6, 7, 8]
5) 거래 비용 — 모든 전략에 반드시, 정확히 이 모양으로(앱의 다른 전략과 같게):
   { id: "tradeCost", label: "거래 비용 (%)", default: 0.02, options: [0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
   거래 금액의 % 를 매수·매도·갈아타기 양쪽·나눠 사기 한 번마다 매기고, 그 줄의 fee 에 적으세요. 0 을 기본값으로 하거나 빼먹지 마세요.

이동 평균과 중앙값은 서로 바꿔 볼 수 있게: 규칙에 이동 평균이나 이동 중앙값이 들어가면, 설명에 나온 쪽을 기본값으로 하는 칸을 하나 더 만드세요.
   { id: "stat", label: "중심선", options: [ { value: "sma", label: "이동평균" }, { value: "median", label: "중앙값" } ], default: "sma" }
   (설명에 중앙값이라고 했으면 default: "median") — 같은 기간으로, 고른 쪽으로 계산합니다.

### 5-2. 숫자 칸의 선택지 — 넉넉하고 촘촘하게
드롭다운을 펼치면 앱이 선택지마다 끝까지 계산해 결과를 막대로 보여 줍니다. 그래서 숫자 칸은 선택지가 15~40개여야 쓸모가 있습니다
(2~3개짜리 숫자 칸은 만들지 마세요). 내가 말한 값을 가운데 두고 양쪽으로 넓게, 가까운 곳은 촘촘히·먼 곳은 성기게
— 예: 기간 [20, 30, 40, …, 300, 320, 350, 400] 이 [100, 200, 300] 보다 낫습니다.

## 6. 표 열 설명(columns)과 신호 차트(lines)
- columns : 4장에서 새로 만든 키마다 { key, label, tip } 하나. tip 은 열 이름 옆 ⓘ 에 뜨는 쉬운 설명입니다
  (무엇을 잰 값인지, 언제 비는지, 어떤 열과 같이 보면 되는지). 기본 키(date, value, action, held, price, shares, cash, invested, contributed, fee)는 앱이 설명하므로 쓰지 않아도 됩니다.
- lines : 규칙이 가격을 어떤 기준선(이동 평균, 중앙값, 과열 띠, 손절선 등)과 비교한다면 그 선들을 { key, label } 로, 최대 6개.
  key 는 값이 생긴 뒤의 모든 기록 줄에 넣는 숫자 키이고(값이 아직 없는 초반 줄은 빼도 됨), 비교하는 가격과 같은 단위로 넣습니다.
  비교되는 가격 자체도 첫 선으로 넣으세요(예: { key: "signalPrice", label: "QQQ 종가" }).
  이 선들은 본 차트가 아니라 전략 설정 창 안의 작은 '신호 차트'에 그려집니다.

## 7. 오늘의 판단판(signals) — 꼭 넣기
기록과 함께, 계산 마지막 날(p.endIdx) 규칙들이 어떤 상태인지 signals 로 돌려주세요. 사용자는 기록을 읽지 않아도 '오늘 새 돈을 넣으면 무엇을 하나'를 봅니다.
마지막 날 이미 계산해 둔 변수로 만들고, 전략을 한 번 더 돌리지 마세요.
- cards : 계기판 4~6개. 각 { label, value, sub, tip, tone, icon }
  - label 짧은 이름(예: "QQQ vs 200일 평균") · value 큰 글자(예: "▲ +6.42%", "77") · sub 아래 작은 줄(예: "$740.86 vs 평균 $696.17")
  - tip 이 값이 무엇이고 판단을 어느 쪽으로 미는지 · tone "good"(투자 쪽) / "bad"(빠지는 쪽) / 생략(중립) — 숫자의 부호가 아니라 상태로
  - icon 은 trendUp, trendDown, clock, sliders, activity, shield, dollar, flag 중 하나
  - 전략이 쓰는 규칙마다 하나씩(추세, 각 지표, 우선 규칙, 완충 등) — 설정 칸의 값이 지금 어떤 상태인지 다 보이게
- decision : 오늘 목돈을 넣는다면 — { action, note, tone, reasons }
  - action 2~4 낱말(예: "TQQQ 매수", "현금 유지") · note 짧은 이유 · tone 투자 쪽 "good", 빠지는 쪽 "bad"
  - reasons 규칙마다 한 줄 { name, val, tag, lean } — 예: { name: "추세", val: "QQQ +6.42% vs 200일", tag: "위 · TQQQ", lean: "buy" }
    lean 은 "buy", "out", "cash", "hold" 중 하나(줄 앞 점의 색)
  - 판단은 코드의 규칙과 같은 변수에서 나와야 합니다. 설명을 다시 해석해 따로 만들지 마세요.

## 8. 계산할 때 지킬 것
- 현금과 보유 주수는 코드 안의 변수로 직접 관리합니다. 앱이 대신 투자해 주는 것은 없습니다.
- 사고팔기는 그날 종가(data[id][i])로. 그날까지의 값으로만 판단하고 다음 날 이후 값은 보지 마세요.
- TQQQ·QLD·SSO·SPXL·SQQQ 는 이미 레버리지 상품입니다. 빚을 내거나 배율을 더 키우지 마세요.
  SQQQ 는 −3배 인버스라 나스닥이 오르거나 횡보하면 빠르게 녹습니다 — 짧은 헤지로만 말이 됩니다.
- 설명이 이름 있는 공개 전략(9sig, 듀얼 모멘텀, HFEA, 올웨더, 200일선 타이밍 등)을 가리키면, 이름으로 짐작하지 말고
  (검색할 수 있으면 찾아서) 실제로 알려진 규칙과 숫자를 그대로 구현하세요.

## 9. 다 만든 예 (모양 참고용 — 내 전략과 다르니 그대로 쓰지 마세요)
{
  name: "중앙값 추세 + 아래 확인",
  // 이 예가 구현한 설명: "QQQ 가 200일 중앙값 위면 TQQQ 를 사고, 3거래일 연속 중앙값 아래면 팔고 현금으로."
  // 칸마다 출처: 매매 종목(TQQQ) · 빠졌을 때(현금) · 신호 종목(QQQ 를 보고 TQQQ 를 매매) · 기간(200일)
  //   · 중심선(중앙값 — 평균과 바꿔 보기) · 아래 확인(3거래일) · 현금 이자 · 거래 비용
  params: [
    { section: "보유 종목" },
    { id: "asset", label: "매매 종목", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "out", label: "빠졌을 때", default: "cash", options: [
      { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" } ] },
    { section: "신호" },
    { id: "signal", label: "신호 종목", default: "qqq", options: [
      { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }, { value: "tqqq", label: "TQQQ" } ] },
    { id: "days", label: "기간 (거래일)", default: 200, options: [
      30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,210,220,230,240,250,260,280,300,330,360,400] },
    { id: "stat", label: "중심선", default: "median", options: [
      { value: "median", label: "중앙값" }, { value: "sma", label: "이동평균" } ] },
    { id: "confirm", label: "아래 확인 (거래일)", default: 3, options: [
      1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,20,25,30] },
    { section: "실행·비용" },
    { id: "cashRate", label: "현금 이자 (연 %)", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", label: "거래 비용 (%)", default: 0.02, options: [
      0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
  ],
  columns: [
    { key: "signalPrice", label: "신호 종가", tip: "추세를 보는 종목(기본 QQQ)의 그날 종가입니다. 사고파는 종목과 다를 수 있습니다." },
    { key: "centerPrice", label: "중심선", tip: "신호 종목의 최근 N거래일 중앙값(또는 평균)입니다. 종가가 이보다 위면 매매 종목을 듭니다." },
    { key: "gapPct", label: "중심선과 차이", tip: "종가가 중심선보다 몇 % 위(+)·아래(−)인지입니다. 아래가 확인 일수만큼 이어지면 팝니다." }
  ],
  lines: [
    { key: "signalPrice", label: "신호 종가" },
    { key: "centerPrice", label: "중심선" }
  ],
  run(data, p) {
    const dates = data.dates, sig = data[p.signal] || data.qqq;
    const close = (id, i) => (id === "cash" || !data[id] ? 0 : data[id][i] || 0);
    const N = p.days, cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const weekOf = (d) => Math.floor((Date.parse(d) / 86400000 + 3) / 7);
    // 최근 N 거래일 창: 들어온 순서(queue)와 크기 순서(sorted)를 함께 두고 하루에 하나씩 넣고 뺌
    const queue = [], sorted = [];
    let total = 0;
    const push = (v) => {
      queue.push(v); total += v;
      let k = 0;
      while (k < sorted.length && sorted[k] < v) k++;
      sorted.splice(k, 0, v);
      if (queue.length > N) { const old = queue.shift(); total -= old; sorted.splice(sorted.indexOf(old), 1); }
    };
    const centerNow = () => {
      const n = sorted.length;
      if (n < N) return 0;   // 창이 다 차기 전에는 판단하지 않음
      if (p.stat !== "median") return total / n;
      const h = n >> 1;
      return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
    };
    for (let k = Math.max(0, p.startIdx - N); k < p.startIdx; k++) if (sig[k] > 0) push(sig[k]);

    const log = [];
    let cash = p.initial, units = 0, hold = "cash", invested = p.initial;
    let center = 0, gap = 0, below = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (sig[i] > 0) push(sig[i]);
      let action = "hold", note = "", fee = 0, contributed = 0;
      cash *= 1 + dayRate;
      const amt = p.contributions[dates[i]] || 0;
      if (amt !== 0) {
        cash += amt; contributed = amt; invested += amt; action = "contribution";
<<출금 처리>>
      }
      center = centerNow();
      gap = center > 0 && sig[i] > 0 ? sig[i] / center - 1 : 0;
      below = center > 0 && gap < 0 ? below + 1 : 0;
      let want = hold;
      if (center > 0) {
        if (gap > 0) want = p.asset;
        else if (below >= p.confirm) want = p.out;
      }
      if (want !== hold) {
        const pxOld = close(hold, i), pxNew = close(want, i);
        if (hold !== "cash" && pxOld > 0) { const g = units * pxOld; fee += g * cost; cash += g * (1 - cost); units = 0; }
        if (want !== "cash" && pxNew > 0) { fee += cash * cost; units = cash * (1 - cost) / pxNew; cash = 0; }
        action = hold === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = "중심선과 " + (gap >= 0 ? "+" : "") + (gap * 100).toFixed(1) + "%";
        hold = want;
      } else if (hold !== "cash" && cash > 0 && close(hold, i) > 0) {
        // 들어온 적립금은 들고 있는 종목으로 바로
        fee += cash * cost; units += cash * (1 - cost) / close(hold, i); cash = 0;
      }
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      const next = i < p.endIdx ? dates[i + 1] : null;
      const lastOfMonth = !next || next.slice(0, 7) !== dates[i].slice(0, 7);
      const lastOfWeek = p.weeklyDisplay && (!next || weekOf(next) !== weekOf(dates[i]));
      if (action !== "hold" || contributed !== 0 || lastOfMonth || lastOfWeek) {
        const px = close(hold, i), stock = units * px;
        const row = { date: dates[i], value: stock + cash, action: action, note: note, held: hold.toUpperCase(),
          price: px, shares: units, holdingsValue: stock, cash: cash, invested: invested, contributed: contributed, fee: fee,
          signalPrice: sig[i] };
        if (center > 0) { row.centerPrice = center; row.gapPct = gap * 100; }
        log.push(row);
      }
    }

    const A = p.asset.toUpperCase(), O = p.out === "cash" ? "현금" : p.out.toUpperCase(), SG = p.signal.toUpperCase();
    const up = gap > 0, out = !up && below >= p.confirm;
    const gapTxt = (gap >= 0 ? "+" : "") + (gap * 100).toFixed(2) + "%";
    const statName = p.stat === "median" ? "중앙값" : "평균";
    return {
      log: log,
      signals: {
        cards: [
          { label: SG + " vs " + N + "일 " + statName, value: (up ? "▲ " : "▼ ") + gapTxt, tone: up ? "good" : "bad", icon: up ? "trendUp" : "trendDown",
            sub: "종가 " + sig[p.endIdx].toFixed(2) + " · 중심선 " + center.toFixed(2),
            tip: "신호 종목의 마지막 종가와 최근 " + N + "거래일 " + statName + "입니다. 위면 " + A + " 를 들고, 아래가 " + p.confirm + "거래일 이어지면 " + O + "(으)로 옮깁니다." },
          { label: "아래에 머문 날", value: below + " / " + p.confirm + "일", tone: out ? "bad" : "good", icon: "clock",
            sub: below ? "중심선 아래 " + below + "거래일째" : "중심선 위",
            tip: "중심선 아래로 내려간 뒤 이어진 거래일 수입니다. 확인 일수에 닿으면 팝니다 — 하루 이틀 흔들림에 팔지 않으려는 장치입니다." },
          { label: "지금 보유", value: hold === "cash" ? "현금" : hold.toUpperCase(), icon: "shield",
            sub: "계좌 $" + Math.round(units * close(hold, p.endIdx) + cash).toLocaleString("en-US"),
            tip: "계산 마지막 날 들고 있는 것과 계좌 금액입니다." },
          { label: "현금 이자", value: "연 " + (p.cashRate || 0) + "%", icon: "dollar", sub: "현금으로 있을 때",
            tip: "빠져 있는 동안 현금에 붙는 이자입니다. 빠지는 대신 다른 종목을 고르면 쓰이지 않습니다." }
        ],
        decision: {
          action: up ? A + " 매수" : out ? (O === "현금" ? "현금 유지" : O + " 매수") : (hold === "cash" ? "현금 유지" : hold.toUpperCase() + " 보유"),
          note: up ? "종가가 중심선 위" : out ? "중심선 아래가 확인됨" : "중심선 아래지만 아직 확인 전",
          tone: up || (!out && hold !== "cash") ? "good" : "bad",
          reasons: [
            { name: "추세", val: SG + " " + gapTxt + " vs " + N + "일", tag: up ? "위 · " + A : "아래", lean: up ? "buy" : "out" },
            { name: "확인", val: below + "/" + p.confirm + "거래일", tag: out ? "빠짐 · " + O : "유지", lean: out ? "cash" : "hold" }
          ]
        }
      }
    };
  }
}

## 10. 내 전략 (이 설명대로 코드를 써 주세요)
<<여기에 내 전략 설명>>`;

function ssBuildPrompt(desc) {
  const d = String(desc || '').trim();
  return SS_PROMPT.replace('<<출금 처리>>', () => SS_WITHDRAW_SNIPPET).replace('<<여기에 내 전략 설명>>', () => d || '<<여기에 내 전략 설명>>');
}
