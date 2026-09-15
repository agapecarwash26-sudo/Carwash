import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_ROLES = ["admin", "manager", "cashier", "operator", "stock_manager"] as const;
const ALLOWED_MENU_KEYS = new Set([
  "dashboard", "orders", "queue", "customers", "services", "cash", "inventory", "expenses",
  "employees", "subscriptions", "appointments", "complaints", "notifications", "reports", "audit",
  "users", "settings",
]);

type Role = typeof ALLOWED_ROLES[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanEmail(value: unknown) { return String(value ?? "").trim().toLowerCase(); }
function cleanText(value: unknown) { return String(value ?? "").trim(); }
function isAllowedRole(value: unknown): value is Role { return typeof value === "string" && (ALLOWED_ROLES as readonly string[]).includes(value); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) return json({ error: "Configuration Supabase serveur incomplète." }, 500);

    const admin = createClient(url, serviceKey);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non autorisé." }, 401);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Session invalide." }, 401);

    const { data: callerProfile, error: callerErr } = await admin
      .from("profiles").select("id, role, site_id").eq("id", user.id).maybeSingle();
    if (callerErr) return json({ error: `Impossible de vérifier votre profil: ${callerErr.message}` }, 500);
    if (!callerProfile || !["owner", "admin"].includes(callerProfile.role) || !callerProfile.site_id) {
      return json({ error: "Accès refusé : droits administrateur et site actif requis." }, 403);
    }

    const callerSiteId = callerProfile.site_id as string;
    const isOwner = callerProfile.role === "owner";

    if (req.method === "GET") {
      const { data, error } = await admin.from("profiles")
        .select("id, email, full_name, address, role, site_id, created_at")
        .eq("site_id", callerSiteId).order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json(data ?? []);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (!body) return json({ error: "Corps de requête JSON invalide." }, 400);
      const email = cleanEmail(body.email);
      const password = String(body.password ?? "");
      const fullName = cleanText(body.full_name);
      const address = cleanText(body.address);
      const role = body.role;
      const menuPermissions = Array.isArray(body.menu_permissions) ? body.menu_permissions : [];

      if (!email || !password || !fullName || !isAllowedRole(role)) return json({ error: "Nom, e-mail, mot de passe et rôle valide sont requis." }, 400);
      if (password.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);

      const menus = menuPermissions
        .map((x) => typeof x === "string" ? x : (x && typeof x === "object" ? String((x as Record<string, unknown>).menu_key ?? "") : ""))
        .filter((x): x is string => ALLOWED_MENU_KEYS.has(x));

      // The tenant and role are server-owned. Never accept site_id from the browser.
      const { data: authData, error: authErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, address },
        app_metadata: { site_id: callerSiteId, role },
      });
      if (authErr) {
        const msg = /already|registered|exists/i.test(authErr.message)
          ? "Cette adresse e-mail est déjà utilisée. Aucun nouvel utilisateur n'a été créé."
          : authErr.message;
        return json({ error: msg, code: "AUTH_CREATE_FAILED" }, 409);
      }

      const newUserId = authData.user.id;
      try {
        // Trigger creates the profile. Verify exact tenant/role before continuing.
        const { data: profile, error: profileErr } = await admin.from("profiles")
          .select("id, email, full_name, address, role, site_id")
          .eq("id", newUserId).maybeSingle();
        if (profileErr) throw new Error(`PROFILE_READ_FAILED: ${profileErr.message}`);
        if (!profile) throw new Error("PROFILE_CREATE_FAILED: Le profil n'a pas été créé.");
        if (profile.site_id !== callerSiteId) throw new Error("TENANT_INTEGRITY_FAILED: Le profil a reçu un site_id différent du site du créateur.");
        if (profile.role !== role) throw new Error(`ROLE_INTEGRITY_FAILED: rôle obtenu=${profile.role}, rôle demandé=${role}.`);

        // Explicitly normalize identity fields after the trigger, without touching role/site_id.
        const { error: profileUpdateErr } = await admin.from("profiles").update({
          email, full_name: fullName, address, updated_at: new Date().toISOString(),
        }).eq("id", newUserId).eq("site_id", callerSiteId);
        if (profileUpdateErr) throw new Error(`PROFILE_UPDATE_FAILED: ${profileUpdateErr.message}`);

        if (menus.length) {
          const rows = menus.map(menu_key => ({ site_id: callerSiteId, user_id: newUserId, menu_key, can_view: true }));
          const { error: menuErr } = await admin.from("user_menu_permissions").upsert(rows, { onConflict: "site_id,user_id,menu_key" });
          if (menuErr) throw new Error(`MENU_PERMISSIONS_FAILED: ${menuErr.message}`);
        }

        const { error: auditErr } = await admin.from("audit_logs").insert({
          site_id: callerSiteId, actor_id: user.id, action: "CREATE_USER", entity_type: "user", entity_id: newUserId,
          details: { email, full_name: fullName, address, role, site_id: callerSiteId, menu_permissions: menus },
        });
        if (auditErr) throw new Error(`AUDIT_LOG_FAILED: ${auditErr.message}`);

        return json({ id: newUserId, email, full_name: fullName, address, role, site_id: callerSiteId }, 201);
      } catch (postCreateErr) {
        // Compensating rollback: avoid leaving auth.users without a coherent profile/permissions.
        await admin.auth.admin.deleteUser(newUserId);
        const msg = postCreateErr instanceof Error ? postCreateErr.message : "Finalisation de création impossible.";
        return json({ error: `${msg} Le compte créé pendant cette tentative a été annulé.`, code: "USER_CREATION_ROLLED_BACK" }, 500);
      }
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const targetId = cleanText(body.id); const newRole = body.role;
      if (!targetId || !isAllowedRole(newRole)) return json({ error: "ID utilisateur et rôle valide requis." }, 400);
      const { data: target, error: targetErr } = await admin.from("profiles").select("id, site_id, role").eq("id", targetId).maybeSingle();
      if (targetErr) return json({ error: targetErr.message }, 500);
      if (!target || target.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner") return json({ error: "Impossible de modifier le rôle d'un propriétaire." }, 403);
      const { data: targetAuth, error: authGetErr } = await admin.auth.admin.getUserById(targetId);
      if (authGetErr || !targetAuth.user) return json({ error: "Compte Auth introuvable." }, 404);
      const appMeta = { ...(targetAuth.user.app_metadata ?? {}), site_id: callerSiteId, role: newRole };
      const { error: authUpdateErr } = await admin.auth.admin.updateUserById(targetId, { app_metadata: appMeta });
      if (authUpdateErr) return json({ error: authUpdateErr.message }, 500);
      const { error } = await admin.from("profiles").update({ role: newRole, updated_at: new Date().toISOString() }).eq("id", targetId).eq("site_id", callerSiteId);
      if (error) return json({ error: error.message }, 500);
      await admin.from("audit_logs").insert({ site_id: callerSiteId, actor_id: user.id, action: "UPDATE_USER_ROLE", entity_type: "user", entity_id: targetId, details: { role: newRole, site_id: callerSiteId } });
      return json({ success: true });
    }

    if (req.method === "PATCH") {
      const body = await req.json(); const targetId = cleanText(body.id); const password = String(body.password ?? "");
      if (!targetId || password.length < 6) return json({ error: "ID utilisateur et mot de passe (6 caractères minimum) requis." }, 400);
      const { data: target, error: targetErr } = await admin.from("profiles").select("site_id, role").eq("id", targetId).maybeSingle();
      if (targetErr) return json({ error: targetErr.message }, 500);
      if (!target || target.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner" && !isOwner) return json({ error: "Seul le propriétaire peut modifier le mot de passe d'un autre propriétaire." }, 403);
      const { error } = await admin.auth.admin.updateUserById(targetId, { password });
      if (error) return json({ error: error.message }, 500);
      await admin.from("audit_logs").insert({ site_id: callerSiteId, actor_id: user.id, action: "UPDATE_USER_PASSWORD", entity_type: "user", entity_id: targetId, details: { site_id: callerSiteId } });
      return json({ success: true });
    }

    if (req.method === "DELETE") {
      const targetId = new URL(req.url).searchParams.get("id");
      if (!targetId) return json({ error: "ID utilisateur requis." }, 400);
      if (targetId === user.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      const { data: target, error: targetErr } = await admin.from("profiles").select("site_id, role").eq("id", targetId).maybeSingle();
      if (targetErr) return json({ error: targetErr.message }, 500);
      if (!target || target.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (target.role === "owner" && !isOwner) return json({ error: "Seul le propriétaire peut supprimer un propriétaire." }, 403);
      const { error } = await admin.auth.admin.deleteUser(targetId);
      if (error) return json({ error: error.message }, 500);
      await admin.from("audit_logs").insert({ site_id: callerSiteId, actor_id: user.id, action: "DELETE_USER", entity_type: "user", entity_id: targetId, details: { site_id: callerSiteId, role: target.role } });
      return json({ success: true });
    }

    return json({ error: "Méthode non supportée." }, 405);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur serveur.";
    return json({ error: message }, 500);
  }
});
