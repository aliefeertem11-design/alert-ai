import { go, ctx, refreshProfile } from "../app.js";
import { store } from "../store.js";
import { ai, esc, md, mdInline, icon, relevantExcerpt, toast } from "../ui.js";
import { flatSteps, TYPE } from "./learn.js";
import { podcastAudio, speakFallback, sfx } from "../audio.js";

const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const norm = (s) => String(s ?? "").toLocaleLowerCase("tr").normalize("NFC").replace(/[.,;:!?'"()]/g, "").replace(/\s+/g, " ").trim();
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// ── Adım içeriği üretimi (aynı adım için tek istek; sonuç kaydedilir) ──
const pending = new Map();
export function prepareStep(course, step) {
  const key = `${course.id}/${step.id}`;
  if (!pending.has(key)) {
    const p = generateStep(course, step).finally(() => setTimeout(() => pending.delete(key), 1000));
    pending.set(key, p);
  }
  return pending.get(key);
}
export async function prefetchStep(course, step) {
  try {
    if (await store.stepContent(course.id, step.id)) return;
    await prepareStep(course, step);
  } catch { /* arka plan: sessizce geç */ }
}
async function generateStep(course, step) {
  const unit = course.plan.units[step.unit];
  const excerpt = relevantExcerpt(course.material, `${unit.title} ${step.title} ${unit.description || ""}`, 9000);
  let content;
  if (step.type === "podcast") {
    content = await ai("podcast", { topic: `${unit.title}: ${step.title}`, material: excerpt, style: "sohbet", minutes: 3 });
  } else {
    const prevUnits = course.plan.units.slice(0, step.unit + 1).map((u) => u.title).join(", ");
    const mistakes = step.type === "review" ? (await store.mistakes(course.id)).slice(0, 8).map((m) => `- ${m.question} (doğru: ${m.correct_answer})`).join("\n") : "";
    content = await ai("step", {
      type: step.type, subject: course.subject, examName: course.exam_name, grade: ctx.profile?.grade,
      unitTitle: unit.title, stepTitle: step.title, material: step.type === "review" ? relevantExcerpt(course.material, prevUnits, 9000) : excerpt,
      reviewTopics: step.type === "review" ? prevUnits : "", mistakes,
    });
    if (step.type === "cards" ? !content.cards?.length : !content.questions?.length) throw new Error("İçerik oluşturulamadı. Tekrar dene.");
  }
  await store.saveStepContent(course.id, step.id, content).catch(() => {});
  return content;
}

export async function render(el, { params: [courseId, stepId] }) {
  const [course, cached] = await Promise.all([store.course(courseId), store.stepContent(courseId, stepId).catch(() => null)]);
  const steps = flatSteps(course.plan);
  const step = steps.find((s) => s.id === stepId);
  if (!step) return go("#/ogren");
  const unit = course.plan.units[step.unit];
  const t = TYPE[step.type] || TYPE.practice;

  // ── İçeriği yükle ya da üret (bir kez üretilir, sonra kayıttan gelir) ──
  const loading = (msg, err) => {
    el.innerHTML = `<div class="player"><div class="player-top"><button class="btn ghost sm" id="x">${icon("x")}</button><div class="progress"><div style="width:2%"></div></div></div>
      <div class="player-body" style="text-align:center;padding-top:80px">
        ${err ? `<div class="err">${esc(err)}</div><div style="margin-top:18px;display:flex;gap:10px;justify-content:center"><button class="btn sec" id="back">Yola dön</button><button class="btn" id="retry">Tekrar dene</button></div>`
        : `<div class="gen-anim" style="padding:0"><div class="orb" style="width:72px;height:72px"></div></div><h2 style="font-weight:800">${esc(step.title)}</h2><p class="muted" style="margin-top:6px">${esc(msg)}</p>`}
      </div></div>`;
    el.querySelector("#x").onclick = () => go("#/ogren");
    if (err) {
      el.querySelector("#back").onclick = () => go("#/ogren");
      el.querySelector("#retry").onclick = () => render(el, { params: [courseId, stepId] });
    }
  };
  let content = cached;
  if (!content) {
    loading(step.type === "podcast" ? "Podcast senaryosu yazılıyor…" : "Bu adım senin için hazırlanıyor…");
    try {
      content = await prepareStep(course, step);
    } catch (e) {
      return loading("", e.message);
    }
  }
  // Sıradaki adımı arka planda hazırla, böylece beklemeden açılır.
  (async () => {
    const i = steps.indexOf(step);
    for (const s of steps.slice(i + 1, i + 3)) await prefetchStep(course, s);
  })();

  if (step.type === "podcast") return podcastStep(el, { course, step, unit, content });

  // ── Oturum kuyruğu ──
  const queue = [];
  (content.intro || []).forEach((c) => queue.push({ kind: "info", ...c }));
  if (step.type === "cards") content.cards.forEach((c) => queue.push({ kind: "card", ...c }));
  else content.questions.forEach((q) => queue.push({ ...q, first: true }));
  queue.forEach((q, i) => (q._id = i));
  const base = queue.length;
  let pos = 0;
  let firstRight = 0;
  let answeredFirst = 0;
  const mistakes = [];
  const requeued = new Set();
  let state = "answer"; // answer | feedback
  let answer = null;
  let started = Date.now();
  let combo = 0;

  function frame(inner, foot) {
    const pct = Math.min(100, (pos / Math.max(base, queue.length)) * 100);
    el.innerHTML = `<div class="player">
      <div class="player-top"><button class="btn ghost sm" id="x" aria-label="Çık">${icon("x")}</button><div class="progress"><div style="width:${Math.max(2, pct)}%"></div></div>${combo >= 3 ? `<span class="xp">${icon("fire")} ${combo}</span>` : ""}</div>
      <div class="player-body fade">${inner}</div>
      <div class="footbar ${foot.cls || ""}"><div class="footbar-in">${foot.left || "<span></span>"}${foot.right}</div></div>
    </div>`;
    el.querySelector("#x").onclick = () => {
      const m = document.createElement("div");
      m.className = "modal-bg";
      m.innerHTML = `<div class="card modal fade" style="text-align:center"><h3 style="font-weight:800">Çıkmak istiyor musun?</h3><p class="muted" style="margin:8px 0 18px">Bu adımdaki ilerlemen kaydedilmeyecek.</p><div style="display:grid;gap:10px"><button class="btn" id="stay">Devam et</button><button class="btn ghost" id="leave">Çık</button></div></div>`;
      document.body.appendChild(m);
      m.querySelector("#stay").onclick = () => m.remove();
      m.querySelector("#leave").onclick = () => { m.remove(); go("#/ogren"); };
    };
  }

  function show() {
    if (pos >= queue.length) return finish();
    const q = queue[pos];
    state = "answer";
    answer = null;
    if (q.kind === "info") {
      frame(`<div class="q-type">${icon("book")} Öğren</div><div class="intro-card"><h2>${esc(q.title || unit.title)}</h2><div class="md">${md(q.body)}</div></div>`, { right: `<button class="btn" id="next">DEVAM</button>` });
      el.querySelector("#next").onclick = () => { pos++; show(); };
      return;
    }
    if (q.kind === "card") return showCard(q);
    const label = { mc: "Doğru cevabı seç", tf: "Doğru mu, yanlış mı?", fill: "Boşluğu doldur", match: "Eşleştir" }[q.kind];
    let body = `<div class="q-type">${!q.first ? "Tekrar · " : ""}${label}</div><div class="q-prompt md">${md(q.prompt)}</div>`;
    if (q.kind === "mc") {
      q._order ||= shuffle(q.options.map((_, i) => i));
      body += `<div class="opts">${q._order.map((oi, k) => `<button class="opt" data-v="${oi}"><span class="k">${k + 1}</span><span class="md" style="flex:1">${mdInline(q.options[oi])}</span></button>`).join("")}</div>`;
    } else if (q.kind === "tf") {
      body += `<div class="tf"><button class="opt" data-v="true">Doğru</button><button class="opt" data-v="false">Yanlış</button></div>`;
    } else if (q.kind === "fill") {
      body += `<input class="field fill-input" id="fill" placeholder="Cevabını yaz" autocomplete="off" autocapitalize="off">`;
    } else if (q.kind === "match") {
      q._l ||= shuffle(q.pairs.map((_, i) => i));
      q._r ||= shuffle(q.pairs.map((_, i) => i));
      body += `<div class="match"><div class="col">${q._l.map((i) => `<button class="opt" data-l="${i}">${mdInline(q.pairs[i].left)}</button>`).join("")}</div><div class="col">${q._r.map((i) => `<button class="opt" data-r="${i}">${mdInline(q.pairs[i].right)}</button>`).join("")}</div></div>`;
    }
    frame(body, { left: q.kind === "match" ? "<span></span>" : `<button class="btn sec" id="skip">ATLA</button>`, right: q.kind === "match" ? "<span></span>" : `<button class="btn" id="check" disabled>KONTROL ET</button>` });
    const check = el.querySelector("#check");
    el.querySelector("#skip")?.addEventListener("click", () => grade(q, null));
    if (q.kind === "mc" || q.kind === "tf") {
      el.querySelectorAll(".opts .opt, .tf .opt").forEach((b) => (b.onclick = () => {
        el.querySelectorAll(".opt").forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel");
        answer = q.kind === "tf" ? b.dataset.v === "true" : Number(b.dataset.v);
        check.disabled = false;
      }));
    } else if (q.kind === "fill") {
      const inp = el.querySelector("#fill");
      inp.focus();
      inp.oninput = () => { answer = inp.value; check.disabled = !inp.value.trim(); };
    } else if (q.kind === "match") {
      let selL = null;
      let selR = null;
      let errors = 0;
      let paired = 0;
      const tryPair = () => {
        if (selL === null || selR === null) return;
        const lb = el.querySelector(`[data-l="${selL}"]`);
        const rb = el.querySelector(`[data-r="${selR}"]`);
        if (selL === selR) {
          sfx("right");
          lb.classList.add("paired"); rb.classList.add("paired");
          lb.disabled = rb.disabled = true;
          paired++;
        } else {
          sfx("wrong");
          errors++;
          [lb, rb].forEach((b) => { b.classList.add("shake"); setTimeout(() => b.classList.remove("shake"), 400); });
        }
        lb.classList.remove("sel"); rb.classList.remove("sel");
        selL = selR = null;
        if (paired === q.pairs.length) setTimeout(() => grade(q, errors === 0 ? "ok" : "errors", true), 300);
      };
      el.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => { el.querySelectorAll("[data-l]").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); selL = Number(b.dataset.l); tryPair(); }));
      el.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => { el.querySelectorAll("[data-r]").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); selR = Number(b.dataset.r); tryPair(); }));
    }
    check && (check.onclick = () => grade(q, answer));
  }

  function grade(q, a, matchDone) {
    if (state !== "answer") return;
    state = "feedback";
    let right = false;
    let near = false;
    let correctText = "";
    if (q.kind === "mc") { right = a === q.answer; correctText = q.options[q.answer]; }
    else if (q.kind === "tf") { right = a === q.answer; correctText = q.answer ? "Doğru" : "Yanlış"; }
    else if (q.kind === "fill") {
      const accepted = [q.answer, ...(q.accept || [])].map(norm);
      const v = norm(a);
      right = accepted.includes(v);
      if (!right && v.length >= 5 && accepted.some((x) => lev(v, x) <= 1)) { right = true; near = true; }
      correctText = q.answer;
    } else if (q.kind === "match") { right = a === "ok"; correctText = q.pairs.map((p) => `${p.left} → ${p.right}`).join(", "); }

    if (q.first) {
      answeredFirst++;
      if (right) firstRight++;
    }
    if (right) combo++; else combo = 0;
    if (!right) {
      mistakes.push({ question: q.prompt.slice(0, 1000), user_answer: a === null ? "(atlandı)" : q.kind === "mc" ? q.options[a] : q.kind === "tf" ? (a ? "Doğru" : "Yanlış") : String(a ?? ""), correct_answer: correctText.slice(0, 500), explanation: (q.explanation || "").slice(0, 1000) });
      // Duolingo gibi: yanlış soru sonda tekrar gelir (bir kez)
      if (!requeued.has(q._id)) { requeued.add(q._id); queue.push({ ...q, first: false }); }
    }
    sfx(right ? "right" : "wrong");
    if (q.kind === "mc" || q.kind === "tf") {
      el.querySelectorAll(".opts .opt, .tf .opt").forEach((b) => {
        b.disabled = true;
        const v = q.kind === "tf" ? b.dataset.v === "true" : Number(b.dataset.v);
        if (v === q.answer) b.classList.add("right");
        else if (v === a) b.classList.add("wrong");
      });
    }
    if (q.kind === "fill") el.querySelector("#fill").disabled = true;
    const praise = ["Harika!", "Süper!", "Mükemmel!", "Çok iyi!", "Aynen öyle!"][Math.floor(Math.random() * 5)];
    const title = right ? (near ? "Neredeyse! Küçük bir yazım farkı var." : praise) : matchDone ? "Eşleştirmede hata yaptın" : "Doğru cevap:";
    const text = right ? (near ? `Doğrusu: ${esc(correctText)}. ` : "") + mdInline(q.explanation || "") : `${q.kind === "match" ? "" : `<b>${mdInline(correctText)}</b><br>`}${mdInline(q.explanation || "")}`;
    const foot = el.querySelector(".footbar");
    foot.className = `footbar ${right ? "right" : "wrong"}`;
    foot.querySelector(".footbar-in").innerHTML = `<div class="fb-msg"><div class="fb-icon">${icon(right ? "check" : "x")}</div><div><div class="fb-title">${esc(title)}</div><div class="fb-text md">${text}</div></div></div><button class="btn ${right ? "good" : "bad"}" id="cont">DEVAM</button>`;
    el.querySelector("#cont").onclick = () => { pos++; show(); };
    el.querySelector("#cont").focus();
  }

  function showCard(c) {
    frame(`<div class="q-type">${icon("cards")} Kartı çevir, hatırlıyor muydun?</div>
      <div class="flash" id="flash"><div class="flash-in" id="fi">
        <div class="flash-face"><small class="muted">Kart</small><div class="c md">${md(c.front)}</div><small class="muted" style="text-align:center">Çevirmek için dokun</small></div>
        <div class="flash-face back"><small style="color:var(--acchi)">Cevap</small><div class="c md">${md(c.back)}</div></div>
      </div></div>`, { left: `<button class="btn sec" id="again" disabled>TEKRAR GÖSTER</button>`, right: `<button class="btn good" id="knew" disabled>BİLİYORDUM</button>` });
    const flip = () => { el.querySelector("#fi").classList.add("f"); el.querySelector("#again").disabled = false; el.querySelector("#knew").disabled = false; };
    el.querySelector("#flash").onclick = flip;
    el.querySelector("#knew").onclick = () => { if (c.first !== false) { answeredFirst++; firstRight++; } sfx("right"); combo++; pos++; show(); };
    el.querySelector("#again").onclick = () => {
      if (c.first !== false) answeredFirst++;
      combo = 0;
      if (!requeued.has(c._id)) { requeued.add(c._id); queue.push({ ...c, first: false }); }
      pos++;
      show();
    };
  }

  async function finish() {
    const acc = answeredFirst ? firstRight / answeredFirst : 1;
    const stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : 1;
    const isBoss = step.type === "boss";
    const passed = !isBoss || acc >= 0.6;
    const xp = passed ? (isBoss ? 30 : 15) + (stars === 3 ? 5 : 0) : 5;
    const secs = Math.round((Date.now() - started) / 1000);
    el.innerHTML = `<div class="player"><div class="player-body result fade">
      <h1>${passed ? (stars === 3 ? "Kusursuz!" : "Adım tamamlandı!") : "Neredeyse!"}</h1>
      <p class="muted" style="margin-top:6px">${passed ? esc(step.title) : "Ünite sınavını geçmek için en az %60 gerekiyor. Biraz tekrar edip yeniden dene."}</p>
      ${passed ? `<div class="big-stars">${[1, 2, 3].map((n, i) => icon("star", n <= stars ? "on" : "")).join("")}</div>` : `<div style="height:30px"></div>`}
      <div class="result-stats">
        <div class="card" style="border-color:var(--gold)"><small style="color:var(--gold)">XP</small><div><div>+${xp}</div></div></div>
        <div class="card" style="border-color:var(--good)"><small style="color:var(--good)">Doğruluk</small><div><div>%${Math.round(acc * 100)}</div></div></div>
        <div class="card" style="border-color:var(--acc)"><small style="color:var(--acchi)">Süre</small><div><div>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}</div></div></div>
      </div>
      <p class="muted" id="saving" style="font-size:13px">Kaydediliyor…</p>
    </div>
    <div class="footbar"><div class="footbar-in"><span></span><button class="btn" id="done" disabled>DEVAM</button></div></div></div>`;
    sfx("done");
    try {
      if (mistakes.length) await store.addMistakes(courseId, mistakes);
      if (passed) await store.completeStep(courseId, stepId, stars, Math.round(acc * 100));
      await store.addXP(xp);
      await refreshProfile();
      el.querySelector("#saving").textContent = ctx.profile?.streak > 1 ? `🔥 ${ctx.profile.streak} günlük seri!` : "Kaydedildi.";
    } catch (e) {
      el.querySelector("#saving").innerHTML = `<span style="color:var(--bad)">Kaydedilemedi: ${esc(e.message)}</span>`;
    }
    const d = el.querySelector("#done");
    d.disabled = false;
    d.textContent = passed ? "DEVAM" : "TEKRAR DENE";
    d.onclick = () => (passed ? go("#/ogren") : render(el, { params: [courseId, stepId] }));
  }

  const onKey = (e) => {
    if (e.target.tagName === "INPUT" && e.key !== "Enter") return;
    if (e.key === "Enter") {
      const b = el.querySelector("#cont") || el.querySelector("#check:not(:disabled)") || el.querySelector("#next") || el.querySelector("#done:not(:disabled)");
      if (b) { e.preventDefault(); b.click(); }
    }
    if (/^[1-4]$/.test(e.key) && state === "answer") el.querySelectorAll(".opts .opt")[Number(e.key) - 1]?.click();
  };
  document.addEventListener("keydown", onKey);
  started = Date.now();
  show();
  return () => document.removeEventListener("keydown", onKey);
}

// ── Podcast adımı ──
function podcastStep(el, { course, step, unit, content }) {
  const voices = { A: ctx.profile?.voice_a || "Kore", B: ctx.profile?.voice_b || "Puck" };
  let stopFallback = null;
  el.innerHTML = `<div class="player">
    <div class="player-top"><button class="btn ghost sm" id="x">${icon("x")}</button><div class="progress"><div style="width:50%"></div></div></div>
    <div class="player-body fade">
      <div class="q-type">${icon("head")} Dinle</div>
      <h1 style="font-size:24px;font-weight:800">${esc(content.title)}</h1>
      <p class="muted" style="margin:4px 0 18px">${esc(unit.title)} · Seslendirenler: ${esc(voices.A)}${content.segments.some((s) => s.speaker === "Deniz") ? ` ve ${esc(voices.B)}` : ""} <a href="#/profil" class="linkish">değiştir</a></p>
      <div class="card player-card" id="pc"><button class="btn" id="gen">${icon("play")} Podcast'i dinle</button><p class="hint" id="pmsg"></p></div>
      <div class="card" style="margin-top:14px;padding:8px" id="tr">${content.segments.map((s, i) => `<div class="seg" data-i="${i}"><div class="who" style="color:${s.speaker === "Deniz" ? "var(--good)" : "var(--acchi)"}">${s.speaker === "Deniz" ? "Deniz" : "Ece"}</div><p>${esc(s.text)}</p></div>`).join("")}</div>
    </div>
    <div class="footbar"><div class="footbar-in"><span class="muted" style="font-size:13px">Dinledikten sonra adımı tamamla.</span><button class="btn" id="done">TAMAMLADIM</button></div></div>
  </div>`;
  el.querySelector("#x").onclick = () => { stopFallback?.(); go("#/ogren"); };
  el.querySelector("#gen").onclick = async () => {
    const pc = el.querySelector("#pc");
    const btn = el.querySelector("#gen");
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Ses hazırlanıyor…`;
    try {
      const blob = await podcastAudio(content.segments, voices, (m) => (btn.innerHTML = `<span class="spin"></span> ${esc(m)}`));
      pc.innerHTML = `<audio controls autoplay src="${URL.createObjectURL(blob)}" style="width:100%"></audio>`;
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = `${icon("play")} Tarayıcı sesiyle dinle`;
      el.querySelector("#pmsg").textContent = `${e.message} Şimdilik tarayıcının kendi sesiyle dinleyebilirsin.`;
      btn.onclick = () => {
        stopFallback?.();
        stopFallback = speakFallback(content.segments, (i) => el.querySelectorAll(".seg").forEach((s, j) => s.style.background = i === j ? "var(--acclo)" : ""));
      };
    }
  };
  el.querySelector("#done").onclick = async () => {
    stopFallback?.();
    const b = el.querySelector("#done");
    b.disabled = true;
    try {
      await store.completeStep(course.id, step.id, 3, 100);
      await store.addXP(10);
      await refreshProfile();
      sfx("done");
      toast("+10 XP", "good");
      go("#/ogren");
    } catch (e) {
      toast(e.message, "bad");
      b.disabled = false;
    }
  };
  return () => stopFallback?.();
}
