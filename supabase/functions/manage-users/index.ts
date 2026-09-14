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
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    return String(e.message || e.error_description || e.error || "Erreur serveur.");
  }
  return String(error || "Erreur serveur.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) {
      return json({ error: "Configuration Supabase Edge Function incomplète: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Non autorisé." }, 401);

    const adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: `Session invalide: ${userErr?.message || "utilisateur introuvable"}` }, 401);

    const { data: callerProfile, error: callerErr } = await adminClient
      .from("profiles").select("role, site_id, full_name, email").eq("id", user.id).maybeSingle();
    if (callerErr) return json({ error: `Lecture du profil propriétaire impossible: ${callerErr.message}` }, 500);
    if (!callerProfile || !["owner", "admin"].includes(callerProfile.role)) {
      return json({ error: "Accès refusé : droits administrateur requis." }, 403);
    }
    if (!callerProfile.site_id) return json({ error: "Votre compte n'a aucun site_id associé." }, 400);

    const siteId = callerProfile.site_id as string;

    if (req.method === "GET") {
      const { data, error } = await adminClient.from("profiles")
        .select("id, email, full_name, role, site_id, created_at")
        .eq("site_id", siteId).order("created_at", { ascending: false });
      if (error) return json({ error: `Impossible de charger les utilisateurs: ${error.message}` }, 500);
      return json(data ?? []);
    }

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try { body = await req.json(); } catch { return json({ error: "JSON de requête invalide." }, 400); }

      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const fullName = String(body.full_name ?? "").trim();
      const role = String(body.role ?? "").trim() as Role;
      const menuKeys = Array.isArray(body.menu_keys) ? body.menu_keys.map(String).filter(Boolean) : [];

      if (!email || !password || !fullName || !role) return json({ error: "Tous les champs sont requis." }, 400);
      if (!ALLOWED_ROLES.includes(role)) return json({ error: "Rôle non autorisé. Le rôle propriétaire ne peut pas être attribué depuis cet écran." }, 400);
      if (password.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);

      const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { site_id: siteId, role },
      });
      if (authErr || !authData.user) return json({ error: `Création Auth impossible: ${authErr?.message || "utilisateur non retourné"}` }, 500);

      const newUserId = authData.user.id;
      try {
        // The trigger creates the initial profile; this authoritative upsert fixes role/site/name/email.
        const { error: profileErr } = await adminClient.from("profiles").upsert({
          id: newUserId, email, full_name: fullName, role, site_id: siteId,
        }, { onConflict: "id" });
        if (profileErr) throw new Error(`Profil utilisateur impossible à enregistrer: ${profileErr.message}`);

        // Direct service-role write avoids relying on auth.uid() inside an RPC executed by the Edge Function.
        await adminClient.from("user_menu_permissions").delete().eq("user_id", newUserId).eq("site_id", siteId);
        if (menuKeys.length) {
          const rows = menuKeys.map(menu_key => ({ site_id: siteId, user_id: newUserId, menu_key, can_view: true }));
          const { error: menuErr } = await adminClient.from("user_menu_permissions").upsert(rows, { onConflict: "site_id,user_id,menu_key" });
          if (menuErr) throw new Error(`Permissions de menus impossibles à enregistrer: ${menuErr.message}`);
        }

        // Best-effort explicit audit. Database triggers also cover subsequent operations.
        await adminClient.from("audit_logs").insert({
          actor_id: user.id, site_id: siteId, action: "CREATE", entity_type: "profiles", entity_id: newUserId,
          details: { email, full_name: fullName, role },
        });

        return json({ id: newUserId, email, full_name: fullName, role, site_id: siteId }, 201);
      } catch (postCreateErr) {
        // Prevent the classic "first click failed, second click says already exists" state.
        await adminClient.auth.admin.deleteUser(newUserId).catch(() => undefined);
        return json({ error: errorMessage(postCreateErr) }, 500);
      }
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      const targetId = String(body.id ?? "");
      const newPassword = String(body.password ?? "");
      if (!targetId || !newPassword) return json({ error: "ID utilisateur et nouveau mot de passe requis." }, 400);
      if (newPassword.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      const { data: target, error: targetErr } = await adminClient.from("profiles").select("site_id, role").eq("id", targetId).maybeSingle();
      if (targetErr) return json({ error: targetErr.message }, 500);
      if (!target || target.site_id !== siteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner" && callerProfile.role !== "owner") return json({ error: "Seul un propriétaire peut modifier le mot de passe d'un propriétaire." }, 403);
      const { error } = await adminClient.auth.admin.updateUserById(targetId, { password: newPassword });
      if (error) return json({ error: `Modification du mot de passe impossible: ${error.message}` }, 500);
      return json({ success: true });
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const targetId = String(body.id ?? "");
      const newRole = String(body.role ?? "") as Role;
      if (!targetId || !newRole) return json({ error: "ID utilisateur et rôle requis." }, 400);
      if (!ALLOWED_ROLES.includes(newRole)) return json({ error: "Rôle non autorisé." }, 400);
      const { data: target, error: targetErr } = await adminClient.from("profiles").select("site_id, role").eq("id", targetId).maybeSingle();
      if (targetErr) return json({ error: targetErr.message }, 500);
      if (!target || target.site_id !== siteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner") return json({ error: "Impossible de modifier le rôle d'un propriétaire." }, 403);
      const { error } = await adminClient.from("profiles").update({ role: newRole, updated_at: new Date().toISOString() }).eq("id", targetId);
      if (error) return json({ error: `Modification du rôle impossible: ${error.message}` }, 500);
      await adminClient.auth.admin.updateUserById(targetId, { app_metadata: { site_id: siteId, role: newRole } }).catch(() => undefined);
      return json({ success: true });
    }

    if (req.method === "DELETE") {
      const userId = new URL(req.url).searchParams.get("id");
      if (!userId) return json({ error: "ID utilisateur requis." }, 400);
      if (userId === user.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      const { data: target, error: targetErr } = await adminClient.from("profiles").select("site_id, role").eq("id", userId).maybeSingle();
      if (targetErr) return json({ error: targetErr.message }, 500);
      if (!target || target.site_id !== siteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner" && callerProfile.role !== "owner") return json({ error: "Seul le propriétaire peut supprimer un propriétaire." }, 403);
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) return json({ error: `Suppression impossible: ${error.message}` }, 500);
      return json({ success: true });
    }

    return json({ error: "Méthode non supportée." }, 405);
  } catch (err) {
    return json({ error: `manage-users: ${errorMessage(err)}` }, 500);
  }
});
