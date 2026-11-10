// GET /tgtest?key=<ADMIN_PASSWORD>
//
// 2번 방에 알림이 오지 않을 때 원인을 30초 안에 특정하는 진단용 엔드포인트.
// 배포 후 아래 주소를 브라우저로 열면 결과가 JSON 으로 보입니다.
//   https://<도메인>/tgtest?key=<ADMIN_PASSWORD>
// 진단이 끝나면 이 파일(functions/tgtest.js)은 삭제하고 재배포하세요.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const mask = (v) => {
  const s = String(v == null ? "" : v);
  if (!s) return "(없음)";
  return s.length <= 8 ? s : s.slice(0, 6) + "…" + s.slice(-3);
};

async function tg(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  let body;
  try { body = await res.json(); } catch { body = { parse_error: true }; }
  return { http: res.status, ok: body.ok === true, error_code: body.error_code || null,
           description: body.description || null, result: body.result || null };
}

const HINT = {
  400: "chat_id 형식/값이 틀렸거나, 봇이 그 방에 없습니다. (chat not found)",
  401: "봇 토큰이 잘못됐거나 폐기되었습니다. TG_BOT_TOKEN 재확인",
  403: "봇이 방에서 차단되었거나 발언 권한이 없습니다. (bot was blocked / not enough rights)",
  404: "메서드/토큰 형식 오류",
  429: "요청이 너무 많습니다. 잠시 후 재시도",
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const pwd = env.ADMIN_PASSWORD || "";

  if (!pwd) return json({ ok: false, error: "ADMIN_PASSWORD 환경변수가 없어 진단을 막았습니다." }, 403);
  if (key !== pwd) return json({ ok: false, error: "key 가 올바르지 않습니다. ?key=<ADMIN_PASSWORD>" }, 403);

  const token = env.TG_BOT_TOKEN || "";
  const room1 = env.TG_CHAT_ID  || "";
  const room2 = env.TG_CHAT_ID_2 || "";

  const out = {
    ok: true,
    진단시각: new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) + " (KST)",
    "1_환경변수": {
      TG_BOT_TOKEN: mask(token) + ` (길이 ${String(token).length})`,
      TG_CHAT_ID: room1 ? JSON.stringify(room1) : "(없음)",
      "TG_CHAT_ID_2": room2 ? JSON.stringify(room2) : "(없음)  ← 이게 없으면 2번방은 영원히 안 옵니다",
    },
    "2_토큰확인_getMe": null,
    "3_방정보_getChat": {},
    "4_실제발송테스트": {},
    "5_결론": [],
  };

  if (!token) {
    out["5_결론"].push("TG_BOT_TOKEN 이 비어 있습니다.");
    return json(out);
  }
  if (!room2) {
    out["5_결론"].push("TG_CHAT_ID_2 가 비어 있습니다. Cloudflare Variables and Secrets 에 추가 후 [재배포] 하세요.");
  }

  // ② 토큰 확인
  const me = await tg(token, "getMe");
  out["2_토큰확인_getMe"] = me.ok
    ? { 봇이름: me.result.first_name, username: "@" + (me.result.username || ""), bot_id: me.result.id }
    : { 실패: true, http: me.http, error_code: me.error_code, description: me.description, 힌트: HINT[me.error_code] || "" };

  if (!me.ok) {
    out["5_결론"].push("토큰이 유효하지 않습니다. TG_BOT_TOKEN 을 다시 넣고 재배포하세요.");
    return json(out);
  }

  // ③ 방 정보 + 봇 권한
  for (const [label, chatId] of [["1번방", room1], ["2번방", room2]]) {
    if (!chatId) { out["3_방정보_getChat"][label] = "(설정 안 됨)"; continue; }
    const chat = await tg(token, "getChat", { chat_id: chatId });
    if (!chat.ok) {
      out["3_방정보_getChat"][label] = { chat_id: chatId, 실패: true, error_code: chat.error_code,
        description: chat.description, 힌트: HINT[chat.error_code] || "" };
      continue;
    }
    const member = await tg(token, "getChatMember", { chat_id: chatId, user_id: me.result.id });
    const st = member.ok ? member.result.status : "unknown";
    out["3_방정보_getChat"][label] = {
      chat_id: chatId,
      제목: chat.result.title || (chat.result.first_name || "") + " (개인)",
      유형: chat.result.type,
      봇상태: st,
      발언가능: st === "administrator" ? "예(관리자)" : st === "member" ? "예(일반 구성원)" : "아니오 ← 문제",
    };
  }

  // ④ 실제 발송 테스트 (양쪽 방에 1건씩)
  const testText = "🧪 알림 연결 테스트입니다. (무시하세요)\n발송시각: " +
    new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) + " (KST)";

  for (const [label, chatId] of [["1번방", room1], ["2번방", room2]]) {
    if (!chatId) { out["4_실제발송테스트"][label] = "(설정 안 됨)"; continue; }
    const r = await tg(token, "sendMessage", { chat_id: chatId, text: testText });
    out["4_실제발송테스트"][label] = r.ok
      ? { 성공: true, message_id: r.result.message_id }
      : { 성공: false, http: r.http, error_code: r.error_code, description: r.description, 힌트: HINT[r.error_code] || "" };
  }

  // ⑤ 결론
  const r1 = out["4_실제발송테스트"]["1번방"];
  const r2 = out["4_실제발송테스트"]["2번방"];
  if (r1 && r1.성공 && r2 && r2.성공) {
    out["5_결론"].push("두 방 모두 발송 성공. → 봇/방ID/토큰은 정상입니다.");
    out["5_결론"].push("그런데 실제 접수 알림이 2번방에 안 온다면, 배포된 submit.js 가 예전 버전이거나 재배포가 안 된 것입니다.");
    out["5_결론"].push("→ 그럴 때는 예전 버전이 실행 중입니다. functions/submit.js 교체 후 [새 배포] 하세요.");
  } else {
    if (r2 && !r2.성공) out["5_결론"].push(`2번방 발송 실패: ${r2.error_code} ${r2.description}`);
    if (r1 && !r1.성공) out["5_결론"].push(`1번방 발송 실패: ${r1.error_code} ${r1.description}`);
  }

  return json(out);
}
