// GET /tgtest           → 설정 상태만 확인 (발송 안 함, 안전)
// GET /tgtest?send=1    → 두 방에 실제 테스트 발송까지
//
// 진단이 끝나면 이 파일을 삭제하고 재배포하세요.

const KEY = "ciel9"; // ← 접속 키 (주소에 ?key=ciel9)

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const parseIds = (raw) => {
  const seen = new Set(), out = [];
  for (const part of String(raw || "").split(/[,\s]+/)) {
    const t = part.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
  }
  return out;
};

const mask = (v) => {
  const s = String(v == null ? "" : v);
  if (!s) return "(없음)";
  return s.length <= 10 ? s : s.slice(0, 6) + "…" + s.slice(-4);
};

async function tg(token, method, payload) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const body = await res.json().catch(() => ({}));
    return { http: res.status, ok: body.ok === true,
      error_code: body.error_code || null, description: body.description || null,
      result: body.result || null };
  } catch (e) {
    return { http: 0, ok: false, error_code: "NETWORK", description: String(e), result: null };
  }
}

const HINT = {
  400: "chat_id 값이 틀렸거나 봇이 그 방에 없습니다. (chat not found)",
  401: "봇 토큰이 잘못됐거나 폐기되었습니다. TG_BOT_TOKEN 재확인",
  403: "봇이 차단되었거나 발언 권한이 없습니다.",
  429: "요청 과다. 잠시 후 재시도",
  NETWORK: "네트워크 오류",
};

export async function onRequestGet(context) {
  // 어떤 예외가 나도 Cloudflare 1101 대신 원인을 화면에 보여줍니다.
  try {
    return await handle(context);
  } catch (e) {
    return new Response(html(
      '<h1>진단 페이지 내부 오류</h1>' +
      '<div class="box bad"><b>아래 내용을 그대로 알려주세요.</b><pre style="white-space:pre-wrap;font-size:12px">' +
      esc((e && e.stack) || e) + '</pre></div>' +
      '<p><a class="btn" href="?key=' + KEY + '">← 다시 시도</a></p>'
    ), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
}

async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const doSend = url.searchParams.get("send") === "1";

  if (key !== KEY) {
    return new Response(html(`<h1>🔒 접속 키가 필요합니다</h1>
      <p>주소 끝에 <code>?key=${KEY}</code> 를 붙여서 다시 열어주세요.</p>
      <p class="dim">예: <code>${esc(url.origin)}/tgtest?key=${KEY}</code></p>`), {
      status: 200, headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ?chat=<id>  특정 chat_id 하나만 검증 (getUpdates 없이 getChat 사용)
  if (url.searchParams.get("chat")) {
    const token1 = env.TG_BOT_TOKEN || "";
    const target = (url.searchParams.get("chat") || "").trim();
    if (!token1) return new Response(html('<h1>TG_BOT_TOKEN 이 없습니다</h1>'), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const me1 = await tg(token1, "getMe");
    const c = await tg(token1, "getChat", { chat_id: target });
    const metaList = parseIds(env.TG_CHAT_ID_2);
    const registered = String(env.TG_CHAT_ID || "").trim() === target;
    const isMeta = metaList.includes(target);
    const mi = c.ok && me1.ok ? await tg(token1, "getChatMember", { chat_id: target, user_id: me1.result.id }) : null;
    const box = c.ok
      ? '<div class="box ok"><b>✅ 이 방은 존재하고, 봇이 접근 가능합니다</b>'
        + '<div style="margin-top:10px;font-size:15px">'
        + '<div>이름: <b>' + esc(c.result.title || c.result.first_name || "(개인)") + '</b></div>'
        + '<div>chat_id: <code>' + esc(String(c.result.id)) + '</code></div>'
        + '<div>유형: <b>' + esc(c.result.type) + '</b>'
        + (c.result.type === "group" ? ' <span class="dim">(일반 그룹)</span>' : c.result.type === "supergroup" ? ' <span class="dim">(슈퍼그룹)</span>' : "")
        + '</div>'
        + (mi && mi.ok ? '<div>봇 상태: <b>' + esc(mi.result.status) + '</b></div>' : "")
        + '<div style="margin-top:8px">설정 위치: <b>'
        + (registered ? "TG_CHAT_ID (1번 방, 매번 발송)" : isMeta ? "TG_CHAT_ID_2 (메타방, 랜덤 배분)" : "미등록 ⚠️")
        + '</b></div></div></div>'
      : '<div class="box bad"><b>❌ 이 방은 조회할 수 없습니다</b><br>'
        + esc(c.error_code) + ' ' + esc(c.description || "") + '<br>'
        + '<span class="dim">' + (c.error_code === 400 ? "chat_id 값이 틀렸거나, 봇이 그 방에 없습니다." : c.error_code === 403 ? "봇이 차단되었거나 권한이 없습니다." : "") + '</span></div>';
    return new Response(html('<h1>chat_id 단독 검증</h1><p class="dim">검증한 값: <code>' + esc(target) + '</code></p>'
      + box
      + '<p class="dim">이 검증은 <code>getChat</code> 을 사용하므로 <b>getUpdates 에 안 나오는 방도 확인할 수 있습니다.</b></p>'
      + '<p><a class="btn" href="?key=' + KEY + '">← 진단 페이지로</a></p>'),
      { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  if (url.searchParams.get("chats") === "1") {
    const token0 = env.TG_BOT_TOKEN || "";
    if (!token0) return new Response(html(`<h1>토큰이 없습니다</h1>`), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const g = await tg(token0, "getUpdates", { limit: 100, timeout: 0 });
    if (!g.ok) {
      return new Response(html(`<h1>방 목록을 가져오지 못했습니다</h1>
        <p>${esc(g.error_code)} ${esc(g.description || "")}</p>
        <p class="dim">웹훅(Webhook)이 설정된 봇이면 getUpdates 를 쓸 수 없습니다.
        <code>https://api.telegram.org/bot[토큰]/deleteWebhook</code> 을 한 번 열었다가 다시 시도하세요.</p>`),
        { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const map = new Map();
    for (const u of (g.result || [])) {
      const ch = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat) ||
                 (u.channel_post && u.channel_post.chat) || (u.edited_message && u.edited_message.chat);
      if (!ch) continue;
      map.set(String(ch.id), {
        id: String(ch.id), title: ch.title || `${ch.first_name || ""} ${ch.last_name || ""}`.trim() || "(개인)",
        type: ch.type,
      });
    }
    const list = [...map.values()];
    const rowsHtml = list.length
      ? list.map((c) => `<tr><td><code>${esc(c.id)}</code></td><td>${esc(c.title)}</td><td>${esc(c.type)}</td>
          <td>${esc(String(env.TG_CHAT_ID_2 || "").includes(c.id) ? "등록됨" : "미등록")}</td></tr>`).join("")
      : "";
    return new Response(html(`<h1>최근 대화한 방 목록</h1>
      <p class="dim">봇이 <b>최근 24시간 안에 메시지를 받은</b> 방만 나옵니다.
      발송만 하는 방(예: 1번 방)은 여기에 <b>안 나오는 것이 정상</b>입니다.
      그런 방은 <code>?key=${KEY}&amp;chat=&lt;chat_id&gt;</code> 로 확인하세요.</p>
      ${list.length ? `<table><thead><tr><th>chat_id</th><th>이름</th><th>유형</th><th>TG_CHAT_ID_2</th></tr></thead><tbody>${rowsHtml}</tbody></table>`
        : `<div class="box bad">받은 메시지가 없습니다. 각 방에서 <code>/start</code> 또는 아무 메시지나 보낸 뒤 새로고침하세요.</div>`}
      <p><a class="btn" href="?key=${KEY}">← 진단 페이지로</a></p>`),
      { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const token = env.TG_BOT_TOKEN || "";
  const room1 = env.TG_CHAT_ID || "";
  const metaRooms = parseIds(env.TG_CHAT_ID_2).filter((id) => id !== String(room1).trim());

  const rows = [];
  const issues = [];
  const add = (label, status, detail) => rows.push({ label, status, detail });

  // ── 1. 환경변수
  add("TG_BOT_TOKEN", token ? "ok" : "bad",
    token ? `${mask(token)} (길이 ${token.length})` : "값이 비어 있습니다");
  add("TG_CHAT_ID (1번방)", room1 ? "ok" : "bad", room1 || "값이 비어 있습니다");
  add("TG_CHAT_ID_2 (메타방)", metaRooms.length ? "ok" : "bad",
    metaRooms.length
      ? `${metaRooms.length}개 방 &nbsp;→&nbsp; ` + metaRooms.map((id, i) => `<code>${esc(id)}</code>`).join(" ")
      : "★ 값이 비어 있습니다 — 이게 없으면 메타 알림이 발송되지 않습니다");

  if (!metaRooms.length) {
    issues.push("TG_CHAT_ID_2 가 비어 있습니다. Cloudflare → Settings → Variables and Secrets → <b>Production</b> 에 방 ID들을 쉼표로 추가하고 <b>새 배포</b> 하세요.");
  } else {
    const expect = (100 / metaRooms.length).toFixed(1);
    add("배분 방식", "ok",
      `${metaRooms.length}개 방에 1건당 <b>한 곳</b>씩 배분 · 방별 기대 비중 <b>${expect}%</b> · 오차 0%`);
  }
  if (!token) issues.push("TG_BOT_TOKEN 이 비어 있습니다.");
  if (!env.DB) issues.push("D1 바인딩(DB)이 없습니다. (알림과는 무관하지만 접수 저장이 실패합니다)");
  if (!env.ADMIN_PASSWORD) issues.push("ADMIN_PASSWORD 가 없습니다. (알림과는 무관)");

  // ── 2. 토큰 확인
  let me = null;
  if (token) {
    const r = await tg(token, "getMe");
    if (r.ok) {
      me = r.result;
      add("봇 토큰 유효성", "ok", `@${me.username || "-"} (${me.first_name || ""}, id ${me.id})`);
    } else {
      add("봇 토큰 유효성", "bad", `${r.error_code} ${r.description || ""} — ${HINT[r.error_code] || ""}`);
      issues.push(`토큰이 유효하지 않습니다 (${r.error_code}). TG_BOT_TOKEN 을 다시 넣고 새 배포하세요.`);
    }
  }

  // ── 3. 방 정보 + 봇 권한
  const allRooms = [["1번방", room1], ...metaRooms.map((id, i) => [`메타방 ${i + 1}`, id])];

  if (me) {
    for (const [label, chatId] of allRooms) {
      if (!chatId) { add(`${label} 확인`, "warn", "설정 안 됨 → 건너뜀"); continue; }
      const c = await tg(token, "getChat", { chat_id: chatId });
      if (!c.ok) {
        add(`${label} 확인`, "bad", `${chatId} → ${c.error_code} ${c.description || ""} — ${HINT[c.error_code] || ""}`);
        issues.push(`${label}(${chatId}) 조회 실패: ${c.error_code} ${c.description || ""}`);
        continue;
      }
      const m = await tg(token, "getChatMember", { chat_id: chatId, user_id: me.id });
      const st = m.ok ? m.result.status : "알수없음";
      const canSpeak = st === "administrator" || st === "member" || st === "creator";
      add(`${label} 확인`, canSpeak ? "ok" : "bad",
        `${chatId} · ${c.result.title || c.result.first_name || "(개인)"} · ${c.result.type} · 봇 상태: <b>${st}</b>`);
      if (!canSpeak) issues.push(`${label}에서 봇 상태가 "${st}" 입니다. 봇을 다시 초대하거나 차단을 해제하세요.`);
    }
  }

  // ── 4. 실제 발송 (선택)
  if (doSend && me) {
    const text = "🧪 알림 연결 테스트입니다. (무시하세요)\n" +
      new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) + " (KST)";
    for (const [label, chatId] of allRooms) {
      if (!chatId) continue;
      const s = await tg(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
      if (s.ok) add(`${label} 실제 발송`, "ok", `성공 (message_id ${s.result.message_id})`);
      else {
        add(`${label} 실제 발송`, "bad", `${s.error_code} ${s.description || ""} — ${HINT[s.error_code] || ""}`);
        issues.push(`${label} 발송 실패: ${s.error_code} ${s.description || ""}`);
      }
    }
  }

  return new Response(html(render(rows, issues, doSend, url)), {
    status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function render(rows, issues, doSend, url) {
  const icon = { ok: "✅", bad: "❌", warn: "⚠️" };
  const tr = rows.map(r => `<tr><td>${esc(r.label)}</td><td>${icon[r.status] || ""}</td><td>${r.detail}</td></tr>`).join("");
  const issueHtml = issues.length
    ? `<div class="box bad"><b>진단 결과 — 문제 ${issues.length}건</b><ol>${issues.map(i => `<li>${i}</li>`).join("")}</ol></div>`
    : `<div class="box ok"><b>이상 없음</b><br>모든 설정이 정상입니다.</div>`;
  const sendBtn = doSend
    ? ""
    : `<p><a class="btn" href="?key=${KEY}&send=1">모든 방에 실제 테스트 발송하기</a>
       <span class="dim">(각 방에 테스트 메시지 1건이 도착합니다)</span></p>`;
  return `
    <h1>텔레그램 알림 진단</h1>
    <p class="dim">진단시각 ${new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19)} (KST)</p>
    ${issueHtml}
    <table><thead><tr><th>항목</th><th></th><th>결과</th></tr></thead><tbody>${tr}</tbody></table>
    ${sendBtn}
    <p><a class="btn" style="background:#333" href="?key=${KEY}&chats=1">최근 대화한 방 목록 보기 (chat_id 복사용)</a></p>
    <p class="dim">진단이 끝나면 <code>functions/tgtest.js</code> 를 삭제하고 재배포하세요.</p>`;
}

function html(body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>텔레그램 알림 진단</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif;
max-width:900px;margin:0 auto;padding:24px;line-height:1.65;color:#111;background:#fafafa}
h1{font-size:22px;margin:0 0 6px}
.dim{color:#777;font-size:13px}
table{width:100%;border-collapse:collapse;background:#fff;margin:16px 0;font-size:14px}
th,td{border:1px solid #e3e3e3;padding:10px 12px;text-align:left;vertical-align:top}
th{background:#f0f0f0;font-weight:600}
td:nth-child(2){width:40px;text-align:center;font-size:16px}
code{background:#eee;padding:2px 6px;border-radius:4px;font-size:13px}
.box{padding:14px 18px;border-radius:10px;margin:16px 0;font-size:14px}
.box.ok{background:#eaf7ee;border:1px solid #b7e0c3}
.box.bad{background:#fdecec;border:1px solid #f0b8b8}
.box ol{margin:8px 0 0;padding-left:20px}
.box li{margin:4px 0}
.btn{display:inline-block;background:#0a1e46;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px}
</style></head><body>${body}</body></html>`;
}
