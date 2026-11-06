/**
 * ALERT AI — Cloudflare Worker
 * - /api/config : sitenin Supabase bağlantı bilgileri (herkese açık anahtarlar)
 * - /api/ai     : yapay zekâ görevleri (Gemini ücretsiz katmanı)
 * - /api/tts    : seslendirme (Gemini TTS) → WAV
 * Diğer tüm istekler public/ klasöründeki dosyalardan sunulur.
 *
 * Gizli anahtar (GEMINI_API_KEY) yalnızca sunucuda durur, tarayıcıya asla gönderilmez.
 * Yapay zekâ uç noktaları yalnızca giriş yapmış kullanıcılar içindir (Supabase oturumu doğrulanır).
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (message, status = 400, code) => json({ error: message, code }, status);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === "/api/config") {
        return json({
          supabaseUrl: env.SUPABASE_URL || "",
          supabaseAnonKey: env.SUPABASE_ANON_KEY || "",
          aiConfigured: Boolean(env.GEMINI_API_KEY),
        });
      }
      if (request.method !== "POST") return fail("Yöntem desteklenmiyor.", 405);
      const user = await authenticate(request, env);
      const body = await request.json().catch(() => null);
      if (!body) return fail("Geçersiz istek.");
      if (url.pathname === "/api/admin/ai-check") return await adminAICheck(env, user);
      if (url.pathname === "/api/ai" || url.pathname === "/api/tts") {
        const task = url.pathname === "/api/tts" ? "tts" : String(body.task || "").slice(0, 20);
        try {
          const r = url.pathname === "/api/ai" ? await handleAI(body, env, user) : await handleTTS(body, env, user);
          logAI(env, ctx, user, task, true);
          return r;
        } catch (e) {
          if (e instanceof HttpError && e.status >= 500 || e?.status === 429) logAI(env, ctx, user, task, false);
          throw e;
        }
      }
      return fail("Bulunamadı.", 404);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.message, e.status, e.code);
      console.error(e);
      return fail("Beklenmeyen bir hata oluştu. Tekrar dene.", 500);
    }
  },
};

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ───────── Oturum doğrulama ─────────

async function authenticate(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  // Supabase yapılandırılmamışsa (yerel deneme modu) yalnızca DEV_ALLOW_ANON=1 ile izin verilir
  if (!env.SUPABASE_URL) {
    if (env.DEV_ALLOW_ANON === "1") return { id: "yerel" };
    throw new HttpError(503, "Site henüz yapılandırılmadı: SUPABASE_URL eksik.", "not_configured");
  }
  if (!token) throw new HttpError(401, "Lütfen giriş yap.", "unauthorized");
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) throw new HttpError(401, "Oturumun sona ermiş. Tekrar giriş yap.", "unauthorized");
  const u = await res.json();
  return { id: u.id, email: (u.email || "").toLowerCase(), token };
}

const ADMIN_EMAIL = "aliefeertem11@gmail.com";

// Yapay zekâ kullanımını Supabase'e say (admin paneli için). Kullanıcının kendi oturumuyla, arka planda.
function logAI(env, ctx, user, task, ok) {
  if (!user?.token || !env.SUPABASE_URL || !ctx?.waitUntil) return;
  ctx.waitUntil(
    fetch(`${env.SUPABASE_URL}/rest/v1/rpc/log_ai`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ p_task: task, p_ok: ok }),
    }).catch(() => {}),
  );
}

// Admin: her ücretsiz modeli küçük bir istekle dener
async function adminAICheck(env, user) {
  if (user.email !== ADMIN_EMAIL) throw new HttpError(403, "Yetkin yok.", "forbidden");
  const results = [];
  for (const model of TEXT_FALLBACKS) {
    const t0 = Date.now();
    try {
      const d = await geminiOnce(env, { model, contents: [{ role: "user", parts: [{ text: "Sadece 'tamam' yaz." }] }], maxTokens: 50 });
      results.push({ model, ok: !!textOf(d), ms: Date.now() - t0, error: textOf(d) ? "" : "boş cevap" });
    } catch (e) {
      results.push({ model, ok: false, ms: Date.now() - t0, error: e.code === "quota" ? "kota dolu" : e.code === "busy" ? "yoğun" : e.code === "model_not_found" ? "yok" : e.message });
    }
  }
  return json({ results });
}

// ───────── Gemini ─────────

const BASE = (env) => env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

// Düşünme (thinking) ayarı: modele göre desteklenen ilk biçim bulunur ve hatırlanır.
const THINK_OPTS = [{ thinkingLevel: "minimal" }, { thinkingBudget: 0 }, { thinkingBudget: 512 }, null];
const thinkIdx = {};
// Model meşgulse (503) veya bulunamazsa sıradaki ücretsiz modele geçilir.
const TEXT_FALLBACKS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gemini(env, opts) {
  const isAudio = !!opts.extra?.responseModalities;
  const models = isAudio ? [opts.model] : [...new Set([opts.model, ...TEXT_FALLBACKS])];
  let last;
  for (let i = 0; i < models.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await geminiOnce(env, { ...opts, model: models[i] });
      } catch (e) {
        last = e;
        const busy = e.code === "busy";
        if (!(busy || e.code === "model_not_found")) throw e;
        if (busy && attempt === 0) { await sleep(1500); continue; }
        break;
      }
    }
  }
  if (last?.code === "busy") throw new HttpError(503, "Yapay zekâ şu an çok yoğun. Bir dakika sonra tekrar dene.", "provider");
  throw last;
}

async function geminiOnce(env, { model, contents, system, json: wantJson, temperature = 0.5, maxTokens = 8192, extra = {} }) {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "Yapay zekâ anahtarı (GEMINI_API_KEY) tanımlı değil.", "not_configured");
  const isAudio = !!extra.responseModalities;
  for (;;) {
    const ti = thinkIdx[model] || 0;
    const think = isAudio ? null : THINK_OPTS[ti];
    const generationConfig = {
      temperature,
      ...(maxTokens ? { maxOutputTokens: isAudio ? maxTokens : Math.max(maxTokens, 16384) } : {}),
      ...(wantJson ? { responseMimeType: "application/json" } : {}),
      ...(think ? { thinkingConfig: think } : {}),
      ...extra,
    };
    const body = { contents, generationConfig };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    let res;
    try {
      res = await fetch(`${BASE(env)}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(100000),
      });
    } catch (e) {
      if (e && (e.name === "TimeoutError" || e.name === "AbortError")) throw new HttpError(504, "Yapay zekâ çok uzun sürdü. Tekrar dene.", "busy");
      throw new HttpError(502, "Yapay zekâ servisine ulaşılamadı.", "provider");
    }
    if (res.status === 429) throw new HttpError(429, "Ücretsiz yapay zekâ kotası şu an dolu. Birkaç dakika sonra (günlük sınırsa yarın) tekrar dene.", "quota");
    if (res.status === 404) throw new HttpError(502, `Model bulunamadı: ${model}`, "model_not_found");
    if (res.status === 503 || res.status === 500) throw new HttpError(503, "Yapay zekâ şu an çok yoğun.", "busy");
    if (!res.ok) {
      const t = await res.text();
      if (/API key/i.test(t)) throw new HttpError(503, "Yapay zekâ anahtarı geçersiz.", "not_configured");
      if (res.status === 400 && think && ti < THINK_OPTS.length - 1) {
        thinkIdx[model] = ti + 1;
        continue;
      }
      console.error("Gemini", res.status, t.slice(0, 400));
      throw new HttpError(502, `Yapay zekâ isteği başarısız oldu (${res.status}). Tekrar dene.`, "provider");
    }
    return res.json();
  }
}

function textOf(data) {
  return (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
}

function parseJSON(text) {
  const t = text.replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.search(/[[{]/);
    const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    return JSON.parse(t.slice(a, b + 1));
  }
}

async function askJSON(env, prompt, system, opts = {}) {
  const { parts = [], ...rest } = opts;
  for (let i = 0; i < 2; i++) {
    const data = await gemini(env, { model: env.GEMINI_MODEL || "gemini-flash-latest", contents: [{ role: "user", parts: [...parts, { text: prompt }] }], system, json: true, ...rest });
    try {
      return parseJSON(textOf(data));
    } catch {
      /* bir kez daha dene */
    }
  }
  throw new HttpError(502, "Yapay zekâ beklenen biçimde cevap vermedi. Tekrar dene.", "bad_output");
}

const clip = (s, n) => String(s ?? "").slice(0, n);
const RULES = `Türkçe yaz. Matematik/kimya gösterimi için LaTeX kullan ($...$ satır içi, $$...$$ ayrı satır). Kaynak materyalde olmayan bilgiyi kesin gerçekmiş gibi uydurma.`;

// ───────── Yapay zekâ görevleri ─────────

async function handleAI(b, env) {
  switch (b.task) {
    case "plan":
      return json(await taskPlan(b, env));
    case "step":
      return json(await taskStep(b, env));
    case "tutor": {
      const r = await taskTutor(b, env);
      return r instanceof Response ? r : json(r);
    }
    case "solve":
      return json(await taskSolve(b, env));
    case "podcast":
      return json(await taskPodcast(b, env));
    case "ocr":
      return json(await taskOCR(b, env));
    default:
      throw new HttpError(400, "Bilinmeyen görev.");
  }
}

async function taskPlan(b, env) {
  const days = Number(b.daysLeft) || null;
  const plan = await askJSON(
    env,
    `Bir öğrenci için Duolingo tarzı, adım adım ilerleyen kişisel bir çalışma yolu tasarla.

Öğrenci bilgileri:
- Ders: ${clip(b.subject, 80)}
- Sınav: ${clip(b.examName, 120)}
- Hedef not: ${clip(b.targetGrade, 20)} (${clip(b.scale, 30)})
- Mevcut seviyesi (1-5): ${Number(b.level) || 3}
- Sınava kalan gün: ${days ?? "belirtilmedi"}
- Sınıf: ${clip(b.grade, 40) || "belirtilmedi"}

Kurallar:
- Hedef not yüksekse ve seviye düşükse daha fazla pratik ve tekrar adımı ekle.
- 4-7 ünite oluştur; her ünite öğrenme sırasına göre bir konu olsun.
- Her ünitede 4-6 adım olsun. Adım türleri:
  "lesson" (kısa anlatım + sorular), "practice" (karışık sorular), "cards" (bilgi kartları), "podcast" (sesli özet), "review" (önceki ünitelerden tekrar), "boss" (ünite sonu sınavı — her ünitenin son adımı).
- Her ünite "lesson" ile başlasın ve "boss" ile bitsin. Ara sıra "cards", "podcast" ve "review" ekle.
- Adım başlıkları kısa ve somut olsun (en fazla 5 kelime).
- "tip" alanına hedef nota ulaşmak için 1-2 cümlelik kişisel strateji yaz; "dailyMinutes" önerilen günlük çalışma dakikası.

JSON: {"title":"", "tip":"", "dailyMinutes":20, "units":[{"title":"", "description":"", "steps":[{"type":"lesson","title":""}]}]}
${b.material ? `\nÖĞRENCİNİN MATERYALİ (konuları buradan çıkar):\n"""\n${clip(b.material, 60000)}\n"""` : "\n(Materyal yok: bu ders ve seviye için yaygın konuları kullan; resmî müfredat iddiasında bulunma.)"}`,
    `Sen deneyimli bir öğretmen ve öğrenme tasarımcısısın. ${RULES}`,
    { maxTokens: 6000, model: env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest" },
  );
  if (!Array.isArray(plan.units) || !plan.units.length) throw new HttpError(502, "Plan oluşturulamadı. Tekrar dene.", "bad_output");
  const allowed = ["lesson", "practice", "cards", "podcast", "review", "boss"];
  plan.units = plan.units.slice(0, 8).map((u, ui) => ({
    title: clip(u.title, 80) || `Ünite ${ui + 1}`,
    description: clip(u.description, 200),
    steps: (u.steps || []).slice(0, 7).map((s, si) => ({
      id: `u${ui}s${si}`,
      type: allowed.includes(s.type) ? s.type : "practice",
      title: clip(s.title, 60) || "Pratik",
    })),
  }));
  return plan;
}

// Adımlar hız için iki parçaya bölünüp aynı anda üretilir.
const STEP_PARTS = {
  lesson: [
    { intro: true, n: 3, focus: "Önce 2-3 kısa anlatım kartı (intro) yaz: her biri tek bir fikri, bir örnekle, en fazla 60 kelimeyle anlatsın. Sonra bu kartlardaki temel bilgileri yoklayan 3 kolay soru yaz." },
    { n: 3, focus: "intro boş olsun. Konuyu uygulamaya döken, orta zorlukta 3 soru yaz." },
  ],
  practice: [
    { n: 4, focus: "intro boş olsun. Konunun temel kavramlarından 4 karışık soru yaz." },
    { n: 4, focus: "intro boş olsun. Konunun uygulama ve yorum gerektiren kısmından 4 karışık soru yaz." },
  ],
  review: [
    { n: 4, focus: "intro boş olsun. Öğrencinin yanlış yaptığı sorulara benzer 4 tekrar sorusu yaz (yanlış yoksa ilk konulardan)." },
    { n: 4, focus: "intro boş olsun. Listelenen önceki konulardan karışık 4 tekrar sorusu yaz." },
  ],
  boss: [
    { n: 4, focus: "intro boş olsun. Ünitenin ilk yarısını kapsayan, biraz zor 4 soru yaz." },
    { n: 4, focus: "intro boş olsun. Ünitenin ikinci yarısını ve konular arası bağlantıları kapsayan, biraz zor 4 soru yaz." },
  ],
  cards: [
    { cards: true, n: 0, focus: "intro boş olsun, questions boş olsun. Konunun ilk yarısından 5 bilgi kartı (cards) yaz: front kısa soru/terim, back kısa cevap." },
    { cards: true, n: 0, focus: "intro boş olsun, questions boş olsun. Konunun ikinci yarısından 5 bilgi kartı (cards) yaz: front kısa soru/terim, back kısa cevap." },
  ],
};

async function taskStep(b, env) {
  const type = STEP_PARTS[b.type] ? b.type : "practice";
  const head = `Ders: ${clip(b.subject, 80)} · Sınav: ${clip(b.examName, 120)} · Öğrenci: ${clip(b.grade, 40) || "lise"}
Ünite: ${clip(b.unitTitle, 120)}
Adım: ${clip(b.stepTitle, 120)} (${type})
${b.reviewTopics ? `Tekrar edilecek konular: ${clip(b.reviewTopics, 600)}\n` : ""}${b.mistakes ? `Öğrencinin daha önce yanlış yaptığı sorular:\n${clip(b.mistakes, 1500)}\n` : ""}`;
  const qTypes = `Soru türleri (karışık kullan):
- "mc": çoktan seçmeli, 4 seçenek, "answer" doğru seçeneğin sırası (0-3)
- "tf": doğru/yanlış ifade, "answer" true/false (belirsiz ifade yazma)
- "fill": tek kelimelik/kısa cevaplı boşluk doldurma; "prompt" içinde ____ olsun, "answer" doğru cevap, "accept" kabul edilecek diğer yazımlar
- "match": 4 eşleştirme çifti, "pairs":[{"left":"","right":""}]
Her soruda "explanation" (neden doğru, tek kısa cümle) olsun.`;
  const src = b.material ? `\nKAYNAK MATERYAL (yalnızca buna dayan):\n"""\n${clip(b.material, 7000)}\n"""` : "";
  const system = `Sen Duolingo tarzı kısa, net ve eğlenceli alıştırmalar hazırlayan bir öğretmensin. Kısa yaz. ${RULES}`;
  const model = env.GEMINI_FAST_MODEL || "gemini-flash-lite-latest";
  const parts = STEP_PARTS[type].map((part) => {
    const shape = part.cards
      ? `JSON: {"cards":[{"front":"","back":""}]}`
      : `JSON: {"intro":[{"title":"","body":""}], "questions":[{"kind":"mc","prompt":"","options":["","","",""],"answer":0,"explanation":""},{"kind":"tf","prompt":"","answer":true,"explanation":""},{"kind":"fill","prompt":"","answer":"","accept":[],"explanation":""},{"kind":"match","prompt":"Eşleştir","pairs":[{"left":"","right":""}],"explanation":""}]}`;
    return askJSON(env, `${head}\n${part.focus}\n\n${part.cards ? "" : qTypes + "\n\n"}${shape}${src}`, system, { maxTokens: 4000, temperature: 0.6, model });
  });
  const results = await Promise.allSettled(parts);
  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) throw results[0].reason;
  const intros = results.flatMap((r, i) => (r.status === "fulfilled" && STEP_PARTS[type][i].intro ? r.value.intro || [] : []));
  const data = { intro: intros, questions: ok.flatMap((d) => d.questions || []), cards: ok.flatMap((d) => d.cards || []) };
  const seen = new Set();
  const qs = data.questions.filter((q) => {
    if (!q || typeof q.prompt !== "string") return false;
    const k = q.prompt.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    if (q.kind === "mc") return Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length;
    if (q.kind === "tf") return typeof q.answer === "boolean";
    if (q.kind === "fill") return typeof q.answer === "string" && q.answer.trim();
    if (q.kind === "match") return Array.isArray(q.pairs) && q.pairs.length >= 2 && q.pairs.every((p) => p.left && p.right);
    return false;
  });
  return {
    intro: data.intro.filter((c) => c && c.body).slice(0, 4),
    questions: qs.slice(0, 12),
    cards: data.cards.filter((c) => {
      if (!c || !c.front || !c.back) return false;
      const k = "c:" + String(c.front).trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 12),
  };
}

async function taskTutor(b, env) {
  const msgs = Array.isArray(b.messages) ? b.messages.slice(-14) : [];
  if (!msgs.length) throw new HttpError(400, "Mesaj gerekli.");
  const modes = {
    explain: "Kavramı net, adım adım ve örneklerle açıkla; sonunda anlayıp anlamadığını kısa bir soruyla kontrol et.",
    socratic: "Cevabı doğrudan verme; öğrenciyi küçük yönlendirici sorularla düşündür. Her seferinde tek soru sor.",
    solver: "Problemi adım adım çöz, her adımı açıkla, sonucu açıkça belirt.",
    hint: "Asla tam çözümü verme; yalnızca bir sonraki adım için küçük bir ipucu ver.",
    practice: "Konuyla ilgili yeni bir alıştırma sorusu sor; öğrenci cevaplayınca değerlendir ve açıkla.",
  };
  const req = {
    model: env.GEMINI_MODEL || "gemini-flash-latest",
    system: `Sen ALERT AI'ın sabırlı, cesaretlendirici ve dürüst yapay zekâ eğitmenisin. ${b.grade ? `Öğrenci: ${clip(b.grade, 40)}.` : ""} ${b.subject ? `Ders: ${clip(b.subject, 80)}.` : ""} ${modes[b.mode] || modes.explain} Öğrenci hangi dilde yazarsa o dilde cevap ver. Kısa paragraflar kullan. Matematiği LaTeX ile yaz. Emin olmadığın bilgiyi uydurma.${b.material ? `\n\nÖğrencinin materyalinden ilgili bölüm:\n"""${clip(b.material, 6000)}"""` : ""}`,
    contents: msgs.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: clip(m.content, 6000) }] })),
    temperature: 0.6,
  };
  if (b.stream) return geminiStream(env, req);
  const data = await gemini(env, req);
  const text = textOf(data);
  if (!text) throw new HttpError(502, "Boş cevap geldi. Tekrar dene.", "bad_output");
  return { text };
}

// Akışlı cevap: metin parça parça gelir (eğitmen sohbeti hızlı hissettirsin diye)
async function geminiStream(env, { model, contents, system, temperature = 0.6 }) {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "Yapay zekâ anahtarı (GEMINI_API_KEY) tanımlı değil.", "not_configured");
  const models = [...new Set([model, ...TEXT_FALLBACKS])];
  let lastErr = null;
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ti = thinkIdx[m] || 0;
      const think = THINK_OPTS[ti];
      const body = { contents, generationConfig: { temperature, maxOutputTokens: 16384, ...(think ? { thinkingConfig: think } : {}) } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      let res;
      try {
        res = await fetch(`${BASE(env)}/models/${m}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: JSON.stringify(body),
        });
      } catch {
        lastErr = new HttpError(502, "Yapay zekâ servisine ulaşılamadı.", "provider");
        break;
      }
      if (res.ok) return sseToText(res.body);
      const t = await res.text().catch(() => "");
      if (res.status === 429) throw new HttpError(429, "Ücretsiz yapay zekâ kotası şu an dolu. Birkaç dakika sonra (günlük sınırsa yarın) tekrar dene.", "quota");
      if (/API key/i.test(t)) throw new HttpError(503, "Yapay zekâ anahtarı geçersiz.", "not_configured");
      if (res.status === 400 && think && ti < THINK_OPTS.length - 1) { thinkIdx[m] = ti + 1; attempt--; continue; }
      if (res.status === 503 || res.status === 500) { lastErr = new HttpError(503, "Yapay zekâ şu an çok yoğun. Bir dakika sonra tekrar dene.", "provider"); if (attempt === 0) { await sleep(1200); continue; } break; }
      if (res.status === 404) { lastErr = new HttpError(502, `Model bulunamadı: ${m}`, "model_not_found"); break; }
      throw new HttpError(502, `Yapay zekâ isteği başarısız oldu (${res.status}). Tekrar dene.`, "provider");
    }
  }
  throw lastErr || new HttpError(502, "Yapay zekâ cevap vermedi.", "provider");
}

function sseToText(stream) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  const out = new TransformStream({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        try {
          const t = textOf(JSON.parse(line.slice(5)));
          if (t) ctl.enqueue(enc.encode(t));
        } catch { /* yarım satır */ }
      }
    },
  });
  return new Response(stream.pipeThrough(out), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-stream": "1" } });
}

async function taskSolve(b, env) {
  if (!b.image || !b.mime || !/^image\//.test(b.mime)) throw new HttpError(400, "Bir fotoğraf gönder.");
  if (b.image.length > 9_000_000) throw new HttpError(400, "Fotoğraf çok büyük (en fazla ~6 MB).");
  return askJSON(
    env,
    `Görseldeki soruyu oku, dersini belirle, adım adım çöz ve her adımı açıkla. Okunamayan kısım varsa belirt ve "confidence" değerini "low" yap. Sonunda 1 benzer alıştırma sorusu ve cevabı ver.
${b.note ? `Öğrencinin notu: ${clip(b.note, 300)}\n` : ""}JSON: {"subject":"","question":"","steps":[{"title":"","body":""}],"answer":"","confidence":"high","similar":{"question":"","answer":""}}`,
    `Sen her dersten soruları adım adım çözen bir öğretmensin. ${RULES}`,
    { maxTokens: 6000, parts: [{ inlineData: { mimeType: b.mime, data: b.image } }] },
  );
}

async function taskOCR(b, env) {
  if (!b.image || !/^image\//.test(b.mime || "")) throw new HttpError(400, "Bir fotoğraf gönder.");
  const data = await gemini(env, {
    model: env.GEMINI_MODEL || "gemini-flash-latest",
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: b.mime, data: b.image } }, { text: "Bu görseldeki tüm metni (el yazısı dahil) olduğu gibi yazıya dök. Formülleri LaTeX ile yaz. Yorum ekleme." }] }],
    temperature: 0,
  });
  return { text: textOf(data) };
}

async function taskPodcast(b, env) {
  const styles = {
    sohbet: "İki konuşmacı: Deniz meraklı bir öğrenci gibi sorular sorar, Ece konuyu açıklayan öğretmendir. Doğal, samimi bir sohbet.",
    anlatim: "Tek anlatıcı: Ece konuyu sıcak ve akıcı bir dille anlatır.",
    tekrar: "Tek anlatıcı: Ece sınav öncesi en önemli bilgileri, formülleri ve tuzakları hızlıca özetler.",
    hikaye: "Tek anlatıcı: Ece konuyu akılda kalıcı örnekler ve kısa bir hikâyeyle anlatır.",
  };
  const minutes = Math.min(6, Math.max(1, Number(b.minutes) || 3));
  const data = await askJSON(
    env,
    `${styles[b.style] || styles.sohbet}
Uzunluk: yaklaşık ${minutes * 130} kelime (~${minutes} dakika).
Metin seslendirilecek: LaTeX, sembol, emoji, madde işareti KULLANMA; formülleri sözle oku (örneğin "iki n kare"). Kısa, konuşma diline uygun cümleler kur. Sonunda kısa bir özet olsun.
JSON: {"title":"","segments":[{"speaker":"Ece","text":""}]}  (speaker yalnızca "Ece" veya "Deniz")
KONU: ${clip(b.topic, 200)}
${b.material ? `KAYNAK:\n"""\n${clip(b.material, 9000)}\n"""` : ""}`,
    "Sen eğitim podcast'leri yazan bir senaristsin. Türkçe yaz. Kaynakta olmayan bilgiyi uydurma.",
    { maxTokens: 6000, temperature: 0.7 },
  );
  const segs = (data.segments || []).filter((s) => s && s.text).map((s) => ({ speaker: s.speaker === "Deniz" ? "Deniz" : "Ece", text: clip(s.text, 800) }));
  if (!segs.length) throw new HttpError(502, "Senaryo oluşturulamadı.", "bad_output");
  return { title: clip(data.title, 120) || "Podcast", segments: segs };
}

// ───────── Seslendirme (Gemini TTS) ─────────

const VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Leda", "Orus", "Zephyr", "Callirrhoe", "Enceladus", "Sulafat", "Achird"];

async function handleTTS(b, env) {
  const segs = Array.isArray(b.segments) ? b.segments.filter((s) => s && s.text) : [];
  if (!segs.length) throw new HttpError(400, "Seslendirilecek metin yok.");
  const total = segs.reduce((n, s) => n + String(s.text).length, 0);
  if (total > 6000) throw new HttpError(400, "Metin seslendirme için çok uzun (en fazla ~6000 karakter).");
  const vA = VOICES.includes(b.voiceA) ? b.voiceA : "Kore";
  const vB = VOICES.includes(b.voiceB) ? b.voiceB : "Puck";
  const speakers = [...new Set(segs.map((s) => (s.speaker === "Deniz" ? "Deniz" : "Ece")))];
  const style = b.style ? clip(b.style, 200) + "\n" : "Doğal, sıcak ve anlaşılır bir Türkçe ile, bir eğitim podcast'i gibi oku.\n";

  let speechConfig;
  let text;
  if (speakers.length === 2) {
    text = `${style}Ece ile Deniz arasındaki şu konuşmayı seslendir:\n` + segs.map((s) => `${s.speaker === "Deniz" ? "Deniz" : "Ece"}: ${s.text}`).join("\n");
    speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: "Ece", voiceConfig: { prebuiltVoiceConfig: { voiceName: vA } } },
          { speaker: "Deniz", voiceConfig: { prebuiltVoiceConfig: { voiceName: vB } } },
        ],
      },
    };
  } else {
    text = style + segs.map((s) => s.text).join("\n");
    speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: speakers[0] === "Deniz" ? vB : vA } } };
  }

  const models = [env.GEMINI_TTS_MODEL, "gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"].filter(Boolean);
  let data;
  let lastErr;
  for (const model of [...new Set(models)]) {
    try {
      data = await gemini(env, { model, contents: [{ role: "user", parts: [{ text }] }], extra: { responseModalities: ["AUDIO"], speechConfig }, maxTokens: undefined, temperature: 1 });
      break;
    } catch (e) {
      lastErr = e;
      if (e.code !== "model_not_found") throw e;
    }
  }
  if (!data) throw lastErr;
  const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new HttpError(502, "Ses üretilemedi. Tekrar dene.", "bad_output");
  const rate = Number((part.inlineData.mimeType || "").match(/rate=(\d+)/)?.[1]) || 24000;
  const pcm = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
  return new Response(wav(pcm, rate), { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
}

function wav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return buf;
}
