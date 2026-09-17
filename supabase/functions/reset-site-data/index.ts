import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const corsHeaders = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"POST, OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization, Apikey, X-Client-Info" };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS') return new Response(null,{status:200,headers:corsHeaders});
 try{
  const url=Deno.env.get('SUPABASE_URL'), service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), anon=Deno.env.get('SUPABASE_ANON_KEY');
  if(!url||!service||!anon) return json({error:'Configuration Supabase manquante.'},500);
  const auth=req.headers.get('Authorization'); if(!auth) return json({error:'Non autorisé.'},401);
  const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await userClient.auth.getUser(); if(!user) return json({error:'Session invalide.'},401);
  const {data:profile,error:pe}=await admin.from('profiles').select('role,site_id').eq('id',user.id).maybeSingle(); if(pe) throw pe;
  if(!profile||profile.role!=='owner') return json({error:'Seul le propriétaire peut réinitialiser les données.'},403);
  const body=await req.json().catch(()=>({})); if(body.confirmation!=='RESET') return json({error:'Confirmation invalide.'},400);
  const site=profile.site_id; if(!site) return json({error:'Site introuvable.'},409);
  const tables=['offline_operations','audit_logs','loyalty_transactions','payments','order_items','orders','stock_movements','expenses','cash_movements','cash_registers','appointments','complaints','notifications','subscriptions','vehicles','customers','products','services','employees'];
  for(const table of tables){const {error}=await admin.from(table).delete().eq('site_id',site); if(error) throw new Error(`${table}: ${error.message}`);}
  return json({ok:true});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500)}
});
