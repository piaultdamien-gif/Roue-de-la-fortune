import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // =========================================================
    // SUPABASE
    // =========================================================

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(
        { error: "Configuration Supabase manquante." },
        500,
      );
    }

    // Client lié au joueur connecté.
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return json({ error: "Utilisateur non authentifié." }, 401);
    }

    const userClient = createClient(
      supabaseUrl,
      anonKey,
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Session invalide." }, 401);
    }

    // Client serveur.
    // Lui seul peut modifier matchmaking et statistiques.
    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    // =========================================================
    // STATUS
    // =========================================================

    if (action === "status") {
      const { data: matches, error } = await admin
        .from("multiplayer_duel_matches")
        .select("*")
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("STATUS:", error);
        return json({ error: "Impossible de lire le matchmaking." }, 500);
      }

      const match = matches?.[0] ?? null;

      return json({
        ok: true,
        status: match?.status ?? "idle",
        match,
      });
    }

    // =========================================================
    // CANCEL
    // =========================================================

    if (action === "cancel") {
      const { error } = await admin
        .from("multiplayer_duel_matches")
        .delete()
        .eq("player1_id", user.id)
        .eq("status", "waiting");

      if (error) {
        console.error("CANCEL:", error);
        return json({ error: "Impossible d'annuler la recherche." }, 500);
      }

      return json({
        ok: true,
        status: "idle",
      });
    }

    // =========================================================
    // SEARCH
    // =========================================================

    if (action === "search") {
      // -------------------------------------------------------
      // 1. Vérifier que le joueur n'est pas déjà dans
      //    un matchmaking actif.
      // -------------------------------------------------------

      const { data: existingMatches, error: existingError } = await admin
        .from("multiplayer_duel_matches")
        .select("*")
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
        .in("status", [
          "waiting",
          "matched",
          "ready",
          "resolving",
          "completed",
        ])
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingError) {
        console.error("EXISTING MATCH:", existingError);
        return json({ error: "Erreur de vérification du matchmaking." }, 500);
      }

      if (existingMatches && existingMatches.length > 0) {
        const existing = existingMatches[0];

        return json({
          ok: true,
          status: existing.status,
          match: existing,
        });
      }

      // -------------------------------------------------------
      // 2. Chercher le joueur qui attend depuis le plus
      //    longtemps.
      // -------------------------------------------------------

      const { data: waitingPlayers, error: waitingError } = await admin
        .from("multiplayer_duel_matches")
        .select("*")
        .eq("status", "waiting")
        .neq("player1_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);

      if (waitingError) {
        console.error("WAITING SEARCH:", waitingError);
        return json({ error: "Impossible de rechercher un adversaire." }, 500);
      }

      const opponentMatch = waitingPlayers?.[0];

      // -------------------------------------------------------
      // 3. Un adversaire attend déjà :
      //    on rejoint son match.
      //
      //    Le .eq("status", "waiting") est important :
      //    si deux joueurs essaient de prendre le même
      //    adversaire simultanément, un seul peut réussir.
      // -------------------------------------------------------

      if (opponentMatch) {
        const { data: matchedRows, error: matchError } = await admin
          .from("multiplayer_duel_matches")
          .update({
            player2_id: user.id,
            status: "matched",
            updated_at: new Date().toISOString(),
          })
          .eq("id", opponentMatch.id)
          .eq("status", "waiting")
          .is("player2_id", null)
          .select();

        if (matchError) {
          console.error("MATCH UPDATE:", matchError);
          return json({ error: "Impossible de créer le duel." }, 500);
        }

        // Quelqu'un a pu prendre cet adversaire quelques
        // millisecondes avant nous.
        if (!matchedRows || matchedRows.length === 0) {
          return json({
            ok: true,
            status: "retry",
          });
        }

        return json({
          ok: true,
          status: "matched",
          match: matchedRows[0],
        });
      }

      // -------------------------------------------------------
      // 4. Personne n'attend :
      //    on crée notre propre recherche.
      // -------------------------------------------------------

      const { data: created, error: createError } = await admin
        .from("multiplayer_duel_matches")
        .insert({
          player1_id: user.id,
          status: "waiting",
        })
        .select()
        .single();

      if (createError) {
        console.error("CREATE SEARCH:", createError);

        // Le unique index créé précédemment empêche normalement
        // deux recherches simultanées pour le même compte.
        return json(
          { error: "Impossible de démarrer la recherche." },
          500,
        );
      }

      return json({
        ok: true,
        status: "waiting",
        match: created,
      });
    }

    // =========================================================
    // ACTION INCONNUE
    // =========================================================

    return json(
      {
        error: "Action inconnue.",
        allowedActions: [
          "search",
          "status",
          "cancel",
        ],
      },
      400,
    );
  } catch (error) {
    console.error("MULTIPLAYER DUEL:", error);

    return json(
      {
        error: error instanceof Error
          ? error.message
          : "Erreur serveur inconnue.",
      },
      500,
    );
  }
});
