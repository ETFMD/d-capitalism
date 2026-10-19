-- 방문자 수 카운터 (D1)
CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, h TEXT NOT NULL, PRIMARY KEY (day, h));   -- 그날 중복 확인용 해시 (2일 뒤 삭제)
CREATE TABLE IF NOT EXISTS daily  (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);        -- 날짜별 순방문자 수
CREATE TABLE IF NOT EXISTS cache  (k TEXT PRIMARY KEY, t INTEGER NOT NULL, v TEXT NOT NULL);     -- 외부 자료 짧은 캐시 (CNN 공포·탐욕 5분)
CREATE TABLE IF NOT EXISTS kr     (u TEXT PRIMARY KEY, want INTEGER NOT NULL, t INTEGER, st INTEGER, v TEXT);  -- 한국 수집기: 요청 주소 · 받은 시각 · 상태 · 내용
CREATE TABLE IF NOT EXISTS kr_lease (u TEXT PRIMARY KEY, until INTEGER NOT NULL);  -- 한국 수집기 여러 대: 같은 주소를 겹쳐 받지 않게 잠시 맡김
DELETE FROM cache WHERE k = 'kr_agent';  -- 예전 한 대용 기록
-- 간편 로그인 회원 (이메일·전화번호는 받지 않음) · 탈퇴하면 즉시 삭제
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, pid TEXT NOT NULL, nick TEXT, created INTEGER NOT NULL, last INTEGER, agreed INTEGER, terms_ver TEXT, ver INTEGER NOT NULL DEFAULT 0, UNIQUE (provider, pid));
-- 내 저장함: 계산기 입력값 스냅숏
CREATE TABLE IF NOT EXISTS saves (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, page TEXT NOT NULL, title TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS saves_uid ON saves (uid, id);
-- 실시간 접속: 브라우저별 무작위 번호 · 마지막 신호 시각 (10분 지나면 정리)
CREATE TABLE IF NOT EXISTS live (s TEXT PRIMARY KEY, t INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS live_t ON live (t);
-- 계정에 담는 도구 자료 (예: 무한매수법 기록) — 키별 한 덩어리 JSON · t 는 버전(밀리초, 충돌 확인용) · 탈퇴하면 즉시 삭제
CREATE TABLE IF NOT EXISTS udata (uid INTEGER NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (uid, k));
-- 72루틴 자동매매 PC 생존 감시 (/hb · worker/src/hb.js): PC 별 무작위 열쇠의 해시(id) · 알림 대상(암호화) · 마지막 신호 · 다음 주문 시각 · 보낸 알림 (30일 조용하면 삭제)
CREATE TABLE IF NOT EXISTS hb (id TEXT PRIMARY KEY, tgh TEXT, mid TEXT, cred TEXT, last INTEGER NOT NULL, next INTEGER, cut INTEGER, ds TEXT, st TEXT, alarm TEXT, created INTEGER NOT NULL);
-- 72루틴 자동매매 PC 여러 대 (/grp · worker/src/grp.js): 묶음(주문 PC·epoch·암호화한 공유 상태·비밀값) · 묶음의 PC 들 · 공유 접속 토큰(암호화) — 60일 조용하면 삭제
CREATE TABLE IF NOT EXISTS grp (id TEXT PRIMARY KEY, owner TEXT, epoch INTEGER NOT NULL DEFAULT 0, seen INTEGER, done INTEGER, fz TEXT, want TEXT, req TEXT, ver INTEGER NOT NULL DEFAULT 0, state TEXT, st_at INTEGER, st_by TEXT, sec TEXT, sec_at INTEGER, created INTEGER NOT NULL, upd INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS grp_pc (gid TEXT NOT NULL, mid TEXT NOT NULL, name TEXT, rank INTEGER, seen INTEGER, ver TEXT, rd TEXT, PRIMARY KEY (gid, mid));
CREATE TABLE IF NOT EXISTS grp_tok (gid TEXT NOT NULL, b TEXT NOT NULL, s TEXT, exp INTEGER, at INTEGER, by_mid TEXT, PRIMARY KEY (gid, b));
-- (뺌 2026-10-19) 72루틴 배포판 라이선스(/license) — 사용자 결정으로 기능 삭제 · 발급 0건(비밀값을 넣기 전)이라 빈 표만 정리
DROP TABLE IF EXISTS lic_pc;
DROP TABLE IF EXISTS lic;
-- 건의 게시판 (/board · worker/src/board.js · 사이트 /suggest/): 글(분류 bug·feat·etc·notice · 처리 상태 open·plan·done·hold · 비밀글 · 쓴 사람이 고른 경우만 기기 정보) · 댓글(운영자 답변 admin=1) · 공감(회원당 글마다 1번) — 글쓴이가 지우거나 탈퇴하면 즉시 삭제
CREATE TABLE IF NOT EXISTS board_post (id INTEGER PRIMARY KEY AUTOINCREMENT, uid INTEGER NOT NULL, cat TEXT NOT NULL, st TEXT NOT NULL DEFAULT 'open', title TEXT NOT NULL, body TEXT NOT NULL, page TEXT, secret INTEGER NOT NULL DEFAULT 0, info TEXT, created INTEGER NOT NULL, upd INTEGER, sat INTEGER);
CREATE INDEX IF NOT EXISTS board_post_uid ON board_post (uid, created);
CREATE TABLE IF NOT EXISTS board_cmt (id INTEGER PRIMARY KEY AUTOINCREMENT, pid INTEGER NOT NULL, uid INTEGER NOT NULL, body TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS board_cmt_pid ON board_cmt (pid, id);
CREATE INDEX IF NOT EXISTS board_cmt_uid ON board_cmt (uid, created);
CREATE TABLE IF NOT EXISTS board_vote (pid INTEGER NOT NULL, uid INTEGER NOT NULL, PRIMARY KEY (pid, uid));
CREATE INDEX IF NOT EXISTS board_vote_uid ON board_vote (uid);
