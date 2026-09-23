// POST /submit  →  D1 저장 + 텔레그램 알림
// 기존에 운영하던 텔레그램 봇/채팅방을 그대로 사용합니다. (TG_BOT_TOKEN / TG_CHAT_ID 환경변수)

export async function onRequestPost(context) {
  const { request, env } = context;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  try {
    const data = await request.json();

    const name         = (data.name || "").toString().slice(0, 50);
    const phone        = (data.phone || "").toString().slice(0, 30);
    const type         = (data.type || "").toString().slice(0, 80);
    const channel      = (data.channel || "").toString().slice(0, 50);
    const utm_source   = (data.utm_source || "").toString().slice(0, 100);
    const utm_medium   = (data.utm_medium || "").toString().slice(0, 100);
    const utm_campaign = (data.utm_campaign || "").toString().slice(0, 100);
    const referrer     = (data.referrer || "").toString().slice(0, 300);
    const event_id     = (data.event_id || "").toString().slice(0, 100);
    const page_url     = (data.page_url || "").toString().slice(0, 300);

    if (!name || !phone) {
      return new Response(JSON.stringify({ ok: false, error: "name/phone required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }

    const createdAt = new Date(Date.now() + 9 * 3600 * 1000)
      .toISOString().replace("T", " ").slice(0, 19);

    // 1) D1 저장
    await env.DB.prepare(
      `INSERT INTO leads
       (created_at, name, phone, type, channel, utm_source, utm_medium, utm_campaign, referrer, event_id, page_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      createdAt, name, phone, type, channel,
      utm_source, utm_medium, utm_campaign, referrer, event_id, page_url
    ).run();

    // 2) 텔레그램 알림
    const msg =
      `🔔 시티오씨엘 9단지 신규 문의\n\n` +
      `👤 이름: ${name}\n` +
      `📞 연락처: ${phone}\n` +
      `🏠 관심평형: ${type || "-"}\n` +
      `📊 유입경로: ${channel || "-"}\n` +
      `🕒 ${createdAt} (KST)`;

    try {
      await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: msg }),
      });
    } catch (tgErr) {
      console.error("Telegram error:", tgErr);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
