// POST /admin  →  비밀번호 확인 후 전체 문의 조회
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { password } = await request.json();

    if (!password || password !== env.ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { results } = await env.DB.prepare(
      `SELECT id, created_at, name, phone, type, channel,
              utm_source, utm_medium, utm_campaign, referrer, page_url
       FROM leads ORDER BY id DESC`
    ).all();

    const summary = {};
    for (const r of results) {
      const key = r.channel || "미상";
      summary[key] = (summary[key] || 0) + 1;
    }

    return new Response(JSON.stringify({ ok: true, total: results.length, summary, rows: results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
