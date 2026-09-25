import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const CF_MODEL_NORMAL = "@cf/black-forest-labs/flux-2-klein-4b";
const CF_MODEL_CHAMPION = "@cf/black-forest-labs/flux-2-klein-9b";
const BUCKET = "character-images";
const WIDTH = 512;
const HEIGHT = 1024;
const VALIDATION_SCORE_MIN = 80;

const SITE_BASE_URL = "https://piaultdamien-gif.github.io/Roue-de-la-fortune";
const RACE_ASSET_BASE = `${SITE_BASE_URL}/assets/universe/races`;
const REGION_ASSET_BASE = `${SITE_BASE_URL}/assets/universe/regions`;

const RACE_FILE_MAP: Record<string, string> = {
  "Dragon humanoïde": "dragon",
  "Dragon originel": "dragon-originel",
  "Dragon ancestral": "dragon-ancestral",
  "Titan": "titan",
  "Titan primordial": "titan-primordial",
  "Titan fondateur": "titan-fondateur",
  "Neoxus": "neoxus",
  "N.E.X.U.S.": "nexus",
  "Cyborg": "cyborg",
  "Golem / Artificiel": "artificiel",
  "Demi-dieu": "demi-dieu",
  "Divinité": "divinite",
  "Dieu céleste": "dieu-celeste",
  "Homme-bête": "homme-bete",
  "Hybride": "hybride",
  "Squelette": "squelette",
  "Liche": "liche",
  "Extraterrestre": "extraterrestre",
  "Loup-garou": "loup-garou",
  "Deus Machina": "deus-machina",
  "Titan céleste": "titan-celeste",
  "Colosse Nexus": "colosse-nexus",
  "Drakéon": "drakeon",
  "Nexaryx": "nexaryx",
  "Tyrakhan": "tyrakhan",
};

const REGION_FILE_MAP: Record<string, string> = {
  "Mor'Khal": "morkhal",
  "Mor’Khal": "morkhal",
};

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

function geminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
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
  // Fallback used ONLY after Cloudflare returns error 3030.
  // Keep ordinary dark-fantasy visual vocabulary intact (blood, scars, wounds,
  // injuries, bleeding, flesh, death, vampire, regeneration, etc.) so Flux can
  // represent the JSON faithfully. Neutralize only unusually graphic/anatomical
  // formulations that are more likely to trigger the provider filter.
  return String(prompt || "")
    .replace(/life[- ]?drain(?:ing)?/gi, "subtle dark arcane siphoning effect")
    .replace(/extra organ nodules?/gi, "subtle unusual fantasy forms")
    .replace(/layered tissue lumps?/gi, "layered fantasy forms")
    .replace(/tissue lumps?/gi, "fantasy forms")
    .replace(/organ nodules?/gi, "fantasy structures")
    .replace(/thin translucent membranes?/gi, "soft translucent fantasy surfaces")
    .replace(/restraint shackles/gi, "arcane connection")
    .slice(0, 7000);
}

async function callGemini(
  apiKey: string,
  systemInstruction: string,
  parts: any[],
  opts: { maxTokens?: number; temperature?: number } = {},
) {
  const maxAttempts = 3;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: opts.temperature ?? 0.2,
          maxOutputTokens: opts.maxTokens ?? 3500,
          responseMimeType: "application/json",
        },
      }),
    });

    const raw = await r.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch (_) {}

    if (r.ok) {
      const text = geminiText(data);
      if (text) return { text, data };
      if (attempt === maxAttempts) throw new Error("Gemini a renvoyé une réponse vide.");
    } else if (r.status !== 429 || attempt === maxAttempts) {
      throw new Error(`Gemini ${r.status}: ${data?.error?.message || raw.slice(0, 500)}`);
    }

    const delayMs = attempt * 2000;
    console.log(`GEMINI_RETRY attempt=${attempt}/${maxAttempts} status=${r.status} delay=${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error("Gemini indisponible après plusieurs tentatives.");
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
- Write the FLUX prompt as natural, coherent descriptive prose: a short visual narrative describing the character, action/pose, clothing/equipment, supernatural effects, and environment in a logical order. Prefer complete descriptive sentences and connected clauses over comma-separated keyword piles, tag lists, or booru-style prompting.
- Integrate every important visually representable source fact into that narrative instead of merely appending isolated keywords. Repeat a crucial fact naturally only when needed for clarity, but avoid contradictory or redundant descriptors.
- Do not overload the image with every statistic or abstract mechanic.
- No written or pseudo-written text anywhere: no words, letters, numbers, names, labels, logos, UI, watermark, poster/card typography, or text-like runes.
- Full body vertical portrait, head and feet visible, dark fantasy + science-fiction production art.
- FLUX may receive canonical visual references selected specifically for THIS character. Race reference image(s) are authoritative only for racial anatomy, morphology, and species markers. Never copy their clothing, pose, weapon, identity, or background unless the source JSON independently requires it.
- A region reference image is authoritative only for the environment: landscape, architecture, vegetation, climate, atmosphere, and regional visual identity. It must NEVER alter the character's race, anatomy, face, body, or species markers.
- The source character's clothingStyle is a strong visual requirement: make the outfit visibly follow that clothing style through cut, materials, ornamentation, layering, and silhouette while remaining coherent with explicit equipment.
- Keep the overall rendering dark-fantasy / science-fiction cinematic production art without relying on unrelated style-reference characters.

Return ONLY valid JSON with this exact shape:
{
  "critical": ["..."],
  "secondary": ["..."],
  "non_visual": ["..."],
  "flux_prompt": "one complete concise English image prompt"
}`;

  const user = `CHARACTER JSON:\n${JSON.stringify(character, null, 2)}\n\nA legacy hand-written prompt is included only as a fallback/reference for terminology. Do not blindly copy it and do not let it override the JSON:\n${legacyPrompt || "(none)"}`;

  const { text, data } = await callGemini(
    apiKey,
    system,
    [{ text: user }],
    { maxTokens: 3500, temperature: 0.2 },
  );

  const parsed = parseLooseJson(text);
  const fluxPrompt = String(parsed?.flux_prompt || extractFluxPromptFromText(text) || "").trim();
  if (!fluxPrompt) {
  console.log("DIRECTOR_PARSE_FAILED", JSON.stringify({
    textLength: text.length,
    parsed: !!parsed,
    finish: data?.candidates?.[0]?.finishReason ?? null,
    hasContent: !!data?.candidates?.[0]?.content?.parts?.length,
    contentPreview: text.slice(0, 500),
  }));
  throw new Error("Gemini n'a pas produit de FLUX prompt exploitable.");
  }

  return {
    critical: Array.isArray(parsed?.critical) ? parsed.critical.map(String).slice(0, 30) : [],
    secondary: Array.isArray(parsed?.secondary) ? parsed.secondary.map(String).slice(0, 30) : [],
    nonVisual: Array.isArray(parsed?.non_visual) ? parsed.non_visual.map(String).slice(0, 30) : [],
    fluxPrompt: `${fluxPrompt}\n\nReference images 0-3 are canonical character/region references selected for this character. Race references govern racial anatomy only; the region reference governs environment only. Preserve the generated character data and do not copy unrelated clothing, pose, weapon, or identity from references.`,
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
- Any corrected_flux_prompt must also be written as natural, coherent descriptive prose with complete sentences/connected clauses, not as a stack of keywords or tags. Weave the required corrections into the visual narrative.

SOURCE-OF-TRUTH RULES:
- Only facts explicitly present in SOURCE CHARACTER JSON may be treated as required character traits.
- Details invented, inferred, expanded, or embellished by the director or FLUX prompt are artistic suggestions only.
- Never mark an image as wrong, weak, or missing because it omits or changes an invented prompt detail.
- Do not invent exact quantities when the source JSON gives none. For example, a Clonage power requires cloning to be visually represented when relevant, but does not require exactly three clones unless the source JSON explicitly says three.
- Job, archetype, history, personality, power, and other abstract fields may guide visual interpretation, but invented clothing, equipment, scenery, symbols, trophies, tools, poses, or environmental details derived from them are not mandatory.
- Evaluate critical accuracy primarily against SOURCE CHARACTER JSON, not against embellishments in the FLUX prompt.
- When writing corrected_flux_prompt, never introduce an alternative, synonym, creature type, weapon type, anatomical trait, or visual interpretation that could contradict the SOURCE CHARACTER JSON. If the source gives a precise category, preserve that category strictly and do not broaden it with incompatible examples.

Return ONLY valid JSON:
{
  "critical_pass": true,
  "score": 0,
  "checks": {"trait": "pass | weak | missing | wrong"},
  "issues": ["..."],
  "corrected_flux_prompt": "complete replacement prompt, or empty string if no correction is needed"
}`;

  const userText = `SOURCE CHARACTER JSON:\n${JSON.stringify(character, null, 2)}\n\nVALIDATION SOURCE:
Use only the SOURCE CHARACTER JSON and the generated image as authoritative evidence.
Do not treat the director interpretation or generation prompt as validation requirements.`;

  const { text, data } = await callGemini(
    apiKey,
    system,
    [
      { text: userText },
      { inlineData: { mimeType: "image/png", data: stripDataUri(imageBase64) } },
    ],
    { maxTokens: 3500, temperature: 0 },
  );
  
  const parsed = parseLooseJson(text);

if (!parsed) {
  console.log("VALIDATOR_PARSE_FAILED", JSON.stringify({
    textLength: text.length,
    finish: data?.candidates?.[0]?.finishReason ?? null,
    hasContent: !!data?.candidates?.[0]?.content?.parts?.length,
    contentPreview: text.slice(0, 700),
  }));

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

function assetSlug(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function raceAssetSlug(name: string) {
  return RACE_FILE_MAP[name] || assetSlug(name);
}

function regionAssetSlug(name: string) {
  return REGION_FILE_MAP[name] || assetSlug(name);
}

function uniqueStrings(values: unknown[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const v = String(value ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function requestedRaceReferences(character: any): string[] {
  const finalRace = String(character?.race || "").trim();
  const parts = Array.isArray(character?.raceParts)
    ? character.raceParts.map((x: any) => String(x ?? "").trim()).filter(Boolean)
    : [];

  // A special final cross has its own canonical portrait. For draconic crosses,
  // select only the branch actually requested by the generated character.
  const special = ["Deus Machina", "Titan céleste", "Colosse Nexus", "Drakéon", "Nexaryx", "Tyrakhan"]
    .find((x) => finalRace.includes(x) || parts.includes(x));
  if (special) {
    if (["Drakéon", "Nexaryx", "Tyrakhan"].includes(special)) {
      const lineageText = JSON.stringify(character?.lineage || {}) + " " + finalRace + " " + parts.join(" ");
      if (/originel/i.test(lineageText)) return [`${raceAssetSlug(special)}-originel`];
      if (/ancestral/i.test(lineageText)) return [`${raceAssetSlug(special)}-ancestral`];
    }
    return [raceAssetSlug(special)];
  }

  // For a true hybrid, use only its actual biological components rather than
  // the generic Hybride codex portrait. States/forms are kept only when they
  // are explicitly part of the requested final race.
  const stateLike = new Set(["Hybride"]);
  let names = parts.filter((x: string) => !stateLike.has(x));
  if (!names.length && finalRace) {
    // Exact known race first; otherwise split common composite display strings.
    if (RACE_FILE_MAP[finalRace]) names = [finalRace];
    else names = finalRace.split(/\s*\/\s*|\s*\+\s*/).filter(Boolean);
  }

  // Never send unrelated race images. Maximum three race references leaves
  // one FLUX slot for the character's region reference.
  return uniqueStrings(names).map(raceAssetSlug).filter(Boolean).slice(0, 3);
}

async function fetchReference(url: string, name: string) {
  const r = await fetch(url, { headers: { Accept: "image/webp,image/*" } });
  if (!r.ok) throw new Error(`${name} (${r.status})`);
  return { blob: await r.blob(), name };
}

async function loadCharacterReferences(character: any, warnings: string[]) {
  const refs: { blob: Blob; name: string }[] = [];
  const raceSlugs = requestedRaceReferences(character);

  for (const slug of raceSlugs) {
    const name = `${slug}.webp`;
    try {
      refs.push(await fetchReference(`${RACE_ASSET_BASE}/${encodeURIComponent(name)}`, `race-${name}`));
    } catch (e: any) {
      warnings.push(`Race reference unavailable: ${name} — ${String(e?.message || e).slice(0, 180)}`);
    }
  }

  const region = String(character?.birthRegion || character?.region || "").trim();
  if (region && refs.length < 4) {
    const slug = regionAssetSlug(region);
    const name = `${slug}.webp`;
    try {
      refs.push(await fetchReference(`${REGION_ASSET_BASE}/${encodeURIComponent(name)}`, `region-${name}`));
    } catch (e: any) {
      warnings.push(`Region reference unavailable: ${name} — ${String(e?.message || e).slice(0, 180)}`);
    }
  }

  console.log("CHARACTER_REFERENCES", JSON.stringify({
    race: character?.race ?? null,
    raceParts: character?.raceParts ?? null,
    region: region || null,
    clothingStyle: character?.clothingStyle ?? null,
    references: refs.map((x) => x.name),
  }));

  return refs;
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

  const run = async (p: string, runSeed = seed, includeRefs = true) => {
    const form = new FormData();
    form.append("prompt", p);
    form.append("width", String(WIDTH));
    form.append("height", String(HEIGHT));
    form.append("seed", String(runSeed));
    form.append("guidance", "4.0");

    if (includeRefs) {
  refs.slice(0, 4).forEach((ref, i) => {
    form.append(`input_image_${i}`, ref.blob, ref.name);
  });
}

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
  if (
    String(e?.code) !== "3030" &&
    !String(e?.message || "").includes("3030")
  ) {
    throw e;
  }

  const safer = neutralizeForCloudflare(prompt);

  try {
    return await run(safer, seed + 1);
  } catch (e2: any) {
    const is3030 =
      String(e2?.code) === "3030" ||
      String(e2?.message || "").includes("3030");

    if (!is3030) {
      throw e2;
    }

    try {
      return await run(safer, seed + 2, false);
    } catch (e3: any) {
      console.log(
        "CLOUDFLARE_3030_AFTER_NEUTRALIZE",
        JSON.stringify({
          characterPromptLength: prompt.length,
          saferPromptLength: safer.length,
          saferPreview: safer.slice(0, 1500),
          error: String(e3?.message || e3),
        }),
      );

      throw e3;
    }
  }
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
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ success: false, error: "Supabase environment variables missing" }, 500);
    }
    if (!CF_TOKEN || !CF_ACCOUNT_ID) {
      return jsonResponse({ success: false, error: "Cloudflare secrets missing" }, 500);
    }
    if (!GEMINI_API_KEY) {
      return jsonResponse({ success: false, error: "GEMINI_API_KEY missing" }, 500);
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
    const correctionMode = body?.correctionMode === true;
    const previousValidationScore = Number(body?.previousValidationScore ?? -1);
    const previousCriticalPass = body?.previousCriticalPass === true;
    const incomingCorrectionPrompt = String(body?.correctionPrompt || "").trim();
    const storageCharacterId = cleanId(body?.characterId, "character");
    const displayCharacterId = cleanId(body?.displayCharacterId, storageCharacterId);
    const characterInstanceId = cleanId(body?.characterInstanceId ?? body?.character?.instanceId, "legacy");
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
    let fluxPrompt = correctionMode && incomingCorrectionPrompt
  ? incomingCorrectionPrompt
  : legacyPrompt;

    if (character && !correctionMode) {
      try {
        director = await buildDirectorPrompt(GEMINI_API_KEY, character, legacyPrompt);
        fluxPrompt = director.fluxPrompt;
      } catch (e: any) {
        warnings.push(`Gemini director unavailable: ${String(e?.message || e).slice(0, 300)}`);
        if (!fluxPrompt) throw e;
      }
    }

    if (!fluxPrompt) throw new Error("No image prompt available.");

    const refs = character ? await loadCharacterReferences(character, warnings) : [];
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
          GEMINI_API_KEY,
          character,
          director?.critical || [],
          chosenPrompt,
          first.image,
        );
      } catch (e: any) {
        warnings.push(`Gemini validator unavailable: ${String(e?.message || e).slice(0, 300)}`);
      }

      const firstPass = !!firstValidation?.criticalPass && Number(firstValidation?.score || 0) >= VALIDATION_SCORE_MIN;

        if (false && firstValidation && !firstPass) {
        const correction = String(firstValidation.correctedFluxPrompt || "").trim();
        if (correction) {
          attempts = 2;
          const correctionPrompt = `${correction}

CORRECTION PRIORITY:
This is a corrective regeneration. The previous image failed visual validation.
Treat every correction stated above as mandatory, not optional.
Explicitly fix every trait described as wrong, missing, weak, failed, or critical.
Do not preserve an incorrect visual interpretation from the previous image.
For weapons, species anatomy, body type, age, scale, familiar, and distinctive physical traits, prioritize literal visual accuracy over artistic interpretation.
If the requested weapon is a specific weapon type, its silhouette must be unmistakably that weapon type and must not resemble another weapon category.

SCALE CORRECTION:
When relative size or height failed validation, make the size relationship visually undeniable.
Use a physically explicit scale composition.
If the protagonist is much smaller than a normal adult, place the protagonist on a raised object such as a desk, table, crate, or pedestal while the normal adult stands on the floor beside it.
The smaller character must still occupy clearly less vertical image space than the larger character.
Do not place both characters on the same ground plane when this makes the size relationship ambiguous.
Never enlarge the protagonist merely because they are the main subject.
If an exact height is specified, preserve it visually through clear relative scale cues.

Reference images 0-3 are canonical character/region references selected for this character. Race references govern racial anatomy only; the region reference governs environment only. Preserve the generated character data and do not copy unrelated clothing, pose, weapon, or identity from references.`;
          
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
              GEMINI_API_KEY,
              character,
              director?.critical || [],
              second.promptUsed,
              second.image,
            );
          } catch (e: any) {
            warnings.push(`Gemini second validation unavailable: ${String(e?.message || e).slice(0, 300)}`);
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

    if (
  correctionMode &&
  chosenValidation &&
  previousValidationScore >= 0
) {
  const correctionScore = Number(chosenValidation.score || 0);
  const correctionPass =
    !!chosenValidation.criticalPass &&
    correctionScore >= VALIDATION_SCORE_MIN;

  const previousPass =
    previousCriticalPass &&
    previousValidationScore >= VALIDATION_SCORE_MIN;

  if (!correctionPass && (previousPass || correctionScore <= previousValidationScore)) {
    return jsonResponse({
      success: false,
      correctionRejected: true,
      reason: "Correction validation worse than previous portrait",
      previousScore: previousValidationScore,
      correctionScore,
    });
  }
    }

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

    // Immutable creation identity prevents a newly-created Sx-xxx from ever
    // colliding with portraits belonging to a previously deleted Sx-xxx.
    const portraitIdentity = characterInstanceId === "legacy"
      ? displayCharacterId
      : `${displayCharacterId}__${characterInstanceId}`;
    const filename = generationMode === "champion"
      ? `${portraitIdentity}-Champion.png`
      : `${portraitIdentity}-Portrait_${portraitNumber}.png`;
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

    const correctionRequested = !!(
  character &&
  firstValidation &&
  needsReview &&
  firstValidation.correctedFluxPrompt
);

    const correctionPromptForNextRequest =
  correctionRequested
    ? String(firstValidation.correctedFluxPrompt || "")
    : "";
    
    return jsonResponse({
      success: true,
      path,
      characterInstanceId,
      model,
      directorModel: character ? GEMINI_MODEL : null,
      validatorModel: character ? GEMINI_MODEL : null,
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
            correctionRequested,
            correctionPromptForNextRequest,
          }
        : null,
      warnings,
      promptSource: director ? "gemini-director" : "legacy-fallback",
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
