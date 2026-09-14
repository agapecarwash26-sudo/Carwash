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

function errorMessage(error: unknown, fallback = "Erreur serveur.") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

async function audit(
  adminClient: ReturnType<typeof createClient>,
  input: { site_id: string; actor_id: string; action: string; entity_id?: string | null; details?: Record<string, unknown> },
) {
  // Audit must never make user management fail.
  try {
    await adminClient.from("audit_logs").insert({
      site_id: input.site_id,
      actor_id: input.actor_id,
      action: input.action,
      entity_type: "user",
      entity_id: input.entity_id ?? null,
      details: input.details ?? {},
    });
  } catch {
    // Best effort only.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Configuration Supabase Edge Function incomplète." }, 500);
  }

  try {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non autorisé." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Session invalide." }, 401);

    const { data: callerProfile, error: callerError } = await adminClient
      .from("profiles")
      .select("role, site_id")
      .eq("id", user.id)
      .maybeSingle();

    if (callerError) {
      return json({ error: `Profil administrateur introuvable: ${callerError.message}` }, 500);
    }

    if (!callerProfile || !["owner", "admin"].includes(callerProfile.role)) {
      return json({ error: "Accès refusé : droits administrateur requis." }, 403);
    }

    const callerSiteId = callerProfile.site_id;
    if (!callerSiteId) return json({ error: "Votre profil n'est associé à aucun site." }, 409);

    const method = req.method;

    if (method === "GET") {
      const { data, error } = await adminClient
        .from("profiles")
        .select("id, email, full_name, role, site_id, created_at")
        .eq("site_id", callerSiteId)
        .order("created_at", { ascending: false });

      if (error) return json({ error: `Impossible de charger les utilisateurs: ${error.message}` }, 500);
      return json(data ?? []);
    }

    if (method === "POST") {
      const body = await req.json().catch(() => null);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const full_name = String(body?.full_name ?? "").trim();
      const role = String(body?.role ?? "").trim();
      const menu_keys = Array.isArray(body?.menu_keys)
        ? body.menu_keys.map((value: unknown) => String(value)).filter(Boolean)
        : [];

      if (!email || !password || !full_name || !role) {
        return json({ error: "Nom, e-mail, mot de passe et rôle sont requis." }, 400);
      }
      if (password.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      if (!ALLOWED_ROLES.includes(role)) return json({ error: "Rôle non autorisé." }, 400);

      // The metadata is consumed by handle_new_user(). It explicitly assigns
      // the existing caller site and requested role and does not bootstrap a site.
      const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
        app_metadata: { site_id: callerSiteId, role },
      });

      if (authErr || !authData.user) {
        const msg = errorMessage(authErr, "Impossible de créer le compte Auth.");
        const duplicate = /already|exists|registered|duplicate/i.test(msg);
        return json({ error: msg }, duplicate ? 409 : 500);
      }

      const newUserId = authData.user.id;

      try {
        // Do not rely only on the trigger: explicitly verify and normalize the
        // profile with the service-role client. This makes the final state clear.
        const { data: profile, error: profileError } = await adminClient
          .from("profiles")
          .upsert({
            id: newUserId,
            email,
            full_name,
            role,
            site_id: callerSiteId,
            updated_at: new Date().toISOString(),
          }, { onConflict: "id" })
          .select("id, email, full_name, role, site_id, created_at")
          .single();

        if (profileError) throw new Error(`Profil non créé: ${profileError.message}`);
        if (!profile || profile.site_id !== callerSiteId || profile.role !== role) {
          throw new Error("Le profil créé n'a pas reçu le site ou le rôle demandé.");
        }

        // Write permissions directly with service role. Calling the SECURITY
        // DEFINER RPC from a service-role client would not carry the caller JWT.
        if (await tableExists(adminClient, "user_menu_permissions")) {
          const { error: deletePermissionError } = await adminClient
            .from("user_menu_permissions")
            .delete()
            .eq("user_id", newUserId)
            .eq("site_id", callerSiteId);
          if (deletePermissionError) throw new Error(`Permissions: ${deletePermissionError.message}`);

          if (menu_keys.length) {
            const rows = menu_keys.map((menu_key: string) => ({
              site_id: callerSiteId,
              user_id: newUserId,
              menu_key,
              can_view: true,
            }));
            const { error: permissionError } = await adminClient
              .from("user_menu_permissions")
              .insert(rows);
            if (permissionError) throw new Error(`Permissions: ${permissionError.message}`);
          }
        }
      } catch (postCreateError) {
        // Compensating transaction: never leave an Auth account behind when the
        // required public profile/permissions setup failed.
        await adminClient.auth.admin.deleteUser(newUserId);
        return json({ error: errorMessage(postCreateError, "Configuration du nouvel utilisateur impossible.") }, 500);
      }

      await audit(adminClient, {
        site_id: callerSiteId,
        actor_id: user.id,
        action: "CREATE",
        entity_id: newUserId,
        details: { email, full_name, role, menu_keys },
      });

      return json({
        id: newUserId,
        email,
        full_name,
        role,
        site_id: callerSiteId,
        created_at: authData.user.created_at,
      }, 201);
    }

    if (method === "PATCH") {
      const body = await req.json();
      const targetId = String(body?.id ?? "");
      const newPassword = String(body?.password ?? "");
      if (!targetId || !newPassword) return json({ error: "ID utilisateur et nouveau mot de passe requis." }, 400);
      if (newPassword.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);

      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("site_id, role, email")
        .eq("id", targetId)
        .maybeSingle();
      if (!targetProfile || targetProfile.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (targetProfile.role === "owner" && callerProfile.role !== "owner") return json({ error: "Seul un propriétaire peut modifier le mot de passe d'un autre propriétaire." }, 403);

      const { error: updateError } = await adminClient.auth.admin.updateUserById(targetId, { password: newPassword });
      if (updateError) return json({ error: `Impossible de modifier le mot de passe: ${updateError.message}` }, 500);

      await audit(adminClient, { site_id: callerSiteId, actor_id: user.id, action: "PASSWORD_UPDATE", entity_id: targetId, details: { email: targetProfile.email } });
      return json({ success: true });
    }

    if (method === "PUT") {
      const body = await req.json();
      const targetId = String(body?.id ?? "");
      const newRole = String(body?.role ?? "");
      if (!targetId || !newRole) return json({ error: "ID utilisateur et rôle requis." }, 400);
      if (!ALLOWED_ROLES.includes(newRole)) return json({ error: "Rôle non autorisé." }, 400);

      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("site_id, role, email")
        .eq("id", targetId)
        .maybeSingle();
      if (!targetProfile || targetProfile.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (targetProfile.role === "owner") return json({ error: "Impossible de modifier le rôle d'un propriétaire." }, 403);

      const { error } = await adminClient
        .from("profiles")
        .update({ role: newRole, site_id: callerSiteId, updated_at: new Date().toISOString() })
        .eq("id", targetId)
        .eq("site_id", callerSiteId);
      if (error) return json({ error: `Impossible de modifier le rôle: ${error.message}` }, 500);

      await audit(adminClient, { site_id: callerSiteId, actor_id: user.id, action: "ROLE_UPDATE", entity_id: targetId, details: { from: targetProfile.role, to: newRole, email: targetProfile.email } });
      return json({ success: true });
    }

    if (method === "DELETE") {
      const url = new URL(req.url);
      const targetId = url.searchParams.get("id");
      if (!targetId) return json({ error: "ID utilisateur requis." }, 400);
      if (targetId === user.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);

      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("site_id, role, email, full_name")
        .eq("id", targetId)
        .maybeSingle();
      if (!targetProfile || targetProfile.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (targetProfile.role === "owner" && callerProfile.role !== "owner") return json({ error: "Seul le propriétaire peut supprimer un autre propriétaire." }, 403);

      await audit(adminClient, { site_id: callerSiteId, actor_id: user.id, action: "DELETE", entity_id: targetId, details: { email: targetProfile.email, full_name: targetProfile.full_name, role: targetProfile.role } });

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId);
      if (deleteError) return json({ error: `Impossible de supprimer l'utilisateur: ${deleteError.message}` }, 500);
      return json({ success: true });
    }

    return json({ error: "Méthode non supportée." }, 405);
  } catch (err) {
    return json({ error: errorMessage(err) }, 500);
  }
});

async function tableExists(client: ReturnType<typeof createClient>, table: string): Promise<boolean> {
  const { error } = await client.from(table).select("id").limit(1);
  return !error || !/relation .* does not exist|Could not find the table/i.test(error.message);
}
