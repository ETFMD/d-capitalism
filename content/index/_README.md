# 지수 성장률 페이지 고유 해설 (content/index/<지수키>.html)

- scripts/data_facts.py 의 index_block() 이 이 파일 + 자동 통계 표를 합쳐 지수 페이지의 `<!--IDXNOTE:키-->` 자리에 넣음 (scripts/build_pages.py)
- 본문 안 `{{키}}` 는 빌드 때 최신 값으로 바뀜: name · asof · first · first_y · v · hi · hi_d · from_hi(고점 대비, 음수) · below_hi(고점보다 낮은 폭, 양수) · mdd · mdd_peak · mdd_low · mdd_rec · cagr1·3·5·10·20·30(데이터가 있는 것만)
- 없는 키를 쓰면 빌드 실패 — 날짜·숫자처럼 바뀌는 값은 직접 쓰지 말고 키로 (역사적 사실은 그대로 써도 됨)
