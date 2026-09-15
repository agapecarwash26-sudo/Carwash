import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ALLOWED_ROLES = ["admin", "manager", "cashier", "operator", "stock_manager"] as const;
type StaffRole = typeof ALLOWED_ROLES[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? "Erreur serveur.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Configuration Supabase de la fonction manquante." }, 500);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non autorisé." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Session invalide." }, 401);

    const { data: callerProfile, error: callerErr } = await supabase
      .from("profiles")
      .select("role, site_id")
      .eq("id", user.id)
      .maybeSingle();

    if (callerErr) throw callerErr;
    if (!callerProfile || !["owner", "admin"].includes(callerProfile.role)) {
      return json({ error: "Accès refusé : droits administrateur requis." }, 403);
    }

    const callerSiteId = callerProfile.site_id;
    if (!callerSiteId) {
      return json({ error: "Votre compte administrateur n'est associé à aucun site." }, 409);
    }

    const isOwner = callerProfile.role === "owner";
    const method = req.method;

    if (method === "GET") {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, created_at")
        .eq("site_id", callerSiteId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json(data ?? []);
    }

    if (method === "POST") {
      const body = await req.json();
      const email = normalizeEmail(body.email);
      const password = String(body.password ?? "");
      const fullName = String(body.full_name ?? "").trim();
      const role = String(body.role ?? "").trim() as StaffRole;
      const menuKeys = Array.isArray(body.menu_keys)
        ? body.menu_keys.filter((v: unknown) => typeof v === "string" && v.trim()).map((v: string) => v.trim())
        : [];

      if (!email || !password || !fullName || !role) {
        return json({ error: "Tous les champs sont requis." }, 400);
      }
      if (password.length < 6) {
        return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);
      }
      if (!(ALLOWED_ROLES as readonly string[]).includes(role)) {
        return json({ error: "Rôle non autorisé." }, 400);
      }

      // IMPORTANT: app_metadata is supplied at the exact moment Auth creates the
      // user. The database trigger reads these two fields to provision profiles.
      // We do not create/update profiles from the browser.
      const requestedSiteId = callerSiteId;
      const requestedRole = role;

      const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: {
          site_id: requestedSiteId,
          role: requestedRole,
        },
      });

      if (authErr || !authData.user) {
        const message = errorMessage(authErr);
        if (/already|registered|exists/i.test(message)) {
          return json({ error: "Cette adresse e-mail est déjà utilisée." }, 409);
        }
        return json({ error: message || "Impossible de créer le compte Auth." }, 400);
      }

      const newUserId = authData.user.id;

      try {
        // The Auth INSERT trigger must have created the profile using the same
        // site/role. Verify it before reporting success. This prevents a stale
        // deployed function/trigger from leaving a misleading partial account.
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("id, email, full_name, role, site_id, created_at")
          .eq("id", newUserId)
          .maybeSingle();

        if (profileErr) throw profileErr;

        if (!profile) {
          throw new Error("Le compte Auth a été créé mais son profil n'a pas été provisionné.");
        }

        if (profile.site_id !== requestedSiteId) {
          throw new Error("Le profil utilisateur a été créé sur un autre site. Création annulée pour protéger le multi-site.");
        }

        if (profile.role !== requestedRole) {
          throw new Error(`Le profil utilisateur a reçu le rôle « ${profile.role } » au lieu de « ${requestedRole} ». Création annulée.`);
        }

        // Menu permissions are part of the same server-side workflow. The
        // browser no longer performs a second RPC after Auth creation.
        if (menuKeys.length > 0) {
          const rows = menuKeys.map((menu_key) => ({
            site_id: requestedSiteId,
            user_id: newUserId,
            menu_key,
            can_view: true,
          }));
          const { error: permissionErr } = await supabase
            .from("user_menu_permissions")
            .upsert(rows, { onConflict: "site_id,user_id,menu_key" });
          if (permissionErr) throw permissionErr;
        }

        return json({
          id: newUserId,
          email,
          full_name: fullName,
          role: requestedRole,
          site_id: requestedSiteId,
        }, 201);
      } catch (provisionErr) {
        // Never leave an Auth account behind when provisioning validation fails.
        // The FK from profiles -> auth.users also cleans the profile.
        await supabase.auth.admin.deleteUser(newUserId).catch(() => undefined);
        return json({ error: errorMessage(provisionErr) }, 409);
      }
    }

    if (method === "PATCH") {
      const body = await req.json();
      const { id: targetId, password: newPassword } = body;
      if (!targetId || !newPassword) return json({ error: "ID utilisateur et nouveau mot de passe requis." }, 400);
      if (newPassword.length < 6) return json({ error: "Le mot de passe doit contenir au moins 6 caractères." }, 400);

      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("site_id, role")
        .eq("id", targetId)
        .maybeSingle();
      if (!targetProfile || targetProfile.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (targetProfile.role === "owner" && !isOwner) return json({ error: "Seul un propriétaire peut modifier le mot de passe d'un autre propriétaire." }, 403);

      const { error: updateErr } = await supabase.auth.admin.updateUserById(targetId, { password: newPassword });
      if (updateErr) throw updateErr;
      return json({ success: true });
    }

    if (method === "PUT") {
      const body = await req.json();
      const { id: targetId, role: newRole } = body;
      if (!targetId || !newRole) return json({ error: "ID utilisateur et rôle requis." }, 400);
      if (!(ALLOWED_ROLES as readonly string[]).includes(newRole)) return json({ error: "Rôle non autorisé." }, 400);

      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("site_id, role")
        .eq("id", targetId)
        .maybeSingle();
      if (!targetProfile || targetProfile.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (targetProfile.role === "owner") return json({ error: "Impossible de modifier le rôle d'un propriétaire." }, 403);

      const { error } = await supabase
        .from("profiles")
        .update({ role: newRole, updated_at: new Date().toISOString() })
        .eq("id", targetId)
        .eq("site_id", callerSiteId);
      if (error) throw error;
      return json({ success: true });
    }

    if (method === "DELETE") {
      const url = new URL(req.url);
      const userId = url.searchParams.get("id");
      if (!userId) return json({ error: "ID utilisateur requis." }, 400);
      if (userId === user.id) return json({ error: "Vous ne pouvez pas supprimer votre propre compte." }, 400);

      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("site_id, role")
        .eq("id", userId)
        .maybeSingle();
      if (!targetProfile || targetProfile.site_id !== callerSiteId) return json({ error: "Utilisateur introuvable dans votre site." }, 404);
      if (targetProfile.role === "owner" && !isOwner) return json({ error: "Seul le propriétaire peut supprimer un autre propriétaire." }, 403);

      const { error: deleteErr } = await supabase.auth.admin.deleteUser(userId);
      if (deleteErr) throw deleteErr;
      return json({ success: true });
    }

    return json({ error: "Méthode non supportée." }, 405);
  } catch (err) {
    return json({ error: errorMessage(err) }, 500);
  }
});
