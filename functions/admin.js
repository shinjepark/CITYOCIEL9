// POST /admin  →  비밀번호 확인 후 조회 / 수정 / 삭제
// action 없음(기본) = 조회 + 채널별·캠페인별·일자별 집계
// action: "update"  → 이름·연락처·관심평형·유입경로 수정
// action: "delete"  → 해당 건 삭제

function json(o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readBody(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

/* KST 기준 날짜 문자열 (YYYY-MM-DD) */
function kstDate(offsetDays) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 - (offsetDays || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

function tally(map, key) {
  const k = key || "미상";
  map[k] = (map[k] || 0) + 1;
}

/* {키:건수} → 건수 내림차순 배열 */
function sortDesc(map) {
  return Object.keys(map)
    .map((k) => ({ k, v: map[k] }))
    .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await readBody(request);
    const { password, action } = body;

    if (!password || password !== env.ADMIN_PASSWORD) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    /* ---------------- 수정 ---------------- */
    if (action === "update") {
      const id = parseInt(body.id, 10);
      if (!id) return json({ ok: false, error: "id required" }, 400);

      const clean = (v, n) => (v == null ? "" : String(v).trim().slice(0, n));
      const name = clean(body.name, 50);
      const phone = clean(body.phone, 30);
      const type = clean(body.type, 80);
      const channel = clean(body.channel, 50);

      if (!name || !phone) {
        return json({ ok: false, error: "name/phone required" }, 400);
      }

      await env.DB.prepare(
        "UPDATE leads SET name = ?, phone = ?, type = ?, channel = ? WHERE id = ?"
      ).bind(name, phone, type, channel, id).run();

      return json({ ok: true, id });
    }

    /* ---------------- 삭제 ---------------- */
    if (action === "delete") {
      const id = parseInt(body.id, 10);
      if (!id) return json({ ok: false, error: "id required" }, 400);

      await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();

      return json({ ok: true, id });
    }

    /* ---------------- 조회 + 집계 ---------------- */
    const { results } = await env.DB.prepare(
      `SELECT id, created_at, name, phone, type, channel,
              utm_source, utm_medium, utm_campaign, referrer, page_url
       FROM leads ORDER BY id DESC`
    ).all();

    const byChannel = {}, bySource = {}, byCampaign = {}, byMedium = {}, byType = {}, byDay = {};

    for (const r of results) {
      tally(byChannel, r.channel);
      tally(bySource, r.utm_source);
      tally(byCampaign, r.utm_campaign);
      tally(byMedium, r.utm_medium);
      tally(byType, r.type);
      const d = (r.created_at || "").slice(0, 10);
      if (d) tally(byDay, d);
    }

    const today = kstDate(0);
    const todayCount = results.filter((r) => (r.created_at || "").slice(0, 10) === today).length;

    const since7 = kstDate(6);
    const weekCount = results.filter((r) => {
      const d = (r.created_at || "").slice(0, 10);
      return d >= since7;
    }).length;

    /* 최근 14일 (값 없는 날도 0으로 채움) */
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = kstDate(i);
      days.push({ k: d, v: byDay[d] || 0 });
    }

    /* 예약 카운터 (말풍선 숫자) */
    let reservations = 84;
    try {
      const row = await env.DB.prepare("SELECT v FROM stats WHERE k = 'reservations'").first();
      if (row && row.v) reservations = row.v;
    } catch (e) { /* stats 테이블 없으면 기본값 */ }

    return json({
      ok: true,
      total: results.length,
      todayCount,
      weekCount,
      reservations,
      stats: {
        byChannel: sortDesc(byChannel),
        bySource: sortDesc(bySource),
        byCampaign: sortDesc(byCampaign),
        byMedium: sortDesc(byMedium),
        byType: sortDesc(byType),
        byDay: days,
      },
      rows: results,
    });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}
