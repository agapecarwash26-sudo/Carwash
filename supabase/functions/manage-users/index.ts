import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_ROLES = ["admin", "manager", "cashier", "operator", "stock_manager"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non autorisé." }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Session invalide." }, 401);

    // Fetch the caller's profile (role + site_id)
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role, site_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!callerProfile || !["owner", "admin"].includes(callerProfile.role)) {
      return json({ error: "Accès refusé : droits administrateur requis." }, 403);
    }

    const callerSiteId = callerProfile.site_id;
    const isOwner = callerProfile.role === "owner";
    const method = req.method;

    // GET /manage-users — list users of the caller's site only
    if (method === "GET") {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, created_at")
        .eq("site_id", callerSiteId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return json(data);
    }

    // POST /manage-users — create a new user in the caller's site
    if (method === "POST") {
      const body = await req.json();
      const { email, password, full_name, role, menu_keys } = body;
      const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
      const normalizedName = typeof full_name === "string" ? full_name.trim() : "";
      const normalizedRole = typeof role === "string" ? role.trim() : "";
      const requestedMenus = Array.isArray(menu_keys) ? menu_keys.filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "") : [];

      if (!normalizedEmail || !password || !normalizedName || !normalizedRole) {
        return json({ error: "Tous les champs sont requis." }, 400);
      }

      if (!ALLOWED_ROLES.includes(normalizedRole)) {
        return json({ error: "Rôle non autorisé. Seul le propriétaire peut être créé via l'inscription." }, 400);
      }

      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: normalizedName },
        app_metadata: { site_id: callerSiteId, role: normalizedRole },
      });

      if (authErr) throw authErr;

      // Never trust the Auth trigger as the final source of tenant/role data.
      // The owner/admin caller is authoritative for the new account's site and role.
      const { data: createdProfile, error: profileErr } = await supabase
        .from("profiles")
        .upsert({
          id: authData.user.id,
          email: normalizedEmail,
          full_name: normalizedName,
          role: normalizedRole,
          site_id: callerSiteId,
        }, { onConflict: "id" })
        .select("id, email, full_name, role, site_id")
        .single();

      if (profileErr) {
        await supabase.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
        throw profileErr;
      }

      if (createdProfile.site_id !== callerSiteId || createdProfile.role !== role) {
        await supabase.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
        throw new Error("La création du profil a échoué : le site ou le rôle ne correspond pas à la demande.");
      }

      if (requestedMenus.length > 0) {
        const { error: permissionErr } = await supabase
          .from("user_menu_permissions")
          .delete()
          .eq("site_id", callerSiteId)
          .eq("user_id", authData.user.id);
        if (permissionErr) {
          await supabase.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
          throw permissionErr;
        }
        const { error: permissionInsertErr } = await supabase
          .from("user_menu_permissions")
          .insert(requestedMenus.map((menu_key: string) => ({
            site_id: callerSiteId, user_id: authData.user.id, menu_key, can_view: true
          })));
        if (permissionInsertErr) {
          await supabase.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
          throw permissionInsertErr;
        }
      }

      // Explicit audit entry: this request runs with service-role credentials,
      // so the database trigger cannot infer the human caller via auth.uid().
      const { error: auditErr } = await supabase.from("audit_logs").insert({
        site_id: callerSiteId,
        actor_id: user.id,
        action: "create",
        entity_type: "user",
        entity_id: authData.user.id,
        details: { email: normalizedEmail, full_name: normalizedName, role: normalizedRole, menu_keys: requestedMenus },
      });
      if (auditErr) {
        await supabase.auth.admin.deleteUser(authData.user.id).catch(() => undefined);
        throw auditErr;
      }

      return json({ id: authData.user.id, email: normalizedEmail, full_name: normalizedName, role: normalizedRole }, 201);
    }

    // PATCH /manage-users — update user password (owner/admin only, same site)
    if (method === "PATCH") {
      const body = await req.json();
      const { id: targetId, password: newPassword } = body;

      if (!targetId || !newPassword) {
        return json({ error: "ID utilisateur et nouveau mot de passe requis." }, 400);
      }

      if (newPassword.length < 6) {
        return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      }

      if (!["owner", "admin"].includes(callerProfile.role)) {
        return json({ error: "Accès refusé : seuls les propriétaires et administrateurs peuvent modifier les mots de passe." }, 403);
      }

      // Verify target user belongs to the same site
      const { data: targetProfile } = await supabase
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

      const { error: updateErr } = await supabase.auth.admin.updateUserById(targetId, { password: newPassword });
      if (updateErr) throw updateErr;

      return json({ success: true });
    }

    // PUT /manage-users — update user role (same site only)
    if (method === "PUT") {
      const body = await req.json();
      const { id: targetId, role: newRole } = body;

      if (!targetId || !newRole) {
        return json({ error: "ID utilisateur et rôle requis." }, 400);
      }

      if (!ALLOWED_ROLES.includes(newRole)) {
        return json({ error: "Rôle non autorisé." }, 400);
      }

      // Verify target user is in the same site
      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("site_id, role")
        .eq("id", targetId)
        .maybeSingle();

      if (!targetProfile || targetProfile.site_id !== callerSiteId) {
        return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      }

      // Prevent changing an owner's role (only owner can do that, and there's no
      // higher role to assign)
      if (targetProfile.role === "owner") {
        return json({ error: "Impossible de modifier le rôle d'un propriétaire." }, 403);
      }

      const { error } = await supabase
        .from("profiles")
        .update({ role: newRole, updated_at: new Date().toISOString() })
        .eq("id", targetId);

      if (error) throw error;

      return json({ success: true });
    }

    // DELETE /manage-users?id=... — delete user (same site only)
    if (method === "DELETE") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("id");
      if (!userId) return json({ error: "ID utilisateur requis." }, 400);

      if (userId === user.id) {
        return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);
      }

      // Verify target user is in the same site
      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("site_id, role")
        .eq("id", userId)
        .maybeSingle();

      if (!targetProfile || targetProfile.site_id !== callerSiteId) {
        return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      }

      if (targetProfile.role === "owner" && !isOwner) {
        return json({ error: "Seul le propriétaire peut supprimer un autre propriétaire." }, 403);
      }

      const { error: deleteErr } = await supabase.auth.admin.deleteUser(userId);
      if (deleteErr) throw deleteErr;

      return json({ success: true });
    }

    return json({ error: "Méthode non supportée." }, 405);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur serveur.";
    return json({ error: message }, 500);
  }
});
