import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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

    // POST /manage-users — create a new user in the caller's site.
    //
    // This is deliberately implemented as a compensating transaction:
    // Auth creation is followed by strict profile/menu/audit verification.
    // If any post-Auth step fails, the newly created Auth user is deleted so
    // the UI can never report a generic failure while leaving an orphan.
    if (method === "POST") {
      const body = await req.json();
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const full_name = String(body?.full_name ?? "").trim();
      const role = String(body?.role ?? "");
      const menuKeys = Array.isArray(body?.menu_keys)
        ? body.menu_keys.map((v: unknown) => String(v).trim()).filter(Boolean)
        : [];

      if (!email || !password || !full_name || !role) {
        return json({ error: "Tous les champs sont requis." }, 400);
      }

      if (!ALLOWED_ROLES.includes(role)) {
        return json({ error: "Rôle non autorisé. Un nouvel utilisateur créé depuis la gestion du site ne peut pas être propriétaire." }, 400);
      }

      // Fail early on a profile already present in the caller's tenant.
      // This also makes rapid repeated submissions deterministic.
      const { data: existingProfile, error: existingProfileErr } = await supabase
        .from("profiles")
        .select("id, email, site_id")
        .ilike("email", email)
        .limit(1)
        .maybeSingle();

      if (existingProfileErr) throw existingProfileErr;
      if (existingProfile) {
        return json({ error: "Cette adresse e-mail est déjà associée à un utilisateur." }, 409);
      }

      let createdUserId: string | null = null;

      try {
        const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name },
          // app_metadata is server-controlled: the client never supplies site_id.
          app_metadata: { site_id: callerSiteId, role },
        });

        if (authErr) {
          const message = authErr.message || "";
          if (/already.*registered|already.*exists|duplicate|unique/i.test(message)) {
            return json({ error: "Cette adresse e-mail existe déjà dans Supabase Authentication." }, 409);
          }
          throw authErr;
        }

        if (!authData.user?.id) {
          throw new Error("Supabase Auth n'a retourné aucun identifiant utilisateur.");
        }
        createdUserId = authData.user.id;

        // The Auth trigger must create the profile using the exact server-side
        // tenant and role. Do not silently repair a mismatch: a mismatch means
        // the database installation is inconsistent and the operation is rolled
        // back instead of creating a cross-tenant account.
        const { data: profile, error: profileReadErr } = await supabase
          .from("profiles")
          .select("id, email, full_name, role, site_id")
          .eq("id", createdUserId)
          .maybeSingle();

        if (profileReadErr) throw profileReadErr;
        if (!profile) {
          throw new Error("COMPTE_CREE_PROFIL_ABSENT: le compte Auth a été créé mais aucun profil n'a été généré.");
        }
        if (profile.site_id !== callerSiteId) {
          throw new Error("COMPTE_CREE_SITE_INCORRECT: le profil créé n'appartient pas au site du propriétaire.");
        }
        if (profile.role !== role) {
          throw new Error(`COMPTE_CREE_ROLE_INCORRECT: le profil créé possède le rôle « ${profile.role} » au lieu de « ${role} ».`);
        }

        // Complete menu permissions on the server, so a permission failure
        // cannot turn a successful user creation into a misleading frontend
        // failure with a half-created account.
        const { error: menuDeleteErr } = await supabase
          .from("user_menu_permissions")
          .delete()
          .eq("user_id", createdUserId)
          .eq("site_id", callerSiteId);
        if (menuDeleteErr) throw menuDeleteErr;

        if (menuKeys.length > 0) {
          const rows = menuKeys.map((menu_key: string) => ({
            site_id: callerSiteId,
            user_id: createdUserId,
            menu_key,
            can_view: true,
          }));
          const { error: menuInsertErr } = await supabase
            .from("user_menu_permissions")
            .upsert(rows, { onConflict: "site_id,user_id,menu_key" });
          if (menuInsertErr) throw menuInsertErr;
        }

        // The audit row is part of the same success contract. It records the
        // server-verified tenant and role, never client-provided tenant data.
        const { error: auditErr } = await supabase
          .from("audit_logs")
          .insert({
            site_id: callerSiteId,
            actor_id: user.id,
            action: "user.created",
            entity_type: "user",
            entity_id: createdUserId,
            details: {
              email,
              full_name,
              role,
              site_id: callerSiteId,
            },
          });
        if (auditErr) throw auditErr;

        return json({
          id: createdUserId,
          email,
          full_name,
          role,
          site_id: callerSiteId,
        }, 201);
      } catch (err) {
        if (createdUserId) {
          const { error: rollbackErr } = await supabase.auth.admin.deleteUser(createdUserId);
          if (rollbackErr) {
            const original = err instanceof Error ? err.message : "Erreur inconnue.";
            return json({
              error: `Création interrompue après Auth. ${original} ÉCHEC DU ROLLBACK: l'utilisateur ${createdUserId} doit être vérifié côté Supabase.`,
              code: "USER_CREATE_ROLLBACK_FAILED",
            }, 500);
          }
        }

        const message = err instanceof Error ? err.message : "Erreur pendant la création de l'utilisateur.";
        return json({ error: message, code: "USER_CREATE_FAILED" }, 500);
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
