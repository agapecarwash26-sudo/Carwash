import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_ROLES = ["admin", "manager", "cashier", "operator", "stock_manager"] as const;

type Role = typeof ALLOWED_ROLES[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Erreur serveur inconnue."; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) return json({ error: "Configuration Supabase manquante dans l'Edge Function." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Session invalide : token Authorization absent." }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authUser, error: authGetError } = await callerClient.auth.getUser();
    if (authGetError || !authUser.user) return json({ error: `Session invalide: ${authGetError?.message ?? "utilisateur introuvable"}` }, 401);

    const callerId = authUser.user.id;
    const { data: caller, error: callerError } = await admin
      .from("profiles").select("id,role,site_id").eq("id", callerId).maybeSingle();
    if (callerError) return json({ error: `Lecture du profil propriétaire impossible: ${callerError.message}` }, 500);
    if (!caller || !["owner", "admin"].includes(caller.role)) return json({ error: "Accès refusé : droits administrateur requis." }, 403);
    if (!caller.site_id) return json({ error: "Votre compte n'est rattaché à aucun site." }, 400);

    if (req.method === "GET") {
      const { data, error } = await admin.from("profiles")
        .select("id,email,full_name,role,created_at")
        .eq("site_id", caller.site_id).order("created_at", { ascending: false });
      if (error) return json({ error: `Lecture des utilisateurs impossible: ${error.message}` }, 500);
      return json(data ?? []);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ error: "Corps JSON invalide." }, 400);
      const email = String((body as any).email ?? "").trim().toLowerCase();
      const password = String((body as any).password ?? "");
      const fullName = String((body as any).full_name ?? "").trim();
      const role = String((body as any).role ?? "").trim() as Role;
      if (!email || !password || !fullName || !role) return json({ error: "Tous les champs sont requis." }, 400);
      if (!ALLOWED_ROLES.includes(role)) return json({ error: "Rôle non autorisé." }, 400);
      if (password.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);

      // The database trigger is deliberately minimal. app_metadata explicitly carries
      // the caller's site and the selected role, then we verify/repair the profile below.
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { site_id: caller.site_id, role },
      });
      if (createError || !created.user) return json({ error: `Création Auth impossible: ${createError?.message ?? "utilisateur non retourné"}` }, 500);

      const newId = created.user.id;
      const { data: profile, error: profileError } = await admin.from("profiles").upsert({
        id: newId, email, full_name: fullName, role, site_id: caller.site_id,
      }, { onConflict: "id" }).select("id,email,full_name,role,site_id,created_at").single();

      if (profileError || !profile) {
        await admin.auth.admin.deleteUser(newId).catch(() => undefined);
        return json({ error: `Profil utilisateur impossible à enregistrer: ${profileError?.message ?? "profil non retourné"}` }, 500);
      }

      // Audit explicitly because auth.admin.createUser runs outside the caller's JWT context.
      // Audit failure must never turn a successful user creation into an HTTP 500.
      await admin.from("audit_logs").insert({
        site_id: caller.site_id, actor_id: callerId, action: "CREATE", entity_type: "profiles",
        entity_id: newId, details: { email, full_name: fullName, role, source: "manage-users" },
      }).then(() => undefined).catch(() => undefined);

      return json({ id: newId, email, full_name: fullName, role, site_id: caller.site_id }, 201);
    }

    if (req.method === "PATCH") {
      const body = await req.json().catch(() => null);
      const targetId = String(body?.id ?? "");
      const newPassword = String(body?.password ?? "");
      if (!targetId || !newPassword) return json({ error: "ID utilisateur et nouveau mot de passe requis." }, 400);
      if (newPassword.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      const { data: target } = await admin.from("profiles").select("site_id,role").eq("id", targetId).maybeSingle();
      if (!target || target.site_id !== caller.site_id) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner" && caller.role !== "owner") return json({ error: "Seul le propriétaire peut modifier le mot de passe d'un propriétaire." }, 403);
      const { error } = await admin.auth.admin.updateUserById(targetId, { password: newPassword });
      if (error) return json({ error: `Modification du mot de passe impossible: ${error.message}` }, 500);
      return json({ success: true });
    }

    if (req.method === "PUT") {
      const body = await req.json().catch(() => null);
      const targetId = String(body?.id ?? "");
      const newRole = String(body?.role ?? "") as Role;
      if (!targetId || !newRole) return json({ error: "ID utilisateur et rôle requis." }, 400);
      if (!ALLOWED_ROLES.includes(newRole)) return json({ error: "Rôle non autorisé." }, 400);
      const { data: target } = await admin.from("profiles").select("site_id,role").eq("id", targetId).maybeSingle();
      if (!target || target.site_id !== caller.site_id) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner") return json({ error: "Impossible de modifier le rôle d'un propriétaire." }, 403);
      const { error } = await admin.from("profiles").update({ role: newRole, updated_at: new Date().toISOString() }).eq("id", targetId).eq("site_id", caller.site_id);
      if (error) return json({ error: `Modification du rôle impossible: ${error.message}` }, 500);
      return json({ success: true });
    }

    if (req.method === "DELETE") {
      const targetId = new URL(req.url).searchParams.get("id") ?? "";
      if (!targetId) return json({ error: "ID utilisateur requis." }, 400);
      if (targetId === callerId) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      const { data: target } = await admin.from("profiles").select("site_id,role").eq("id", targetId).maybeSingle();
      if (!target || target.site_id !== caller.site_id) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner" && caller.role !== "owner") return json({ error: "Seul le propriétaire peut supprimer un autre propriétaire." }, 403);
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) return json({ error: `Suppression impossible: ${error.message}` }, 500);
      return json({ success: true });
    }

    return json({ error: "Méthode non supportée." }, 405);
  } catch (err) {
    return json({ error: `manage-users: ${errorMessage(err)}` }, 500);
  }
});
