// POST /submit  →  D1 저장 + 텔레그램 알림 (여러 채팅방 동시 발송)
//
//  TG_BOT_TOKEN  : 기존 봇 토큰 그대로
//  TG_CHAT_ID    : 1번 방 — 유입경로/광고 = 실제 값 그대로 (기존과 100% 동일)
//  TG_CHAT_ID_2  : 2번 방 — 유입경로 = "메타", 광고 = "meta / paid /" 고정
//                  쉼표로 구분하면 여러 방에 동시 발송

const EXTRA_CHANNEL_LABEL = "메타";          // 2번 방 유입경로 문구
const EXTRA_AD_LINE       = "meta / paid /"; // 2번 방 광고 문구 (항상 이 값)

/**
 * 알림 문구 생성 (원본 submit.js 와 동일 포맷)
 * @param d          원본 데이터
 * @param override   { channel, utmFixed } — utmFixed 를 주면 광고 줄을 그 값으로 고정
 */
function buildMessage(d, override) {
  const ov = override || {};
  const channel = ov.channel !== undefined ? ov.channel : d.channel;

  let adLine;
  if (ov.utmFixed !== undefined) {
    adLine = ov.utmFixed;                       // 고정 문구
  } else if (d.utm_source) {
    adLine = d.utm_source +
      (d.utm_medium   ? " / " + d.utm_medium   : "") +
      (d.utm_campaign ? " / " + d.utm_campaign : "");
  } else {
    adLine = null;                              // utm 없으면 줄 자체를 넣지 않음
  }

  return (
    `🔔 시티오씨엘 9단지 신규 문의\n\n` +
    `👤 이름: ${d.name}\n` +
    `📞 연락처: ${d.phone}\n` +
    `🏠 관심평형: ${d.type || "-"}\n` +
    `📊 유입경로: ${channel || "-"}\n` +
    (adLine !== null ? `🔗 광고: ${adLine}\n` : "") +
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

    // 2) 예약 카운트 +1
    let count = 84;
    try {
      const row = await env.DB.prepare(
        "UPDATE stats SET v = v + 1 WHERE k = 'reservations' RETURNING v"
      ).first();
      if (row && row.v) count = row.v;
    } catch (cntErr) { console.error("count error:", cntErr); }

    // 3) 텔레그램 알림
    const base = { name, phone, type, utm_source, utm_medium, utm_campaign, createdAt };
    const jobs = [];

    //  ① 1번 방 : 실제 값 그대로
    if (env.TG_CHAT_ID && env.TG_BOT_TOKEN) {
      jobs.push(sendTelegram(env.TG_BOT_TOKEN, env.TG_CHAT_ID, buildMessage({ ...base, channel })));
    }

    //  ② 추가 방 : 유입경로 = 메타, 광고 = meta / paid /  (항상)
    const extraIds = String(env.TG_CHAT_ID_2 || "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (extraIds.length && env.TG_BOT_TOKEN) {
      const msgExtra = buildMessage({ ...base, channel: EXTRA_CHANNEL_LABEL }, {
        channel: EXTRA_CHANNEL_LABEL,
        utmFixed: EXTRA_AD_LINE,
      });
      for (const id of extraIds) {
        jobs.push(sendTelegram(env.TG_BOT_TOKEN, id, msgExtra));
      }
    }

    if (jobs.length) context.waitUntil(Promise.allSettled(jobs));

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
