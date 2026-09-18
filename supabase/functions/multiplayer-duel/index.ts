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

function parseUniverseMeta(value: unknown): any {
  if (!value) return {};

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return {};
}

function championExists(
  champions: any,
  championId: string,
): boolean {
  if (!champions || !championId) return false;

  // Format objet :
  // { "S1": {...}, "S2": {...} }
  if (typeof champions === "object" && !Array.isArray(champions)) {
    return Object.values(champions).some((champion: any) => {
      if (!champion) return false;

      return (
        String(champion.id ?? "") === championId ||
        String(champion.characterId ?? "") === championId ||
        String(champion.character_code ?? "") === championId
      );
    });
  }

  // Sécurité si le format devient un tableau.
  if (Array.isArray(champions)) {
    return champions.some((champion: any) => {
      return (
        String(champion?.id ?? "") === championId ||
        String(champion?.characterId ?? "") === championId ||
        String(champion?.character_code ?? "") === championId
      );
    });
  }

  return false;
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

    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return json(
        { error: "Utilisateur non authentifié." },
        401,
      );
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
      return json(
        { error: "Session invalide." },
        401,
      );
    }

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
        .or(
          `player1_id.eq.${user.id},player2_id.eq.${user.id}`,
        )
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("STATUS:", error);

        return json(
          { error: "Impossible de lire le matchmaking." },
          500,
        );
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

        return json(
          { error: "Impossible d'annuler la recherche." },
          500,
        );
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
      // Vérifie que le joueur n'est pas déjà
      // dans un matchmaking actif.

      const {
        data: existingMatches,
        error: existingError,
      } = await admin
        .from("multiplayer_duel_matches")
        .select("*")
        .or(
          `player1_id.eq.${user.id},player2_id.eq.${user.id}`,
        )
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
        console.error(
          "EXISTING MATCH:",
          existingError,
        );

        return json(
          {
            error:
              "Erreur de vérification du matchmaking.",
          },
          500,
        );
      }

      if (
        existingMatches &&
        existingMatches.length > 0
      ) {
        const existing = existingMatches[0];

        return json({
          ok: true,
          status: existing.status,
          match: existing,
        });
      }

      // Cherche le joueur en attente depuis
      // le plus longtemps.

      const {
        data: waitingPlayers,
        error: waitingError,
      } = await admin
        .from("multiplayer_duel_matches")
        .select("*")
        .eq("status", "waiting")
        .neq("player1_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);

      if (waitingError) {
        console.error(
          "WAITING SEARCH:",
          waitingError,
        );

        return json(
          {
            error:
              "Impossible de rechercher un adversaire.",
          },
          500,
        );
      }

      const opponentMatch = waitingPlayers?.[0];

      if (opponentMatch) {
        const {
          data: matchedRows,
          error: matchError,
        } = await admin
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
          console.error(
            "MATCH UPDATE:",
            matchError,
          );

          return json(
            {
              error:
                "Impossible de créer le duel.",
            },
            500,
          );
        }

        // L'adversaire a pu être pris simultanément
        // par un autre joueur.
        if (
          !matchedRows ||
          matchedRows.length === 0
        ) {
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

      // Aucun adversaire : création d'une attente.

      const {
        data: created,
        error: createError,
      } = await admin
        .from("multiplayer_duel_matches")
        .insert({
          player1_id: user.id,
          status: "waiting",
        })
        .select()
        .single();

      if (createError) {
        console.error(
          "CREATE SEARCH:",
          createError,
        );

        return json(
          {
            error:
              "Impossible de démarrer la recherche.",
          },
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
    // SELECT CHAMPION
    // =========================================================

    if (action === "select_champion") {
      const gameId = String(
        body?.gameId || "",
      ).trim();

      const championId = String(
        body?.championId || "",
      ).trim();

      if (!gameId || !championId) {
        return json(
          {
            error:
              "gameId et championId sont obligatoires.",
          },
          400,
        );
      }

      // -------------------------------------------------------
      // 1. Trouver le duel actif.
      // -------------------------------------------------------

      const {
        data: activeMatches,
        error: activeError,
      } = await admin
        .from("multiplayer_duel_matches")
        .select("*")
        .or(
          `player1_id.eq.${user.id},player2_id.eq.${user.id}`,
        )
        .in("status", [
          "matched",
          "ready",
        ])
        .order("created_at", { ascending: false })
        .limit(1);

      if (activeError) {
        console.error(
          "ACTIVE MATCH:",
          activeError,
        );

        return json(
          {
            error:
              "Impossible de retrouver le duel.",
          },
          500,
        );
      }

      const match = activeMatches?.[0];

      if (!match) {
        return json(
          {
            error:
              "Aucun duel actif trouvé.",
          },
          404,
        );
      }

      // -------------------------------------------------------
      // 2. Vérifier que la partie appartient réellement
      //    au joueur connecté.
      // -------------------------------------------------------

      const {
        data: game,
        error: gameError,
      } = await admin
        .from("games")
        .select(
          "id, owner_id, universe_meta",
        )
        .eq("id", gameId)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (gameError) {
        console.error(
          "GAME CHECK:",
          gameError,
        );

        return json(
          {
            error:
              "Impossible de vérifier la partie.",
          },
          500,
        );
      }

      if (!game) {
        return json(
          {
            error:
              "Cette partie n'appartient pas au joueur connecté.",
          },
          403,
        );
      }

      // -------------------------------------------------------
      // 3. Vérifier que le personnage est réellement
      //    enregistré comme champion.
      // -------------------------------------------------------

      const universeMeta =
        parseUniverseMeta(game.universe_meta);

      const champions =
        universeMeta?.champions || {};

      if (
        !championExists(
          champions,
          championId,
        )
      ) {
        return json(
          {
            error:
              "Ce personnage n'est pas un champion de cette partie.",
          },
          403,
        );
      }

      // -------------------------------------------------------
      // 4. Charger les VRAIES données du personnage
      //    depuis Supabase.
      //
      //    On ne fait jamais confiance aux statistiques
      //    envoyées par le navigateur.
      // -------------------------------------------------------

      const {
        data: character,
        error: characterError,
      } = await admin
        .from("characters")
        .select(
          "game_id, character_code, data",
        )
        .eq("game_id", gameId)
        .eq(
          "character_code",
          championId,
        )
        .maybeSingle();

      if (characterError) {
        console.error(
          "CHARACTER CHECK:",
          characterError,
        );

        return json(
          {
            error:
              "Impossible de charger le champion.",
          },
          500,
        );
      }

      if (!character) {
        return json(
          {
            error:
              "Champion introuvable dans les personnages enregistrés.",
          },
          404,
        );
      }

      // -------------------------------------------------------
      // 5. Snapshot serveur du champion.
      //
      //    C'est ce snapshot qui sera utilisé plus tard
      //    pour résoudre le combat.
      // -------------------------------------------------------

      const championSnapshot = {
        gameId,
        championId,
        character:
          character.data,
      };

      const isPlayer1 =
        match.player1_id === user.id;

      const isPlayer2 =
        match.player2_id === user.id;

      if (
        !isPlayer1 &&
        !isPlayer2
      ) {
        return json(
          {
            error:
              "Le joueur ne participe pas à ce duel.",
          },
          403,
        );
      }

      const updatePayload: Record<
        string,
        unknown
      > = {
        updated_at:
          new Date().toISOString(),
      };

      if (isPlayer1) {
        updatePayload.player1_champion =
          championSnapshot;
      } else {
        updatePayload.player2_champion =
          championSnapshot;
      }

      // -------------------------------------------------------
      // 6. Sauvegarder le champion.
      // -------------------------------------------------------

      const {
        data: updated,
        error: updateError,
      } = await admin
        .from("multiplayer_duel_matches")
        .update(updatePayload)
        .eq("id", match.id)
        .select()
        .single();

      if (updateError) {
        console.error(
          "CHAMPION UPDATE:",
          updateError,
        );

        return json(
          {
            error:
              "Impossible d'enregistrer le champion.",
          },
          500,
        );
      }

      // -------------------------------------------------------
      // 7. Si les deux champions sont maintenant présents,
      //    le duel devient READY.
      // -------------------------------------------------------

      const bothReady =
        !!updated.player1_champion &&
        !!updated.player2_champion;

      if (bothReady) {
        const {
          data: readyMatch,
          error: readyError,
        } = await admin
          .from("multiplayer_duel_matches")
          .update({
            status: "ready",
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", match.id)
          .in("status", [
            "matched",
            "ready",
          ])
          .select()
          .single();

        if (readyError) {
          console.error(
            "READY UPDATE:",
            readyError,
          );

          return json(
            {
              error:
                "Les champions sont enregistrés mais le duel n'a pas pu passer en état ready.",
            },
            500,
          );
        }

        return json({
          ok: true,
          status: "ready",
          match: readyMatch,
        });
      }

      // L'autre joueur n'a pas encore choisi.

      return json({
        ok: true,
        status: "matched",
        waitingForOpponent: true,
        match: updated,
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
          "select_champion",
        ],
      },
      400,
    );
  } catch (error) {
    console.error(
      "MULTIPLAYER DUEL:",
      error,
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erreur serveur inconnue.",
      },
      500,
    );
  }
});
