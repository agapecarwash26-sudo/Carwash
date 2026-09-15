import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_ROLES = ["admin", "manager", "cashier", "operator", "stock_manager"] as const;
const ALLOWED_MENU_KEYS = new Set([
  "dashboard", "orders", "queue", "customers", "services", "cash", "inventory", "expenses",
  "employees", "subscriptions", "appointments", "complaints", "notifications", "reports", "audit",
  "users", "settings",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json({ error: "Configuration Supabase serveur incomplète." }, 500);
    }

    // Service-role client: used only inside this trusted Edge Function.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non autorisé." }, 401);

    // User-scoped client: the caller is authenticated with their own JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Session invalide." }, 401);

    const { data: callerProfile, error: callerProfileErr } = await adminClient
      .from("profiles")
      .select("role, site_id")
      .eq("id", user.id)
      .maybeSingle();

    if (callerProfileErr) throw callerProfileErr;
    if (!callerProfile || !["owner", "admin"].includes(callerProfile.role)) {
      return json({ error: "Accès refusé : droits administrateur requis." }, 403);
    }

    const callerSiteId = callerProfile.site_id;
    if (!callerSiteId) {
      return json({ error: "Votre compte n'est associé à aucun site actif." }, 409);
    }

    const isOwner = callerProfile.role === "owner";
    const method = req.method;

    // GET /manage-users — list users of the caller's site only.
    if (method === "GET") {
      const { data, error } = await adminClient
        .from("profiles")
        .select("id, email, full_name, role, created_at")
        .eq("site_id", callerSiteId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return json(data);
    }

    // POST /manage-users — create a staff account in the caller's existing site.
    // The server owns both tenant and role. The client can never choose another site.
    if (method === "POST") {
      const body = await req.json();
      const email = normalizeEmail(body.email);
      const password = String(body.password ?? "");
      const full_name = String(body.full_name ?? "").trim();
      const role = String(body.role ?? "").trim();
      const requestedMenus = Array.isArray(body.menu_keys) ? body.menu_keys : [];

      if (!email || !password || !full_name || !role) {
        return json({ error: "Tous les champs sont requis." }, 400);
      }

      if (!ALLOWED_ROLES.includes(role as typeof ALLOWED_ROLES[number])) {
        return json({ error: "Rôle non autorisé. Un compte créé par un propriétaire/administrateur doit être un compte membre." }, 400);
      }

      if (password.length < 6) {
        return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      }

      const menuKeys = [...new Set(requestedMenus.map((x: unknown) => String(x)).filter((x: string) => ALLOWED_MENU_KEYS.has(x)))];

      // Make the tenant explicit and immutable in the Auth metadata we create.
      // This is intentionally derived from the authenticated caller, never from the request body.
      const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
        app_metadata: { site_id: callerSiteId, role },
      });

      if (authErr || !authData.user) {
        const message = authErr?.message || "Impossible de créer le compte Auth.";
        return json({ error: message }, authErr?.status && authErr.status >= 400 ? authErr.status : 500);
      }

      const newUserId = authData.user.id;

      try {
        // Do not trust the Auth trigger as the only provisioning mechanism.
        // The trigger normally creates this row, but this authoritative upsert makes
        // the result deterministic even if an older trigger/function is still deployed.
        const { error: profileErr } = await adminClient
          .from("profiles")
          .upsert({
            id: newUserId,
            email,
            full_name,
            role,
            site_id: callerSiteId,
            updated_at: new Date().toISOString(),
          }, { onConflict: "id" });

        if (profileErr) throw new Error(`Profil utilisateur non provisionné : ${profileErr.message}`);

        // Verify the final tenant and role instead of assuming that the trigger worked.
        const { data: verifiedProfile, error: verifyErr } = await adminClient
          .from("profiles")
          .select("id, email, full_name, role, site_id")
          .eq("id", newUserId)
          .maybeSingle();

        if (verifyErr) throw verifyErr;
        if (!verifiedProfile || verifiedProfile.site_id !== callerSiteId || verifiedProfile.role !== role) {
          throw new Error("Le profil créé n'est pas rattaché au bon site ou au bon rôle.");
        }

        // Menu permissions are created here, inside the same server-side workflow,
        // so a failure cannot leave a half-created user behind.
        if (menuKeys.length > 0) {
          const permissionRows = menuKeys.map((menu_key: string) => ({
            site_id: callerSiteId,
            user_id: newUserId,
            menu_key,
            can_view: true,
          }));
          const { error: permissionErr } = await adminClient
            .from("user_menu_permissions")
            .upsert(permissionRows, { onConflict: "site_id,user_id,menu_key" });
          if (permissionErr) throw new Error(`Permissions utilisateur non enregistrées : ${permissionErr.message}`);
        }

        // Keep Auth metadata synchronized with the authoritative profile values.
        const { error: metadataErr } = await adminClient.auth.admin.updateUserById(newUserId, {
          app_metadata: { site_id: callerSiteId, role },
          user_metadata: { full_name },
        });
        if (metadataErr) throw metadataErr;

        // Explicit audit entry. The automatic profile trigger may also create a row-change
        // entry; this one records the business action and the authenticated actor reliably.
        const { error: auditErr } = await adminClient.from("audit_logs").insert({
          site_id: callerSiteId,
          actor_id: user.id,
          action: "create",
          entity_type: "user",
          entity_id: newUserId,
          details: { email, full_name, role },
        });
        if (auditErr) throw new Error(`Journal d'audit non enregistré : ${auditErr.message}`);

        return json({ id: newUserId, email, full_name, role }, 201);
      } catch (provisionErr) {
        // Compensating transaction: Auth + profile + permissions are removed together.
        // This prevents the old "first click failed / second click says already exists" state.
        await adminClient.auth.admin.deleteUser(newUserId);
        const message = provisionErr instanceof Error ? provisionErr.message : "Provisionnement utilisateur échoué.";
        return json({ error: message }, 500);
      }
    }

    // PATCH /manage-users — update user password.
    if (method === "PATCH") {
      const body = await req.json();
      const { id: targetId, password: newPassword } = body;

      if (!targetId || !newPassword) {
        return json({ error: "ID utilisateur et nouveau mot de passe requis." }, 400);
      }
      if (String(newPassword).length < 6) {
        return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      }

      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("site_id, role")
        .eq("id", targetId)
        .maybeSingle();

      if (!targetProfile || targetProfile.site_id !== callerSiteId) {
        return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      }
      if (targetProfile.role === "owner" && callerProfile.role !== "owner") {
        return json({ error: "Seul un propriétaire peut modifier le mot de passe d'un autre propriétaire." }, 403);
      }

      const { error: updateErr } = await adminClient.auth.admin.updateUserById(targetId, { password: newPassword });
      if (updateErr) throw updateErr;
      return json({ success: true });
    }

    // PUT /manage-users — update user role (same site only).
    if (method === "PUT") {
      const body = await req.json();
      const { id: targetId, role: newRole } = body;

      if (!targetId || !newRole) return json({ error: "ID utilisateur et rôle requis." }, 400);
      if (!ALLOWED_ROLES.includes(newRole as typeof ALLOWED_ROLES[number])) return json({ error: "Rôle non autorisé." }, 400);

      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("site_id, role")
        .eq("id", targetId)
        .maybeSingle();

      if (!targetProfile || targetProfile.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (targetProfile.role === "owner") return json({ error: "Impossible de modifier le rôle d'un propriétaire." }, 403);

      const { error: profileErr } = await adminClient
        .from("profiles")
        .update({ role: newRole, updated_at: new Date().toISOString() })
        .eq("id", targetId)
        .eq("site_id", callerSiteId);
      if (profileErr) throw profileErr;

      const { error: metadataErr } = await adminClient.auth.admin.updateUserById(targetId, {
        app_metadata: { site_id: callerSiteId, role: newRole },
      });
      if (metadataErr) throw metadataErr;

      return json({ success: true });
    }

    // DELETE /manage-users?id=... — delete user (same site only).
    if (method === "DELETE") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("id");
      if (!userId) return json({ error: "ID utilisateur requis." }, 400);
      if (userId === user.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);

      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("site_id, role")
        .eq("id", userId)
        .maybeSingle();

      if (!targetProfile || targetProfile.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (targetProfile.role === "owner" && !isOwner) return json({ error: "Seul le propriétaire peut supprimer un autre propriétaire." }, 403);

      const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
      if (deleteErr) throw deleteErr;
      return json({ success: true });
    }

    return json({ error: "Méthode non supportée." }, 405);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur serveur.";
    return json({ error: message }, 500);
  }
});
