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


function superiorCanonVisualContract(character: any): string[] {
  const race = String(character?.race || "").trim();
  const parts = Array.isArray(character?.raceParts) ? character.raceParts.map((x: any) => String(x ?? "").trim()) : [];
  const lineage = character?.lineage && typeof character.lineage === "object" ? character.lineage : {};
  const haystack = `${race} ${parts.join(" ")} ${JSON.stringify(lineage)}`;
  const rules: string[] = [];

  const valuesForKeys = (obj: any, keyRx: RegExp, out: string[] = []): string[] => {
    if (!obj || typeof obj !== "object") return out;
    if (Array.isArray(obj)) { for (const v of obj) valuesForKeys(v, keyRx, out); return out; }
    for (const [k, v] of Object.entries(obj)) {
      if (keyRx.test(k)) {
        if (Array.isArray(v)) for (const x of v) if (x != null && typeof x !== "object") out.push(String(x));
        else if (v != null && typeof v !== "object") out.push(String(v));
      }
      if (v && typeof v === "object") valuesForKeys(v, keyRx, out);
    }
    return out;
  };

  const domains = uniqueStrings([
    ...valuesForKeys(lineage, /divine.*domain|domain.*divine|divineDomain|domains?/i),
    ...(Array.isArray(character?.powers) ? character.powers
      .map((x: any) => String(x?.name ?? x?.power ?? x ?? ""))
      .filter((x: string) => /^(Guerre|Protection|Nature|Vie|Mort|Savoir|Magie|Justice|Liberté|Destin|Rêves|Océans|Terre|Ciel|Tempêtes|Feu|Lumière|Ténèbres|Temps|Espace)$/i.test(x.trim())) : [])
  ]);
  const affinity = uniqueStrings(valuesForKeys(lineage, /affinit|origin.*primord|titanOrigin/i))[0] || "";

  if (/Dieu céleste/i.test(haystack)) {
    const d = domains.length ? domains.join(" + ") : "the character's generated divine domain(s)";
    rules.push(`CELESTIAL GOD — mandatory anatomy: exactly four arms; a fully manifested monumental Divine Wheel centered behind the back; and a supernatural thoracic cavity. The Divine Wheel is not decorative: its material, symbols, energy and structure must visibly embody ALL generated divine domains (${d}) in ONE coherent wheel. It must be clearly visible and must not be hidden by the body, weapon, clothing, effects or background. The thoracic cavity must also visually reflect the domain identity where coherent.`);
  } else if (/(^|\\b)Divinité(\\b|$)/i.test(haystack)) {
    const d = domains.length ? domains.join(" + ") : "the character's generated divine domain(s)";
    rules.push(`DIVINITY — mandatory anatomy: humanoid with exactly two arms; a true Divine Wheel behind the body, visibly incomplete, fragmented or partly energetic. Its appearance must visibly express ALL generated divine domains (${d}) rather than being a generic halo.`);
  } else if (/Demi-dieu/i.test(haystack)) {
    const d = domains.length ? domains.join(" + ") : "the character's generated divine domain(s)";
    rules.push(`DEMIGOD — mandatory divine markers: humanoid with exactly two arms; visible bodily signs tied to the generated divine domain(s) (${d}), including a discreet thoracic mark. It must NOT have a complete Divine Wheel; only unstable fragments may foreshadow one.`);
  }

  if (/Dragon ancestral/i.test(haystack)) {
    rules.push(`ANCESTRAL DRAGON — mandatory anatomy: a true fully non-humanoid dragon with exactly four legs plus exactly two wings, a long tail, robust neck and colossal draconic body. Its generated affinity must physically permeate and transform breath, claws, scales and body through Incarnation primordiale; do not depict it as a humanoid dragon.`);
  }
  if (/Dragon originel/i.test(haystack)) {
    rules.push(`ORIGINAL DRAGON — mandatory anatomy: a true non-humanoid, very long serpentine dragon with exactly four limbs and absolutely no wings. Include horns, mane, long sensory structures and translucent biological ribbon-like structures resembling living glass. Its generated affinity is externally projected and controlled through Domination primordiale.`);
  }
  if (/Dragon humanoïde/i.test(haystack) && !/Dragon ancestral|Dragon originel/i.test(haystack)) {
    rules.push(`HUMANOID DRAGON — keep the body primarily humanoid while visibly preserving genuine draconic biological traits supported by the character data/reference. Do not silently convert it into a full dragon.`);
  }

  if (/Neoxus/i.test(haystack) && !/N\\.E\\.X\\.U\\.S/i.test(haystack)) {
    rules.push(`NEOXUS — mandatory species markers: techno-organic humanoid with black/graphite/dark blue skin, fine luminous golden subcutaneous lines, star-filled cosmic eyes, exactly four fingers per hand, characteristic organic cranial structures, and naturally grown living techno-organic structures. These are intrinsic anatomy, not clothing or generic glowing effects.`);
  } else if (/N\\.E\\.X\\.U\\.S/i.test(haystack)) {
    rules.push(`N.E.X.U.S. — mandatory intermediate Nexus biology: visibly fused biology and living technology; graphite/gray-black/dark-blue tissues with a developing golden subcutaneous network and increasingly cosmic eyes. Generated techno-organic structures must look grown from the body, able to adapt/heal, not like ordinary strapped-on machinery.`);
  } else if (/Cyborg/i.test(haystack)) {
    rules.push(`CYBORG — the non-Neoxus biological ancestry remains dominant. Generated augmentations are artificial cybernetic additions integrated unusually well with living tissue; the body does NOT naturally grow full living Neoxus technology. Hands normally retain five fingers.`);
  }

  if (/Titan fondateur/i.test(haystack)) {
    rules.push(`FOUNDER TITAN — mandatory scale and body identity: a vaguely humanoid organism 1–5 km tall, profoundly transformed by extreme biomineralization, with living flesh fused with geological matter. The body must read like a moving landform while remaining an organism. Force tellurique and Ancrage tellurique are intrinsic.`);
  } else if (/Titan primordial/i.test(haystack)) {
    rules.push(`PRIMORDIAL TITAN — mandatory scale and body identity: a recognizable humanoid giant 200–500 m tall with advanced biomineralization. Its primordial origin/affinity${affinity ? ` (${affinity})` : ""} must visibly alter tissues, organs and mineral structures so the body itself is a living expression of that natural force, not merely a humanoid casting an elemental spell.`);
  } else if (/(^|\\b)Titan(\\b|$)/i.test(haystack)) {
    rules.push(`TITAN — mandatory scale and body identity: an intelligent humanoid giant 15–40 m tall with skeleton, musculature and skin visibly adapted to gigantism and small biomineralized zones on heavily stressed body areas. Its generated affinity${affinity ? ` (${affinity})` : ""} must have a visible biological/power expression.`);
  }

  return uniqueStrings(rules);
}

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

async function buildDirectorPrompt(apiKey: string, character: any) {
  const system = `You are the art director for a procedural dark-fantasy / science-fiction character generator.
Your job is to convert raw character JSON into a concise, highly effective English image prompt for FLUX.2 Klein 4B.

The system generates many radically different characters. Apply every rule GENERICALLY from the supplied JSON. Never assume that examples or characteristics mentioned here are present unless they actually appear in the current character data.

CORE PRINCIPLE — SHOW, DON'T LABEL
FLUX must be told what to DRAW, not merely what a concept is called. For every important visually representable fact: identify the exact source fact; determine what a viewer could actually see; translate it into concrete visual manifestations; and include those manifestations in the FLUX prompt if the fact is CRITICAL. Examples illustrate reasoning only and must never be copied unless supported by the current JSON.

VISUAL PRIORITY
CRITICAL includes every explicit fact whose absence would make the illustrated character meaningfully less faithful or recognizable. This may include race/species and components, racial state/lineage, important active transformations, gender when visually relevant, unusual height/scale, body morphology, visible age, distinctive signs, dominant colors, clothing style, weapons/major equipment, visually expressible job, visible History consequences, curses/blessings, visible Extras, familiars/summons/clones/required companions, important powers and elemental identity. Do not make a field critical merely because it exists: it must have a meaningful visual consequence.
SECONDARY includes supporting information such as archetype pose/demeanor, personality when useful, culture beyond explicit clothing, regional environment, atmosphere, minor equipment and secondary consequences.
NON_VISUAL is only for information that genuinely should not be directly represented: names, titles when text is forbidden, raw combat statistics, IDs, internal metadata and mechanics with no visible consequence. Never discard a visible consequence merely because its parent mechanic is abstract.

SOURCE VS CONSEQUENCE
A History or Extra name may be abstract while its consequence is visual. A mastery/intensity value is not literal text but can guide visual prominence. Preserve the visual consequence.

MECHANICAL VALUES AND VISUAL STRENGTH
Raw Combat/Force/Intelligence/Résilience/Vitesse/Pouvoir/Arme statistics are non-visual unless the source explicitly defines a visible consequence. A value describing intensity, mastery, severity or magnitude of a visually representable effect is VISUAL GUIDANCE: associate it with that source fact, use it to calibrate prominence/control/intensity, and never display the number. Interpret values relative to the scale provided by the data; do not assume every scale has the same maximum.

RACIAL VISUAL TRAITS — NON-NEGOTIABLE
If the character JSON contains a racialVisualTraits field, every item in that field is authoritative canonical visual information for this specific character and MUST be classified as CRITICAL.

Treat each racialVisualTraits entry as a literal visual constraint. Do not summarize several traits into a weaker generic description, omit one because another seems similar, or replace required anatomy with symbolism.

Exact anatomical counts must remain exact. Explicitly forbidden anatomy must remain absent. Required physical forms, openings, cavities, structures and spatial relationships must remain literal. A physical cavity must remain a real cavity; a physical structure must not become a generic aura, tattoo, magic circle, clothing decoration or armor ornament.

When racialVisualTraits says that one structure represents several domains, affinities or concepts, create ONE coherent structure combining all of them unless the JSON explicitly requires several structures.

CRITICAL-TO-PROMPT GUARANTEE — LOSSLESS TRANSFER
Every item classified as CRITICAL MUST be transferred into flux_prompt WITHOUT LOSS OF VISUAL INFORMATION.

The critical array is a binding visual specification for flux_prompt, not merely analysis.

For every CRITICAL item:
1. Write a precise visible_expression.
2. Transfer ALL visually meaningful information from that visible_expression into flux_prompt.
3. Do not shorten, generalize, merge or paraphrase it in a way that removes a visual requirement.
4. After writing flux_prompt, compare it against every critical.visible_expression individually.
5. If any visible detail present in critical.visible_expression is absent from flux_prompt, rewrite flux_prompt before answering.

A CRITICAL item is NOT successfully transferred merely because flux_prompt mentions the same general concept.

For racialVisualTraits specifically, every visually meaningful clause contained in every entry must survive into flux_prompt. You may rewrite the wording into natural English, but you may NOT remove visual information. If several racialVisualTraits describe the same structure, combine them only if every requirement from every source trait remains explicitly represented.

Do not optimize prompt length at the expense of CRITICAL information. Conciseness applies only AFTER every CRITICAL requirement has been preserved.

STRICT SOURCE FIDELITY
Preserve the generated character exactly. Strange, contradictory, unconventional or unexpected combinations are intentional. Never remove, weaken, normalize, beautify, resize, replace or reinterpret an explicit source fact for aesthetics. Preserve explicit morphology literally: corpulent stays corpulent, thin stays thin, muscular stays muscular, small stays small, giant stays giant. Apply the same fidelity to age, height, proportions, gender, race/components, anatomy, skin, signs, colors, clothing, equipment, weapons, transformations, companions and powers.

CONTROLLED VISUAL INVENTION
You may invent MINOR concrete details only when necessary to make an explicit source fact visually understandable. They must directly serve that fact, remain local, be plausible, not contradict explicit data, and not establish new canon/worldbuilding. You may choose a few plausible tools for an explicit profession or devise a coherent visible manifestation for an explicit supernatural effect. These are visual interpretations, not canonical facts.

DO NOT INVENT WORLDBUILDING
Do not invent unsupported canonical characteristics for races, cultures, regions, strata, factions, civilizations, religions, organizations, technologies, architecture, ecosystems, symbols or cultural motifs. A proper noun alone is not permission to invent its visual identity.

NAMES, TITLES AND IDENTIFIERS
Do not include character names, titles or IDs in flux_prompt unless they encode a visually necessary fact that cannot otherwise be expressed. Describe the character visually instead.

CANONICAL VISUAL REFERENCES
FLUX may receive canonical references selected specifically for the current character.
Race references are authoritative only for racial anatomy, morphology, biological characteristics, species markers and canonical racial identity. When supplied, do not invent unsupported anatomy that contradicts or competes with them. Never copy their clothing, pose, weapon, individual identity or background unless independently required by JSON.
RACE REFERENCE AUTHORITY: if a canonical race reference is supplied, do not invent skin color, body material, facial structure, anatomy or biological markers from the race name, powers, dominant palette, culture, clothing or environment. Derive intrinsic racial appearance from the supplied canonical race reference. Explicit JSON physical facts override the reference only where they directly specify that characteristic. Do not use an elemental power, clothing color or environment color as evidence for skin/anatomy coloration unless JSON explicitly assigns that color to the body.
NON-HUMAN RACIAL IDENTITY: when the character's race/species is non-human, the result must visibly read as that race even if all powers, magical effects, clothing, equipment and environmental effects were removed. Do not represent a non-human race as an ordinary human with racial effects, particles, glow, horns, markings or accessories merely added on top. The supplied canonical race reference must strongly govern the character's intrinsic anatomy, facial structure, skin/body material, proportions and biological species markers wherever applicable. Powers and elemental effects are separate visual layers and must never substitute for racial identity. For hybrids or multi-component races, preserve the explicit component combination and use the relevant canonical references without allowing one component to erase the others.
Region references are authoritative as a VISUAL VOCABULARY for landscape, architecture, vegetation, materials, climate, lighting and atmosphere. Build a fresh scene that clearly belongs to the same region, choosing a fresh viewpoint, spatial arrangement, landmark placement and environmental layout. Regional continuity should come from characteristic terrain, materials, architecture, vegetation, climate and atmosphere. The environment must remain clearly readable but secondary to the protagonist, with roughly 70% character emphasis and 30% environmental presence. A region reference guides environment only and must not alter character race, anatomy, face, morphology, body type, species markers, equipment, clothing or powers.
Reference priority: explicit JSON defines WHAT the character is; race references define unsupported canonical racial appearance; region references define unsupported canonical environment; controlled invention fills only small gaps needed for readability. Never let a reference overwrite explicit JSON.

DOMINANT COLORS
Dominant colors define the character's overall visual palette, primarily through clothing, equipment, accessories and visible effects where coherent. They do NOT automatically define skin, fur, scales, feathers, hair, eyes, flesh or other racial anatomy. Never recolor intrinsic anatomy from dominant colors unless the JSON explicitly assigns those colors to that body feature or the canonical race reference supports it.

CLOTHING
clothingStyle is a strong visual requirement. Make it influence overall cut, layering, silhouette, construction and reasonably inferable materials while remaining compatible with explicit equipment. Do not invent culture-specific symbols, motifs, heraldry, iconography, religious or faction markings merely from a culture name.

POWERS AND SUPERNATURAL EFFECTS
Describe concrete manifestations when visually important. Keep multiple effects distinguishable where possible and tie them to the relevant anatomy, object, action or source fact rather than collapsing everything into generic particles or auras.

CLONES, DOUBLES, FAMILIARS, SUMMONS AND COMPANIONS
If explicitly required and visually present, they must be clearly readable. Preserve required species, scale, number and required similarity/difference. A physical clone must read as a physical duplicate when required, not a ghost/reflection/shadow/aura. When the source requires an identical or physical clone, preserve the main character's intrinsic physical identity exactly: race/species markers, face, apparent age, body morphology, proportions, height/relative scale, skin/body material, hair and other distinctive physical signs. Do not make the clone slimmer, heavier, younger, older, more human, more attractive or otherwise morphologically different merely to create visual variety. A physical clone copies the BODY and intrinsic physical identity by default; do not infer equipment duplication from the word clone alone. Duplicate clothing, weapons or equipment only when the source data explicitly says the clone copies them. If equipment duplication is not explicitly stated, keep the clone physically identical while avoiding invented duplicate gear. Keep secondary figures compositionally subordinate unless source data requires otherwise.

SCALE
Scale is strict. Preserve explicit height and relative scale. Use companions/equipment/environment as natural scale cues when useful. Never resize another character merely to make composition easier.

COMPOSITION — CHARACTER FIRST
Write flux_prompt as natural coherent descriptive prose, never a keyword/tag pile. The main character is the primary visual subject. Spend most detail on anatomy, face, morphology, racial identity, signs, clothing, equipment, profession, powers, transformations, curses/blessings, Extras and other CRITICAL elements. Only then establish the environment. When a canonical region reference is supplied, make the background clearly belong to that region through its environmental vocabulary, while choosing a fresh viewpoint, spatial arrangement and landmark placement. Depict another plausible place within the same region. Preserve a character-first balance of roughly 70% character emphasis and 30% environmental presence. Environmental detail must never come at the expense of character detail.

PROMPT LENGTH AND EFFICIENCY
Be detailed enough to preserve every CRITICAL fact. Prefer efficient wording, but NEVER compress or remove information classified as CRITICAL. Eliminate redundancy only when the remaining wording preserves 100% of the visual requirements. Prompt brevity is subordinate to CRITICAL fidelity. Every sentence should contribute useful visual information.

STYLE AND FRAMING
Unless source data explicitly requires otherwise: full-body vertical portrait; entire head and feet visible; character clearly readable; cinematic dark-fantasy + science-fiction production art; highly detailed main subject; coherent lighting; environment visible but subordinate. Do not crop important equipment, wings, tails, companions or other required traits.

NO TEXT IN IMAGE
No written or pseudo-written text: no words, letters, numbers, names, titles, labels, logos, UI, watermark, captions, poster/card typography, readable inscriptions or text-like runes.

FINAL AUDIT
Before returning, internally verify all of the following.

LOSSLESS CRITICAL AUDIT: for each object in critical, read its visible_expression, identify every distinct drawable requirement contained in it, and locate each requirement in flux_prompt. Every requirement must have a clear match. If even one requirement has no match, flux_prompt is incomplete and MUST be rewritten before returning the JSON.

Every racialVisualTraits item must be CRITICAL and explicitly represented in flux_prompt. Exact anatomical counts must remain exact. Explicitly forbidden anatomy must remain absent. Required structures must preserve their specified physical form and location. Dynamic domains, affinities, animal traits, origins or other character-specific racial information must be visibly expressed whenever racialVisualTraits requires it.

Also verify: no CRITICAL item exists only as an abstract label; for every non-human character, mentally remove powers, magical effects, clothing and equipment and verify that the body itself would still clearly read as the required race/species according to the canonical race reference—if not, strengthen intrinsic racial anatomy in flux_prompt; for every required physical/identical clone, verify that its race, face, age, morphology, proportions and scale match the original unless the JSON explicitly says otherwise, and do not duplicate equipment unless explicitly required; verify that dominant colors have not been incorrectly transferred onto skin or racial anatomy; morphology/age/scale/race/anatomy/colors/equipment remain faithful; nothing was normalized or beautified; no unsupported racial/cultural/regional/factional/technological lore was invented; unsupported region/race specifics are left to canonical references; when a canonical region reference is supplied, flux_prompt requires a clearly recognizable regional identity together with a fresh camera angle, spatial arrangement and scene composition; no visible consequence was discarded because its parent mechanic is abstract; intensity/mastery/severity guides relevant effects without displaying numbers; multiple effects remain distinguishable; required secondary beings are represented; relative scale is faithful; environment stays secondary but meaningfully present; names/titles/IDs are omitted; prose is coherent; no written text is requested.

Do not return the answer until critical.visible_expression is fully represented in flux_prompt for every CRITICAL item. If any check fails, revise before answering.

Return ONLY valid JSON with this exact structure:
{
  "critical": [{"source_fact":"...","visible_expression":"..."}],
  "secondary": [{"source_fact":"...","visible_expression":"..."}],
  "non_visual": ["..."],
  "flux_prompt": "one complete concise English image prompt"
}`;

  const canonRules = superiorCanonVisualContract(character);
  const user = `CHARACTER JSON:\n${JSON.stringify(character, null, 2)}\n\nMANDATORY CANONICAL RACIAL VISUAL CONTRACT (derived from the project race lore for this character only):\n${canonRules.length ? canonRules.map((x, i) => `${i + 1}. ${x}`).join("\\n") : "No additional superior-lineage visual rule applies."}\n\nThe CHARACTER JSON remains authoritative for generated individual facts. If CHARACTER JSON contains racialVisualTraits, every entry is authoritative character-specific canon, MUST be treated as CRITICAL, and MUST be transferred losslessly into flux_prompt. The canonical racial contract is also authoritative for mandatory racial anatomy/identity. If these sources can coexist, preserve all of them; never weaken racialVisualTraits.`;

  const { text, data } = await callGemini(apiKey, system, [{ text: user }], { maxTokens: 4500, temperature: 0.2 });
  const parsed = parseLooseJson(text);
  const fluxPrompt = String(parsed?.flux_prompt || extractFluxPromptFromText(text) || "").trim();
  if (!fluxPrompt) {
    console.log("DIRECTOR_PARSE_FAILED", JSON.stringify({ textLength: text.length, parsed: !!parsed, finish: data?.candidates?.[0]?.finishReason ?? null, contentPreview: text.slice(0, 500) }));
    throw new Error("Gemini n'a pas produit de FLUX prompt exploitable.");
  }

  const normalizeVisualItems = (items: any) => Array.isArray(items)
    ? items.slice(0, 40).map((item: any) => {
        if (item && typeof item === "object") return {
          source_fact: String(item.source_fact || "").trim(),
          visible_expression: String(item.visible_expression || "").trim(),
        };
        return { source_fact: String(item ?? "").trim(), visible_expression: "" };
      }).filter((x: any) => x.source_fact)
    : [];

  return {
    critical: normalizeVisualItems(parsed?.critical),
    secondary: normalizeVisualItems(parsed?.secondary),
    nonVisual: Array.isArray(parsed?.non_visual) ? parsed.non_visual.map(String).slice(0, 40) : [],
    fluxPrompt,
    raw: text,
  };
}

async function validatePortrait(
  apiKey: string,
  character: any,
  critical: any[],
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
- Keep corrected prompts CHARACTER-FIRST as well: devote most fine detail to the character's anatomy, face, racial markers, clothing materials/layers, equipment and visible supernatural traits. Keep the environment identifiable but comparatively concise, and never let scenery consume detail that should belong to the character.

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

  const canonRules = superiorCanonVisualContract(character);
  const userText = `SOURCE CHARACTER JSON:\n${JSON.stringify(character, null, 2)}\n\nMANDATORY CANONICAL RACIAL VISUAL CONTRACT:\n${canonRules.length ? canonRules.map((x, i) => `${i + 1}. ${x}`).join("\n") : "No additional superior-lineage visual rule applies."}\n\nDIRECTOR CRITICAL VISUAL CONTRACT:\n${JSON.stringify(critical, null, 2)}\n\nVALIDATION SOURCE:
Use the SOURCE CHARACTER JSON, the MANDATORY CANONICAL RACIAL VISUAL CONTRACT, and the generated image as authoritative evidence.
The canonical racial contract defines mandatory race anatomy/identity and MUST be validated as strictly as explicit JSON facts.
Do not treat other director embellishments or generation-prompt inventions as validation requirements.`;

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

  const special = ["Deus Machina", "Titan céleste", "Colosse Nexus", "Drakéon", "Nexaryx", "Tyrakhan"]
    .find((x) => finalRace.includes(x) || parts.includes(x));

  let main: string[] = [];
  if (special) {
    if (["Drakéon", "Nexaryx", "Tyrakhan"].includes(special)) {
      const lineageText = JSON.stringify(character?.lineage || {}) + " " + finalRace + " " + parts.join(" ");
      if (/originel/i.test(lineageText)) main = [`${raceAssetSlug(special)}-originel`];
      else if (/ancestral/i.test(lineageText)) main = [`${raceAssetSlug(special)}-ancestral`];
      else main = [raceAssetSlug(special)];
    } else main = [raceAssetSlug(special)];
  } else {
    const stateLike = new Set(["Hybride"]);
    let names = parts.filter((x: string) => !stateLike.has(x));
    if (!names.length && finalRace) {
      if (RACE_FILE_MAP[finalRace]) names = [finalRace];
      else names = finalRace.split(/\s*\/\s*|\s*\+\s*/).filter(Boolean);
    }
    main = uniqueStrings(names).map(raceAssetSlug).filter(Boolean);
  }

  // Secondary visible beings can need their own canonical racial reference too.
  // They are considered only after the protagonist's race/component references.
  const secondaryNames: string[] = [];
  const addRace = (v: any) => {
    const value = String(v ?? "").trim();
    if (value) secondaryNames.push(value);
  };
  const scanBeing = (being: any) => {
    if (!being || typeof being !== "object") return;
    addRace(being.race);
    if (Array.isArray(being.raceParts)) being.raceParts.forEach(addRace);
  };
  scanBeing(character?.summon);
  scanBeing(character?.familiar);
  scanBeing(character?.companion);
  if (Array.isArray(character?.summons)) character.summons.forEach(scanBeing);
  if (Array.isArray(character?.familiars)) character.familiars.forEach(scanBeing);
  if (Array.isArray(character?.companions)) character.companions.forEach(scanBeing);

  // Reserve one of FLUX's four image slots for the region whenever possible.
  const secondary = uniqueStrings(secondaryNames).map(raceAssetSlug).filter(Boolean);
  return uniqueStrings([...main, ...secondary]).slice(0, 3);
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

  const safer = neutralizeForCloudflare(prompt)
    .replace(/without copying/gi, "with a fresh composition")
    .replace(/do not copy/gi, "use character-specific")
    .replace(/do not reproduce/gi, "choose fresh")
    .replace(/do not closely imitate/gi, "choose a distinct")
    .replace(/not composition templates/gi, "visual dictionaries")
    .replace(/scene duplication/gi, "regional continuity");

  console.log("CLOUDFLARE_3030_RETRY_WITH_REFERENCES", JSON.stringify({
    originalPromptLength: prompt.length,
    saferPromptLength: safer.length,
    referenceCount: refs.length,
  }));

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
        director = await buildDirectorPrompt(GEMINI_API_KEY, character);
        fluxPrompt = director.fluxPrompt;
      } catch (e: any) {
        warnings.push(`Gemini director unavailable: ${String(e?.message || e).slice(0, 300)}`);
        if (!fluxPrompt) throw e;
      }
    }

    if (!fluxPrompt) throw new Error("No image prompt available.");

    const refs = character ? await loadCharacterReferences(character, warnings) : [];
    const model = generationMode === "champion" ? CF_MODEL_CHAMPION : CF_MODEL_NORMAL;

    if (refs.length) {
      fluxPrompt = `${fluxPrompt}

REFERENCE USAGE — FRESH COMPOSITION:
Treat the supplied references as canonical visual dictionaries.
Create a fresh original scene with its own camera angle, framing, perspective, pose, character placement, horizon, landmark placement and foreground/background arrangement.
Race references guide intrinsic racial anatomy and biological identity.
The region reference guides environmental vocabulary: characteristic terrain, materials, architecture, vegetation, climate, lighting and atmosphere. Use those ingredients to depict a fresh location and spatial arrangement within the same region.
Keep the final image recognizably consistent with the canonical identities while giving this character a distinct composition.`;
    }

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

Reference images 0-3 are canonical character/region references selected for this character. Race references govern racial anatomy only; the region reference supplies environmental vocabulary only. Choose a fresh camera angle, framing, perspective, pose, character placement, horizon, landmark placement, foreground/background layout and overall composition. Build a fresh scene within the same canonical region while preserving its recognizable environmental identity. Preserve the generated character data; clothing, pose, weapon and identity come from the character specification.`;
          
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
