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
  async fetch(request, env) {
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
      if (url.pathname === "/api/ai") return await handleAI(body, env, user);
      if (url.pathname === "/api/tts") return await handleTTS(body, env, user);
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
  return { id: u.id };
}

// ───────── Gemini ─────────

const BASE = (env) => env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

async function gemini(env, { model, contents, system, json: wantJson, temperature = 0.5, maxTokens = 8192, extra = {} }) {
  if (!env.GEMINI_API_KEY) throw new HttpError(503, "Yapay zekâ anahtarı (GEMINI_API_KEY) tanımlı değil.", "not_configured");
  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens: maxTokens, ...(wantJson ? { responseMimeType: "application/json" } : {}), ...extra },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  let res;
  try {
    res = await fetch(`${BASE(env)}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HttpError(502, "Yapay zekâ servisine ulaşılamadı.", "provider");
  }
  if (res.status === 429) throw new HttpError(429, "Ücretsiz yapay zekâ kotası şu an dolu. Birkaç dakika sonra (günlük sınırsa yarın) tekrar dene.", "quota");
  if (res.status === 404) throw new HttpError(502, `Model bulunamadı: ${model}`, "model_not_found");
  if (!res.ok) {
    const t = await res.text();
    if (/API key/i.test(t)) throw new HttpError(503, "Yapay zekâ anahtarı geçersiz.", "not_configured");
    console.error("Gemini", res.status, t.slice(0, 400));
    throw new HttpError(502, "Yapay zekâ isteği başarısız oldu. Tekrar dene.", "provider");
  }
  return res.json();
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
    case "tutor":
      return json(await taskTutor(b, env));
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
    { maxTokens: 6000 },
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

const STEP_GUIDE = {
  lesson: "Önce 2-4 kısa anlatım kartı (intro) yaz: her biri tek bir fikri, örnekle, en fazla 70 kelimeyle anlatsın. Sonra bu kartlardan 6 soru yaz.",
  practice: "intro boş olsun. Konudan 8 karışık soru yaz.",
  review: "intro boş olsun. Listelenen önceki konulardan karışık 8 tekrar sorusu yaz.",
  boss: "intro boş olsun. Ünitenin tamamını kapsayan, biraz daha zor 10 soru yaz.",
  cards: "intro boş olsun, questions boş olsun. 8-10 bilgi kartı (cards) yaz: front kısa soru/terim, back kısa cevap.",
};

async function taskStep(b, env) {
  const type = STEP_GUIDE[b.type] ? b.type : "practice";
  const data = await askJSON(
    env,
    `Ders: ${clip(b.subject, 80)} · Sınav: ${clip(b.examName, 120)} · Öğrenci: ${clip(b.grade, 40) || "lise"}
Ünite: ${clip(b.unitTitle, 120)}
Adım: ${clip(b.stepTitle, 120)} (${type})
${b.reviewTopics ? `Tekrar edilecek konular: ${clip(b.reviewTopics, 600)}\n` : ""}${b.mistakes ? `Öğrencinin daha önce yanlış yaptığı sorular (bunlara benzer sorular da ekle):\n${clip(b.mistakes, 1500)}\n` : ""}
${STEP_GUIDE[type]}

Soru türleri (karışık kullan):
- "mc": çoktan seçmeli, 4 seçenek, "answer" doğru seçeneğin sırası (0-3)
- "tf": doğru/yanlış ifade, "answer" true/false (belirsiz ifade yazma)
- "fill": tek kelimelik/kısa cevaplı boşluk doldurma; "prompt" içinde ____ olsun, "answer" doğru cevap, "accept" kabul edilecek diğer yazımlar
- "match": 4 eşleştirme çifti, "pairs":[{"left":"","right":""}]
Her soruda "explanation" (neden doğru, 1-2 cümle) olsun.

JSON: {"intro":[{"title":"","body":""}], "questions":[{"kind":"mc","prompt":"","options":["","","",""],"answer":0,"explanation":""},{"kind":"tf","prompt":"","answer":true,"explanation":""},{"kind":"fill","prompt":"","answer":"","accept":[],"explanation":""},{"kind":"match","prompt":"Eşleştir","pairs":[{"left":"","right":""}],"explanation":""}], "cards":[{"front":"","back":""}]}
${b.material ? `\nKAYNAK MATERYAL (yalnızca buna dayan):\n"""\n${clip(b.material, 9000)}\n"""` : ""}`,
    `Sen Duolingo tarzı kısa, net ve eğlenceli alıştırmalar hazırlayan bir öğretmensin. ${RULES}`,
    { maxTokens: 8000, temperature: 0.6 },
  );
  // Doğrulama: bozuk soruları ayıkla
  const qs = (data.questions || []).filter((q) => {
    if (!q || typeof q.prompt !== "string") return false;
    if (q.kind === "mc") return Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer < q.options.length;
    if (q.kind === "tf") return typeof q.answer === "boolean";
    if (q.kind === "fill") return typeof q.answer === "string" && q.answer.trim();
    if (q.kind === "match") return Array.isArray(q.pairs) && q.pairs.length >= 2 && q.pairs.every((p) => p.left && p.right);
    return false;
  });
  return {
    intro: (data.intro || []).filter((c) => c && c.body).slice(0, 5),
    questions: qs.slice(0, 12),
    cards: (data.cards || []).filter((c) => c && c.front && c.back).slice(0, 12),
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
  const data = await gemini(env, {
    model: env.GEMINI_MODEL || "gemini-flash-latest",
    system: `Sen ALERT AI'ın sabırlı, cesaretlendirici ve dürüst yapay zekâ eğitmenisin. ${b.grade ? `Öğrenci: ${clip(b.grade, 40)}.` : ""} ${b.subject ? `Ders: ${clip(b.subject, 80)}.` : ""} ${modes[b.mode] || modes.explain} Öğrenci hangi dilde yazarsa o dilde cevap ver. Kısa paragraflar kullan. Matematiği LaTeX ile yaz. Emin olmadığın bilgiyi uydurma.${b.material ? `\n\nÖğrencinin materyalinden ilgili bölüm:\n"""${clip(b.material, 6000)}"""` : ""}`,
    contents: msgs.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: clip(m.content, 6000) }] })),
    temperature: 0.6,
  });
  const text = textOf(data);
  if (!text) throw new HttpError(502, "Boş cevap geldi. Tekrar dene.", "bad_output");
  return { text };
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
