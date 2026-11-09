// POST /submit  →  D1 저장 + 텔레그램 알림 (여러 채팅방 동시 발송)
//
//  TG_BOT_TOKEN  : 기존 봇 토큰 그대로 (새로 만들지 않습니다)
//  TG_CHAT_ID    : 1번 방 — 유입경로를 "실제 채널" 그대로 표시 (기존과 100% 동일)
//  TG_CHAT_ID_2  : 2번 방 — 유입경로를 "항상 메타"로 표시 (추가 발송)
//                  쉼표로 구분하면 3번, 4번 방도 함께 받을 수 있습니다.

const SECOND_CHANNEL_LABEL = "메타"; // ← 2번 방에 찍힐 유입경로 문구

/** 알림 문구 생성 (원본과 동일한 포맷) */
function buildMessage(d) {
  return (
    `🔔 시티오씨엘 9단지 신규 문의\n\n` +
    `👤 이름: ${d.name}\n` +
    `📞 연락처: ${d.phone}\n` +
    `🏠 관심평형: ${d.type || "-"}\n` +
    `📊 유입경로: ${d.channel || "-"}\n` +
    (d.utm_source
      ? `🔗 광고: ${d.utm_source}${d.utm_medium ? " / " + d.utm_medium : ""}${d.utm_campaign ? " / " + d.utm_campaign : ""}\n`
      : "") +
    `🕒 ${d.createdAt} (KST)`
  );
}

/** 한 방으로 전송 — 실패해도 다른 방 발송에 영향을 주지 않습니다 */
async function sendTelegram(token, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.error("Telegram fail:", chatId, res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Telegram error:", chatId, err);
  }
}

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

    // 2) 예약 카운트 +1 (84부터 시작)
    let count = 84;
    try {
      const row = await env.DB.prepare(
        "UPDATE stats SET v = v + 1 WHERE k = 'reservations' RETURNING v"
      ).first();
      if (row && row.v) count = row.v;
    } catch (cntErr) { console.error("count error:", cntErr); }

    // 3) 텔레그램 알림 — 응답을 기다리지 않고 전송 (고객은 즉시 다음 화면으로)
    const base = { name, phone, type, utm_source, utm_medium, utm_campaign, createdAt };

    const jobs = [];

    //  ① 1번 방 : 실제 유입경로 그대로 (기존과 완전히 동일한 문구)
    if (env.TG_CHAT_ID) {
      jobs.push(sendTelegram(env.TG_BOT_TOKEN, env.TG_CHAT_ID, buildMessage({ ...base, channel })));
    }

    //  ② 추가 방 : 유입경로를 "메타"로 고정 (쉼표로 여러 방 지정 가능)
    const extraIds = String(env.TG_CHAT_ID_2 || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (extraIds.length) {
      const msgMeta = buildMessage({ ...base, channel: SECOND_CHANNEL_LABEL });
      for (const id of extraIds) {
        jobs.push(sendTelegram(env.TG_BOT_TOKEN, id, msgMeta));
      }
    }

    if (jobs.length) {
      context.waitUntil(Promise.allSettled(jobs));
    }

    return new Response(JSON.stringify({ ok: true, count }), {
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
