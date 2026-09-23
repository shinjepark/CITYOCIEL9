// GET /count  →  현재 예약자 수 (기본 84명에서 시작, 등록마다 +1)
const BASE = 84;
function json(o){return new Response(JSON.stringify(o),{headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Cache-Control":"no-store"}});}
export async function onRequestGet(context){
  const { env } = context;
  try{
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS stats (k TEXT PRIMARY KEY, v INTEGER NOT NULL)").run();
    await env.DB.prepare("INSERT INTO stats (k,v) VALUES ('reservations', ?) ON CONFLICT(k) DO NOTHING").bind(BASE).run();
    const row = await env.DB.prepare("SELECT v FROM stats WHERE k = 'reservations'").first();
    return json({ ok:true, count:(row && row.v) || BASE });
  }catch(err){ return json({ ok:false, count:BASE, error:String(err) }); }
}
