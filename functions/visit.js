// POST /visit  →  방문(세션) 기록
// · 같은 탭에서 하루 1회만 기록 (새로고침 중복 방지)
// · 크롤러·미리보기 봇은 제외
// · 유입경로(채널)·UTM·방문자 식별자를 함께 저장

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/* KST 기준 날짜 (YYYY-MM-DD) */
function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/* 링크 미리보기·검색봇·모니터링 제외 (방문량 왜곡 방지) */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk|kakao|whatsapp|telegram|twitterbot|preview|headless|monitor|uptime|pingdom|lighthouse|googlebot|bingpreview|yeti|daum|naver.*bot/i;

/* visits 테이블 자동 준비 (schema.sql 없이도 동작) — 워커 인스턴스당 1회만 실행 */
let visitsReady = false;
async function ensureTable(env) {
  if (visitsReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS visits (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       created_at   TEXT NOT NULL,
       day          TEXT NOT NULL,
       channel      TEXT,
       utm_source   TEXT,
       utm_medium   TEXT,
       utm_campaign TEXT,
       referrer     TEXT,
       page_url     TEXT,
       vid          TEXT,
       is_new       INTEGER
     )`
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visits_day ON visits (day DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visits_vid ON visits (vid)").run();
  visitsReady = true;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const ua = request.headers.get("user-agent") || "";
  if (!ua || BOT.test(ua)) {
    return json({ ok: true, skipped: "bot" });
  }

  try {
    const data = await request.json().catch(() => ({}));
    const S = (v, n) => (v == null ? "" : String(v).trim().slice(0, n));

    const channel = S(data.channel, 50);
    const utm_source = S(data.utm_source, 100);
    const utm_medium = S(data.utm_medium, 100);
    const utm_campaign = S(data.utm_campaign, 100);
    const referrer = S(data.referrer, 300);
    const page_url = S(data.page_url, 300);
    const vid = S(data.vid, 60);
    const is_new = data.is_new ? 1 : 0;

    await ensureTable(env);

    await env.DB.prepare(
      `INSERT INTO visits
       (created_at, day, channel, utm_source, utm_medium, utm_campaign, referrer, page_url, vid, is_new)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19),
      kstToday(), channel, utm_source, utm_medium, utm_campaign, referrer, page_url, vid, is_new
    ).run();

    return json({ ok: true });
  } catch (err) {
    // 방문 집계 실패가 사이트 이용을 막지 않도록 항상 ok 로 응답
    return json({ ok: false, error: String(err) });
  }
}
