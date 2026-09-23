-- 시티오씨엘 9단지 오션파크뷰 : 관심고객 / 방문예약 DB
-- 기존 홈페이지에서 쓰던 D1 데이터베이스를 그대로 사용하는 경우 이 파일은 실행하지 않아도 됩니다.
-- (테이블 구조가 동일합니다)

CREATE TABLE IF NOT EXISTS leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   TEXT NOT NULL,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  type         TEXT,
  channel      TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  referrer     TEXT,
  event_id     TEXT,
  page_url     TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);
