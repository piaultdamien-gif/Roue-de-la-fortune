import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENROUTER_MODEL = "inclusionai/ling-3.0-flash-vl:free";
const CF_MODEL_NORMAL = "@cf/black-forest-labs/flux-2-klein-4b";
const CF_MODEL_CHAMPION = "@cf/black-forest-labs/flux-2-klein-9b";
const BUCKET = "character-images";
const WIDTH = 512;
const HEIGHT = 1024;
const VALIDATION_SCORE_MIN = 85;

const STYLE_REFERENCE_PATHS = [
  "style-references/reference_1_Urgorra.jpg",
  "style-references/reference_2_Veyr.jpg",
  "style-references/reference_3_Kesor.jpg",
  "style-references/reference_4_Arerel.jpg",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanId(value: unknown, fallback: string) {
  const s = String(value ?? fallback).trim();
  return (s || fallback).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
}

function stripDataUri(base64: string) {
  return base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").trim();
}

function base64ToBytes(base64: string) {
  const clean = stripDataUri(base64);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function openRouterText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((x: any) => (typeof x?.text === "string" ? x.text : typeof x === "string" ? x : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function parseLooseJson(text: string): any | null {
  if (!text) return null;
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (_) {}
  }
  return null;
}

function extractFluxPromptFromText(text: string): string | null {
  const m = text.match(/FLUX_PROMPT\s*:\s*([\s\S]*)$/i);
  if (!m) return null;
  const v = m[1].replace(/^```(?:text)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return v || null;
}

function neutralizeForCloudflare(prompt: string) {
  return String(prompt || "")
    .replace(/life[- ]?drain(?:ing)?/gi, "subtle dark arcane siphoning effect")
    .replace(/vampir(?:e|ism|ic)/gi, "dark nocturnal arcane")
    .replace(/mutat(?:ion|ed|ing)/gi, "one clearly visible unusual physical trait")
    .replace(/altered anatomy/gi, "distinctive fantasy anatomy")
    .replace(/artificial(?:ly)?/gi, "engineered")
    .replace(/experiment(?:al|ation)?/gi, "arcane-scientific")
    .replace(/possess(?:ed|ion)/gi, "eerie supernatural influence")
    .replace(/blood magic/gi, "crimson arcane energy")
    .replace(/\bblood\b/gi, "crimson essence")
    .replace(/\bdeath\b/gi, "otherworldly")
    .slice(0, 7000);
}

async function callOpenRouter(
  apiKey: string,
  messages: any[],
  opts: { maxTokens?: number; temperature?: number } = {},
) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://piaultdamien-gif.github.io/Roue-de-la-fortune/",
        "X-Title": "Roue de la Fortune",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages,
        max_tokens: opts.maxTokens ?? 1400,
        temperature: opts.temperature ?? 0.25,
        reasoning: { max_tokens: 400 },
      }),
    });

    const raw = await r.text();
    let data: any = null;

    try {
      data = JSON.parse(raw);
    } catch (_) {}

    if (r.ok) {
      const text = openRouterText(data);
     
      if (text) {
        return { text, data };
      }

      if (attempt === maxAttempts) {
        throw new Error("OpenRouter a renvoyé une réponse vide.");
      }
    } else if (r.status !== 429 || attempt === maxAttempts) {
      throw new Error(
        `OpenRouter ${r.status}: ${data?.error?.message || raw.slice(0, 500)}`
      );
    }

    const delayMs = attempt * 2000;

    console.log(
      `OPENROUTER_RETRY attempt=${attempt}/${maxAttempts} status=${r.status} delay=${delayMs}ms`
    );

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("OpenRouter indisponible après plusieurs tentatives.");
}

async function buildDirectorPrompt(apiKey: string, character: any, legacyPrompt: string) {
  const system = `You are the art director for a procedural dark-fantasy / science-fiction character generator.
Your job is to convert raw character JSON into a concise, highly effective English image prompt for FLUX.2 Klein 4B.

CORE RULES:
- Preserve the generated character exactly. Strange and contradictory combinations are intentional.
- CRITICAL facts must be unmistakable: species/race, gender when visually relevant, unusual height/scale, body type, visible age, dominant colors, exact weapon or absence of weapon, familiar/summon, and distinctive physical signs.
- You MAY invent secondary visual details when they enrich the illustration and are coherent with the data: clothing cuts, facial details, race-appropriate anatomy, environmental props, lighting, or visual metaphors for powers/jobs.
- Invented details must NEVER contradict, replace, resize, remove, or weaken an explicit character fact.
- Scale is strict. If the main character is 0.60 m tall and a summoned Human has no special size specified, the Human remains normal adult human size and must visibly tower over the main character. Never make companions miniature merely to fit the protagonist's scale.
- Keep companions secondary but clearly readable when they are mandatory.
- Translate hard-to-show information into intelligent visual composition rather than explanatory text.
- Do not overload the image with every statistic or abstract mechanic.
- No written or pseudo-written text anywhere: no words, letters, numbers, names, labels, logos, UI, watermark, poster/card typography, or text-like runes.
- Full body vertical portrait, head and feet visible, dark fantasy + science-fiction production art.
- The four external reference images used by FLUX are ART-DIRECTION REFERENCES ONLY. Never copy their characters, species, faces, weapons, clothing, colors, poses or anatomy.

Return ONLY valid JSON with this exact shape:
{
  "critical": ["..."],
  "secondary": ["..."],
  "non_visual": ["..."],
  "flux_prompt": "one complete concise English image prompt"
}`;

  const user = `CHARACTER JSON:\n${JSON.stringify(character, null, 2)}\n\nA legacy hand-written prompt is included only as a fallback/reference for terminology. Do not blindly copy it and do not let it override the JSON:\n${legacyPrompt || "(none)"}`;

  const { text } = await callOpenRouter(
    apiKey,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { maxTokens: 1800, temperature: 0.25 },
  );

  const parsed = parseLooseJson(text);
  const fluxPrompt = String(parsed?.flux_prompt || extractFluxPromptFromText(text) || "").trim();
  if (!fluxPrompt) throw new Error("Ling n'a pas produit de FLUX prompt exploitable.");

  return {
    critical: Array.isArray(parsed?.critical) ? parsed.critical.map(String).slice(0, 30) : [],
    secondary: Array.isArray(parsed?.secondary) ? parsed.secondary.map(String).slice(0, 30) : [],
    nonVisual: Array.isArray(parsed?.non_visual) ? parsed.non_visual.map(String).slice(0, 30) : [],
    fluxPrompt: `${fluxPrompt}\n\nReference images 0-3 are style references only. Preserve the generated character data; do not copy subjects or specific traits from the references.`,
    raw: text,
  };
}

async function validatePortrait(
  apiKey: string,
  character: any,
  critical: string[],
  currentPrompt: string,
  imageBase64: string,
) {
  const system = `You are a strict visual QA reviewer for a procedural character generator.
Compare the generated portrait against the source character JSON and the director's CRITICAL list.
Judge ONLY what is visually inspectable.

Rules:
- Explicit source facts outrank artistic interpretation.
- Coherent invented secondary details are acceptable if they do not contradict source facts.
- Be especially strict about race/species readability, gender when relevant, relative height/scale, body type, age, dominant colors, exact weapon/no-weapon, mandatory familiar/summon, and distinctive visible signs.
- Scale relationships are literal. A 0.60 m protagonist next to a normal Human must look much smaller than that Human unless the JSON explicitly changes the Human's size.
- Text, pseudo-text, logo, watermark, UI or title typography counts as a visible defect.
- "critical_pass" may be true only if every important critical trait is clearly satisfied.
- score is 0-100 for overall visual conformity, not beauty.
- If the image fails, provide a COMPLETE replacement FLUX prompt that preserves successful traits and clearly fixes the failures. Do not merely list corrections.

Return ONLY valid JSON:
{
  "critical_pass": true,
  "score": 0,
  "checks": {"trait": "pass | weak | missing | wrong"},
  "issues": ["..."],
  "corrected_flux_prompt": "complete replacement prompt, or empty string if no correction is needed"
}`;

  const userText = `SOURCE CHARACTER JSON:\n${JSON.stringify(character, null, 2)}\n\nDIRECTOR CRITICAL TRAITS:\n${critical.length ? critical.map((x) => `- ${x}`).join("\n") : "Use the JSON directly."}\n\nPROMPT USED:\n${currentPrompt}`;

  const { text } = await callOpenRouter(
    apiKey,
    [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${stripDataUri(imageBase64)}` },
          },
        ],
      },
    ],
    { maxTokens: 2500, temperature: 0 },
  );
  
  const parsed = parseLooseJson(text);

if (!parsed) {
  return null;
}
  
  const score = clampInt(parsed.score, 0, 100, 0);
  return {
    criticalPass: parsed.critical_pass === true,
    score,
    checks: parsed.checks && typeof parsed.checks === "object" ? parsed.checks : {},
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 30) : [],
    correctedFluxPrompt: String(parsed.corrected_flux_prompt || "").trim(),
    raw: text,
  };
}

async function loadStyleReferences(admin: any) {
  const out: { blob: Blob; name: string }[] = [];
  for (const path of STYLE_REFERENCE_PATHS) {
    const { data, error } = await admin.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error(`RÃ©fÃ©rence artistique introuvable: ${path}`);
    out.push({ blob: data, name: path.split("/").pop() || "reference.jpg" });
  }
  return out;
}

function findCloudflareImage(data: any): string | null {
  const candidates = [
    data?.result?.image,
    data?.image,
    typeof data?.result === "string" ? data.result : null,
    data?.result?.images?.[0],
    data?.images?.[0],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 100) return stripDataUri(c);
  }
  return null;
}

function cloudflareErrorCode(data: any, raw: string) {
  const possible = [
    data?.errors?.[0]?.code,
    data?.error?.code,
    data?.code,
  ].filter((x) => x !== undefined && x !== null);
  if (possible.length) return String(possible[0]);
  const m = raw.match(/\b3030\b/);
  return m ? "3030" : "";
}

async function generateFlux(
  cfAccountId: string,
  cfToken: string,
  model: string,
  prompt: string,
  seed: number,
  refs: { blob: Blob; name: string }[],
) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${model}`;

  const run = async (p: string) => {
    const form = new FormData();
    form.append("prompt", p);
    form.append("width", String(WIDTH));
    form.append("height", String(HEIGHT));
    form.append("seed", String(seed));
    form.append("guidance", "4.0");

    refs.slice(0, 4).forEach((ref, i) => {
      form.append(`input_image_${i}`, ref.blob, ref.name);
    });

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfToken}` },
      body: form,
    });

    const raw = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch (_) {}

    const image = findCloudflareImage(data);
    if (r.ok && image) return { image, data, promptUsed: p };

    const code = cloudflareErrorCode(data, raw);
    const message = data?.errors?.[0]?.message || data?.error?.message || raw.slice(0, 700) || `HTTP ${r.status}`;
    const err: any = new Error(`Cloudflare ${r.status}${code ? ` code ${code}` : ""}: ${message}`);
    err.code = code;
    throw err;
  };

  try {
    return await run(prompt);
  } catch (e: any) {
    if (String(e?.code) !== "3030" && !String(e?.message || "").includes("3030")) throw e;
    const safer = neutralizeForCloudflare(prompt);
    return await run(safer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "POST required" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const CF_TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN") || "";
    const CF_ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "";
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ success: false, error: "Supabase environment variables missing" }, 500);
    }
    if (!CF_TOKEN || !CF_ACCOUNT_ID) {
      return jsonResponse({ success: false, error: "Cloudflare secrets missing" }, 500);
    }
    if (!OPENROUTER_API_KEY) {
      return jsonResponse({ success: false, error: "OPENROUTER_API_KEY missing" }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return jsonResponse({ success: false, error: "Missing Authorization header" }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    const user = authData?.user;
    if (authError || !user) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const body = await req.json();
    const storageCharacterId = cleanId(body?.characterId, "character");
    const displayCharacterId = cleanId(body?.displayCharacterId, storageCharacterId);
    const portraitNumber = clampInt(body?.portraitNumber, 1, 9999, 1);
    const generationMode = body?.generationMode === "champion" ? "champion" : "normal";
    const championSeason = body?.championSeason ?? null;
    const seed = clampInt(body?.seed, 1, 2147483646, Math.floor(Math.random() * 2147483646) + 1);
    const character = body?.character && typeof body.character === "object" ? body.character : null;
    const legacyPrompt = String(body?.prompt || "").trim();

    if (!character && !legacyPrompt) {
      return jsonResponse({ success: false, error: "Character JSON or prompt required" }, 400);
    }

    const warnings: string[] = [];
    let director: any = null;
    let fluxPrompt = legacyPrompt;

    if (character) {
      try {
        director = await buildDirectorPrompt(OPENROUTER_API_KEY, character, legacyPrompt);
        fluxPrompt = director.fluxPrompt;
      } catch (e: any) {
        warnings.push(`Ling director unavailable: ${String(e?.message || e).slice(0, 300)}`);
        if (!fluxPrompt) throw e;
      }
    }

    if (!fluxPrompt) throw new Error("No image prompt available.");

    const refs = await loadStyleReferences(admin);
    const model = generationMode === "champion" ? CF_MODEL_CHAMPION : CF_MODEL_NORMAL;

    const first = await generateFlux(CF_ACCOUNT_ID, CF_TOKEN, model, fluxPrompt, seed, refs);
    let chosen = first;
    let chosenPrompt = first.promptUsed;
    let firstValidation: any = null;
    let secondValidation: any = null;
    let attempts = 1;

    if (character) {
      try {
        firstValidation = await validatePortrait(
          OPENROUTER_API_KEY,
          character,
          director?.critical || [],
          chosenPrompt,
          first.image,
        );
      } catch (e: any) {
        warnings.push(`Ling validator unavailable: ${String(e?.message || e).slice(0, 300)}`);
      }

      const firstPass = !!firstValidation?.criticalPass && Number(firstValidation?.score || 0) >= VALIDATION_SCORE_MIN;

      if (firstValidation && !firstPass) {
        const correction = String(firstValidation.correctedFluxPrompt || "").trim();
        if (correction) {
          attempts = 2;
          const correctionPrompt = `${correction}\n\nReference images 0-3 are style references only. Preserve the generated character data; do not copy subjects or specific traits from the references.`;
          const second = await generateFlux(
            CF_ACCOUNT_ID,
            CF_TOKEN,
            model,
            correctionPrompt,
            seed === 2147483646 ? 1 : seed + 1,
            refs,
          );

          try {
            secondValidation = await validatePortrait(
              OPENROUTER_API_KEY,
              character,
              director?.critical || [],
              second.promptUsed,
              second.image,
            );
          } catch (e: any) {
            warnings.push(`Ling second validation unavailable: ${String(e?.message || e).slice(0, 300)}`);
          }

          const s1 = Number(firstValidation?.score || 0);
          const s2 = Number(secondValidation?.score || 0);
          const secondPass = !!secondValidation?.criticalPass && s2 >= VALIDATION_SCORE_MIN;
          const firstStrictPass = !!firstValidation?.criticalPass && s1 >= VALIDATION_SCORE_MIN;

          if (secondPass || (!firstStrictPass && secondValidation && s2 > s1)) {
            chosen = second;
            chosenPrompt = second.promptUsed;
          }
        }
      }
    }

    const chosenValidation = chosen === first ? firstValidation : secondValidation;

    console.log("PORTRAIT_VALIDATION", JSON.stringify({
  characterId: displayCharacterId,
  hasCharacter: !!character,
  hasLegacyPrompt: !!legacyPrompt,
  attempts,
  chosenAttempt: chosen === first ? 1 : 2,
  firstValidation,
  secondValidation,
  warnings,
}));
    
    const needsReview = !!character && (
  !chosenValidation ||
  !(
    chosenValidation.criticalPass &&
    Number(chosenValidation.score || 0) >= VALIDATION_SCORE_MIN
  )
);

    const filename = generationMode === "champion"
      ? `${displayCharacterId}-Champion.png`
      : `${displayCharacterId}-Portrait_${portraitNumber}.png`;
    const path = `${user.id}/characters/${storageCharacterId}/${filename}`;
    const bytes = base64ToBytes(chosen.image);

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: "image/png",
        upsert: true,
        cacheControl: "3600",
      });

    if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);

    return jsonResponse({
      success: true,
      path,
      model,
      directorModel: character ? OPENROUTER_MODEL : null,
      validatorModel: character ? OPENROUTER_MODEL : null,
      portraitNumber,
      generationMode,
      championSeason,
      seed,
      width: WIDTH,
      height: HEIGHT,
      attempts,
      validation: chosenValidation
        ? {
            criticalPass: chosenValidation.criticalPass,
            score: chosenValidation.score,
            checks: chosenValidation.checks,
            issues: chosenValidation.issues,
            needsReview,
          }
        : null,
      warnings,
      promptSource: director ? "ling-director" : "legacy-fallback",
      finalPrompt: chosenPrompt,
    });
  } catch (e: any) {
    console.error("Generate-character-image error", e);
    return jsonResponse(
      { success: false, error: String(e?.message || e).slice(0, 1200) },
      500,
    );
  }
});
