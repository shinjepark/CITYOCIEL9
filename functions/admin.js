// POST /admin  →  비밀번호 확인 후 조회 / 수정 / 삭제 + 유입 집계
// action 없음(기본) = 신청 목록 + 채널별·캠페인별·일자별 + 방문 집계·전환율
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

/* [{k,v}...] → 건수 내림차순 */
function sortDesc(map) {
  return Object.keys(map)
    .map((k) => ({ k, v: map[k] }))
    .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
}

/* 방문 집계 : SQL 집계로 처리 (행 전체를 내려받지 않음) */
async function visitStats(env) {
  const empty = {
    total: 0, unique: 0, today: 0, week: 0, newV: 0,
    byChannel: [], bySource: [], byDay: [],
  };
  try {
    const today = kstDate(0);
    const since7 = kstDate(6);
    const since14 = kstDate(13);

    const t = await env.DB.prepare(
      "SELECT COUNT(*) c, COUNT(DISTINCT vid) u, SUM(CASE WHEN is_new=1 THEN 1 ELSE 0 END) n FROM visits"
    ).first();

    const td = await env.DB.prepare("SELECT COUNT(*) c FROM visits WHERE day = ?").bind(today).first();
    const wk = await env.DB.prepare("SELECT COUNT(*) c FROM visits WHERE day >= ?").bind(since7).first();

    const ch = await env.DB.prepare(
      "SELECT COALESCE(NULLIF(channel,''),'미상') k, COUNT(*) v, COUNT(DISTINCT vid) u FROM visits GROUP BY k ORDER BY v DESC"
    ).all();

    const src = await env.DB.prepare(
      "SELECT COALESCE(NULLIF(utm_source,''),'(UTM 없음)') k, COUNT(*) v FROM visits GROUP BY k ORDER BY v DESC"
    ).all();

    const day = await env.DB.prepare(
      "SELECT day k, COUNT(*) v, COUNT(DISTINCT vid) u FROM visits WHERE day >= ? GROUP BY day ORDER BY day"
    ).bind(since14).all();

    return {
      total: (t && t.c) || 0,
      unique: (t && t.u) || 0,
      newV: (t && t.n) || 0,
      today: (td && td.c) || 0,
      week: (wk && wk.c) || 0,
      byChannel: (ch.results || []).map((r) => ({ k: r.k, v: r.v, u: r.u })),
      bySource: (src.results || []).map((r) => ({ k: r.k, v: r.v })),
      byDay: (day.results || []).map((r) => ({ k: r.k, v: r.v, u: r.u })),
    };
  } catch (e) {
    return empty;
  }
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
    const weekCount = results.filter((r) => (r.created_at || "").slice(0, 10) >= since7).length;

    /* 최근 14일 (0건인 날도 채움) */
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
    } catch (e) { /* stats 없으면 기본값 */ }

    /* 방문 집계 + 채널별 전환율 */
    const vs = await visitStats(env);

    const leadByChannel = {};
    for (const r of sortDesc(byChannel)) leadByChannel[r.k] = r.v;

    const seen = {};
    const conv = [];
    for (const v of vs.byChannel) {
      seen[v.k] = 1;
      conv.push({ k: v.k, visits: v.v, uniq: v.u, leads: leadByChannel[v.k] || 0 });
    }
    for (const l of sortDesc(byChannel)) {
      if (!seen[l.k]) conv.push({ k: l.k, visits: 0, uniq: 0, leads: l.v });
    }
    conv.sort((a, b) => b.visits - a.visits || b.leads - a.leads);
    for (const c of conv) c.rate = c.visits > 0 ? +(c.leads / c.visits * 100).toFixed(1) : null;

    const vDayMap = {};
    for (const d of vs.byDay) vDayMap[d.k] = d.v;

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
      visits: vs,
      conversion: conv,
      visitLeadByDay: days.map((d) => ({ k: d.k, leads: d.v, visits: vDayMap[d.k] || 0 })),
      rows: results,
    });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}
