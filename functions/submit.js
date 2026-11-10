// POST /submit  →  D1 저장 + 텔레그램 알림
//
//  TG_BOT_TOKEN : 기존 봇 토큰 그대로
//  TG_CHAT_ID   : 1번 방 — 유입경로/광고 = 실제 값 그대로 (기존과 100% 동일, 매번 발송)
//  TG_CHAT_ID_2 : 메타 방 목록 (쉼표 구분, 개수 제한 없음)
//                 → 접수 1건당 "그중 한 곳"에만 랜덤 배분 발송
//                 → 유입경로 "메타", 광고 "meta / paid /" 고정
//
// 배분 방식: 사이클 셔플
//   n개 방을 한 묶음(n건)으로 보고, 묶음마다 순서를 무작위로 섞어 1건씩 소진.
//   묶음마다 순서가 달라서 "순서대로"로 보이지 않으면서,
//   n건마다 각 방이 정확히 1건씩 받아 오차가 0% 입니다.

const META_CHANNEL_LABEL = "메타";
const META_AD_LINE       = "meta / paid /";
const MAX_META_ROOMS     = 30;

/* ── 유틸 ───────────────────────────────────────────── */
function parseIds(raw) {
  const seen = new Set();
  const out  = [];
  for (const part of String(raw || "").split(/[,\s]+/)) {
    const t = part.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, MAX_META_ROOMS);
}

function hash32(n) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** v(1부터 증가) → 0..n-1  : 묶음마다 셔플된 순열에서 한 칸씩 */
function pickIndex(n, v) {
  if (n <= 1) return 0;
  const cycle = Math.floor((v - 1) / n);
  const pos   = (v - 1) % n;
  const rnd   = mulberry32(hash32(cycle + 0x9E3779B9));
  const deck  = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck[pos];
}

/* ── 알림 문구 ──────────────────────────────────────── */
function buildMessage(d, override) {
  const ov      = override || {};
  const channel = ov.channel !== undefined ? ov.channel : d.channel;

  let adLine;
  if (ov.utmFixed !== undefined)      adLine = ov.utmFixed;
  else if (d.utm_source)              adLine = d.utm_source +
      (d.utm_medium   ? " / " + d.utm_medium   : "") +
      (d.utm_campaign ? " / " + d.utm_campaign : "");
  else                                adLine = null;

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

async function sendTelegram(token, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error("Telegram fail:", chatId, res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("Telegram error:", chatId, err);
    return false;
  }
}

/** 배분 순번 얻기 — D1 카운터 1회 왕복. 실패하면 무작위로 폴백 */
async function nextSeq(env) {
  try {
    const row = await env.DB.prepare(
      `INSERT INTO stats (k, v) VALUES ('meta_seq', 1)
       ON CONFLICT(k) DO UPDATE SET v = v + 1
       RETURNING v`
    ).first();
    if (row && Number.isFinite(Number(row.v))) return Number(row.v);
  } catch (e) { console.error("meta_seq error:", e); }
  return null;
}

/* ── 메인 ───────────────────────────────────────────── */
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
        status: 400, headers: { "Content-Type": "application/json", ...cors },
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

    // 3) 텔레그램
    const base = { name, phone, type, utm_source, utm_medium, utm_campaign, createdAt };
    const jobs = [];

    //  ① 1번 방 — 실제 유입경로 그대로, 매번 발송
    if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
      jobs.push(sendTelegram(env.TG_BOT_TOKEN, env.TG_CHAT_ID, buildMessage({ ...base, channel })));
    }

    //  ② 메타 방 — 그중 한 곳에만 랜덤 배분
    const metaRooms = parseIds(env.TG_CHAT_ID_2)
      .filter((id) => id !== String(env.TG_CHAT_ID || "").trim());

    if (env.TG_BOT_TOKEN && metaRooms.length) {
      const seq = await nextSeq(env);
      const idx = seq === null
        ? Math.floor(Math.random() * metaRooms.length)
        : pickIndex(metaRooms.length, seq);

      const target = metaRooms[idx];
      const msgMeta = buildMessage({ ...base, channel: META_CHANNEL_LABEL }, {
        channel: META_CHANNEL_LABEL,
        utmFixed: META_AD_LINE,
      });

      console.log("meta assign:", { seq, idx, target, rooms: metaRooms.length });
      jobs.push(sendTelegram(env.TG_BOT_TOKEN, target, msgMeta));
    }

    if (jobs.length) context.waitUntil(Promise.allSettled(jobs));

    return new Response(JSON.stringify({ ok: true, count }), {
      status: 200, headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json", ...cors },
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
