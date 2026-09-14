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
      const body = await req.json().catch(() => ({}));
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const full_name = String(body.full_name ?? '').trim();
      const role = String(body.role ?? '').trim();
      const menuKeys = Array.isArray(body.menu_keys) ? body.menu_keys.filter((x: unknown) => typeof x === 'string') : [];
      if (!email || !password || !full_name || !role) return json({ error: "Tous les champs sont requis." }, 400);
      if (password.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      if (!ALLOWED_ROLES.includes(role)) return json({ error: "Rôle non autorisé." }, 400);

      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name }, app_metadata: { site_id: callerSiteId, role },
      });
      if (authErr) {
        const msg = authErr.message || 'Impossible de créer le compte Auth.';
        return json({ error: msg }, /already|exist|registered|duplicate/i.test(msg) ? 409 : 400);
      }
      const newUserId = authData.user.id;
      try {
        const { data: profile, error: profileErr } = await supabase.from('profiles').upsert({
          id: newUserId, email, full_name, role, site_id: callerSiteId, updated_at: new Date().toISOString()
        }, { onConflict: 'id' }).select('id,email,full_name,role,site_id,created_at').single();
        if (profileErr) throw profileErr;
        if (!profile || profile.site_id !== callerSiteId || profile.role !== role) throw new Error('Le profil utilisateur n’a pas pu être rattaché au bon site et au bon rôle.');

        // Service-role requests do not carry auth.uid() to SECURITY DEFINER RPCs, so write permissions directly.
        await supabase.from('user_menu_permissions').delete().eq('user_id', newUserId).eq('site_id', callerSiteId);
        if (menuKeys.length) {
          const { error: permErr } = await supabase.from('user_menu_permissions').insert(menuKeys.map((menu_key: string) => ({ site_id: callerSiteId, user_id: newUserId, menu_key, can_view: true })));
          if (permErr) throw permErr;
        }

        const { error: auditErr } = await supabase.from('audit_logs').insert({
          site_id: callerSiteId, actor_id: user.id, action: 'create', entity_type: 'user', entity_id: newUserId,
          details: { email, full_name, role, site_id: callerSiteId }
        });
        if (auditErr) console.error('Audit log failed (creation preserved):', auditErr);
        return json({ id: newUserId, email, full_name, role, site_id: callerSiteId }, 201);
      } catch (err) {
        await supabase.auth.admin.deleteUser(newUserId).catch(() => undefined);
        throw err;
      }
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
