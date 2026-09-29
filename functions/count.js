// GET /count  →  현재 예약자 수 (기본 84명에서 시작, 등록마다 +1)
// 엣지 캐시 30초 + 브라우저 캐시 30초 → 방문마다 D1 조회하지 않음.
// 신청 직후 카운트는 /submit 응답값으로 즉시 반영되므로 30초 지연은 체감 없음.
const BASE = 84;
const CC = "public, max-age=30";
function json(o, cc){
  return new Response(JSON.stringify(o),{
    headers:{
      "Content-Type":"application/json",
      "Access-Control-Allow-Origin":"*",
      "Cache-Control": cc || "no-store"
    }
  });
}
export async function onRequestGet(context){
  /* 엣지(콜드 로컬) 캐시 히트 시 D1 조회 없이 즉시 반환 */
  try{
    const hit = await caches.default.match(context.request);
    if(hit) return hit;
  }catch(e){}
  const { env } = context;
  try{
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS stats (k TEXT PRIMARY KEY, v INTEGER NOT NULL)").run();
    await env.DB.prepare("INSERT INTO stats (k,v) VALUES ('reservations', ?) ON CONFLICT(k) DO NOTHING").bind(BASE).run();
    const row = await env.DB.prepare("SELECT v FROM stats WHERE k = 'reservations'").first();
    const res = json({ ok:true, count:(row && row.v) || BASE }, CC);
    try{ context.waitUntil(caches.default.put(context.request, res.clone())); }catch(e){}
    return res;
  }catch(err){ return json({ ok:false, count:BASE, error:String(err) }); }
}
