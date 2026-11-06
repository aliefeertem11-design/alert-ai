import { ctx, refreshProfile } from "../app.js";
import { store } from "../store.js";
import { ai, esc, icon, relevantExcerpt, toast, VOICES, fmtDate } from "../ui.js";
import { podcastAudio, speakFallback } from "../audio.js";

const STYLES = [
  ["sohbet", "İki kişilik sohbet", "Deniz sorar, Ece anlatır"],
  ["anlatim", "Anlatım", "Tek anlatıcı, akıcı ders"],
  ["tekrar", "Sınav tekrarı", "En önemli noktalar hızlıca"],
  ["hikaye", "Hikâyeyle öğren", "Akılda kalıcı örnekler"],
];
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export async function render(el) {
  const courses = await store.courses().catch(() => []);
  const s = { source: courses.length ? "course" : "text", courseId: courses[0]?.id || "", unit: "", text: "", style: "sohbet", minutes: 3, A: ctx.profile?.voice_a || "Kore", B: ctx.profile?.voice_b || "Puck" };
  let cleanupPlayer = null;

  async function draw() {
    const list = await store.podcasts().catch(() => []);
    const course = courses.find((c) => c.id === s.courseId);
    el.innerHTML = `
    <div class="page-h"><div><h1>Podcast</h1><p>Notlarını doğal sesli bir podcast'e dönüştür. Seslendireni sen seç.</p></div></div>
    <div id="playerSlot"></div>
    <div class="card fade" style="padding:22px;display:grid;gap:20px">
      <div>
        <label class="lbl">Kaynak</label>
        <div style="display:flex;gap:6px;margin-bottom:10px">${courses.length ? `<button class="chip ${s.source === "course" ? "on" : ""}" data-src="course">Çalışma yolum</button>` : ""}<button class="chip ${s.source === "text" ? "on" : ""}" data-src="text">Metin yapıştır</button></div>
        ${s.source === "course" ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <select class="field" id="course">${courses.map((c) => `<option value="${c.id}" ${c.id === s.courseId ? "selected" : ""}>${esc(c.subject)} · ${esc(c.exam_name)}</option>`).join("")}</select>
          <select class="field" id="unit"><option value="">Tüm konular</option>${(course?.plan.units || []).map((u, i) => `<option value="${i}" ${String(i) === s.unit ? "selected" : ""}>${esc(u.title)}</option>`).join("")}</select></div>`
        : `<textarea class="field" id="text" rows="5" placeholder="Podcast'e dönüştürülecek notları yapıştır…">${esc(s.text)}</textarea>`}
      </div>
      <div>
        <label class="lbl">Biçim</label>
        <div class="choice-grid">${STYLES.map(([k, l, d]) => `<button class="choice ${s.style === k ? "on" : ""}" data-style="${k}">${l}<small>${d}</small></button>`).join("")}</div>
      </div>
      <div>
        <label class="lbl">Süre</label>
        <div style="display:flex;gap:6px">${[2, 3, 5].map((m) => `<button class="chip ${s.minutes === m ? "on" : ""}" data-min="${m}">${m} dakika</button>`).join("")}</div>
      </div>
      <div>
        <label class="lbl">${s.style === "sohbet" ? "Ece'nin sesi (anlatan)" : "Seslendiren"}</label>
        <div class="voice-grid">${VOICES.map((v) => `<button class="voice ${s.A === v.id ? "on" : ""}" data-va="${v.id}"><b>${v.label}</b><small>${v.desc}</small></button>`).join("")}</div>
      </div>
      ${s.style === "sohbet" ? `<div><label class="lbl">Deniz'in sesi (soran)</label><div class="voice-grid">${VOICES.map((v) => `<button class="voice ${s.B === v.id ? "on" : ""}" data-vb="${v.id}"><b>${v.label}</b><small>${v.desc}</small></button>`).join("")}</div></div>` : ""}
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn lg" id="create">${icon("sparkle")} Podcast oluştur</button>
        <button class="btn sec" id="preview">${icon("volume")} Sesleri dinle</button>
        <span class="hint" id="cmsg" style="margin:0"></span>
      </div>
    </div>
    ${list.length ? `<h2 style="font-size:17px;font-weight:800;margin:28px 0 12px">Podcastlerim</h2><div class="card">${list.map((p) => `<div class="list-row"><button data-open="${p.id}" style="text-align:left;flex:1"><b style="font-weight:600">${esc(p.title)}</b><div class="muted" style="font-size:12.5px">${esc(STYLES.find((x) => x[0] === p.style)?.[1] || "")} · ${fmtDate(p.created_at)}</div></button><button data-del="${p.id}" class="muted" aria-label="Sil">${icon("trash")}</button></div>`).join("")}</div>` : ""}`;

    el.querySelectorAll("[data-src]").forEach((b) => (b.onclick = () => { s.source = b.dataset.src; draw(); }));
    el.querySelector("#course")?.addEventListener("change", (e) => { s.courseId = e.target.value; s.unit = ""; draw(); });
    el.querySelector("#unit")?.addEventListener("change", (e) => (s.unit = e.target.value));
    el.querySelector("#text")?.addEventListener("input", (e) => (s.text = e.target.value));
    el.querySelectorAll("[data-style]").forEach((b) => (b.onclick = () => { s.style = b.dataset.style; draw(); }));
    el.querySelectorAll("[data-min]").forEach((b) => (b.onclick = () => { s.minutes = Number(b.dataset.min); draw(); }));
    el.querySelectorAll("[data-va]").forEach((b) => (b.onclick = () => { s.A = b.dataset.va; saveVoices(); draw(); }));
    el.querySelectorAll("[data-vb]").forEach((b) => (b.onclick = () => { s.B = b.dataset.vb; saveVoices(); draw(); }));
    el.querySelector("#preview").onclick = preview;
    el.querySelector("#create").onclick = create;
    el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openPodcast(list.find((p) => p.id === b.dataset.open))));
    el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { await store.deletePodcast(b.dataset.del); toast("Podcast silindi."); draw(); }));
  }

  function saveVoices() {
    store.updateProfile({ voice_a: s.A, voice_b: s.B }).then(refreshProfile).catch(() => {});
  }

  async function preview() {
    const btn = el.querySelector("#preview");
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Hazırlanıyor`;
    try {
      const segs = s.style === "sohbet"
        ? [{ speaker: "Deniz", text: "Merhaba Ece! Bugün hangi konuyu konuşuyoruz?" }, { speaker: "Ece", text: "Merhaba Deniz! Bugün sınava birlikte hazırlanacağız. Hazırsan başlayalım." }]
        : [{ speaker: "Ece", text: "Merhaba! Ben senin ALERT AI podcast anlatıcınım. Bugün sınava birlikte hazırlanacağız." }];
      const blob = await podcastAudio(segs, { A: s.A, B: s.B });
      new Audio(URL.createObjectURL(blob)).play().catch(() => {});
    } catch (e) {
      el.querySelector("#cmsg").textContent = e.message;
    }
    btn.disabled = false;
    btn.innerHTML = `${icon("volume")} Sesleri dinle`;
  }

  async function create() {
    const btn = el.querySelector("#create");
    const msg = el.querySelector("#cmsg");
    let material = "";
    let topic = "";
    let courseId = null;
    if (s.source === "course") {
      const c = await store.course(s.courseId);
      courseId = c.id;
      const u = s.unit !== "" ? c.plan.units[Number(s.unit)] : null;
      topic = u ? `${c.subject}: ${u.title}` : `${c.subject} · ${c.exam_name}`;
      material = relevantExcerpt(c.material, u ? `${u.title} ${u.description}` : c.plan.units.map((x) => x.title).join(" "), 9000);
    } else {
      if (s.text.trim().length < 80) return (msg.textContent = "Lütfen biraz daha uzun bir metin yapıştır.");
      material = s.text.slice(0, 9000);
      topic = "Öğrencinin notları";
    }
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Senaryo yazılıyor…`;
    msg.textContent = "";
    try {
      const script = await ai("podcast", { topic, material, style: s.style, minutes: s.minutes });
      const saved = await store.savePodcast({ title: script.title, style: s.style, segments: script.segments, course_id: courseId });
      openPodcast(saved, true);
    } catch (e) {
      msg.textContent = e.message;
    }
    btn.disabled = false;
    btn.innerHTML = `${icon("sparkle")} Podcast oluştur`;
  }

  async function openPodcast(p, autoplay) {
    cleanupPlayer?.();
    const slot = el.querySelector("#playerSlot");
    const voices = { A: s.A, B: s.B };
    const two = p.segments.some((x) => x.speaker === "Deniz");
    slot.innerHTML = `<div class="card player-card fade" style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;gap:10px"><div><span class="badge">${icon("head")} Podcast</span><h2 style="font-size:20px;font-weight:800;margin-top:8px">${esc(p.title)}</h2>
      <p class="muted" style="font-size:13px">Seslendiren: ${esc(voices.A)}${two ? ` ve ${esc(voices.B)}` : ""}</p></div><button class="btn ghost sm" id="closep">${icon("x")}</button></div>
      <div id="pa"><div class="play-row"><span class="spin"></span><span class="muted" id="pst">Ses hazırlanıyor…</span></div></div>
      <div style="margin-top:14px;max-height:320px;overflow:auto" id="segs">${p.segments.map((x, i) => `<button class="seg" data-i="${i}"><div class="who" style="color:${x.speaker === "Deniz" ? "var(--good)" : "var(--acchi)"}">${x.speaker}</div><p>${esc(x.text)}</p></button>`).join("")}</div>
    </div>`;
    slot.scrollIntoView({ behavior: "smooth" });
    let stopFb = null;
    let audio = null;
    slot.querySelector("#closep").onclick = () => { cleanupPlayer?.(); slot.innerHTML = ""; };
    const segEls = [...slot.querySelectorAll(".seg")];
    const hl = (i) => segEls.forEach((e, j) => (e.style.background = i === j ? "var(--acclo)" : ""));
    cleanupPlayer = () => { audio?.pause(); stopFb?.(); };
    try {
      const blob = await podcastAudio(p.segments, voices, (m) => { const st = slot.querySelector("#pst"); if (st) st.textContent = m; });
      const url = URL.createObjectURL(blob);
      slot.querySelector("#pa").innerHTML = `<div class="play-row">
        <button class="play-btn" id="pp" aria-label="Oynat">${icon("play")}</button>
        <div style="flex:1;min-width:180px"><input type="range" id="seek" min="0" max="100" step="0.1" value="0"><div style="display:flex;justify-content:space-between;font-size:12px" class="muted"><span id="cur">0:00</span><span id="dur">0:00</span></div></div>
        <div class="speeds">${SPEEDS.map((v) => `<button data-sp="${v}" class="${v === 1 ? "on" : ""}">${v}x</button>`).join("")}</div>
        <a class="btn sec sm" href="${url}" download="${esc(p.title.replace(/[\\/:*?"<>|]/g, ""))}.wav">İndir</a>
      </div>`;
      audio = new Audio(url);
      const pp = slot.querySelector("#pp");
      const seek = slot.querySelector("#seek");
      const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
      // Döküm vurgusu: metin uzunluğuna göre yaklaşık zamanlama
      const lens = p.segments.map((x) => x.text.length + 25);
      const tot = lens.reduce((a, b) => a + b, 0);
      const bounds = lens.reduce((acc, l) => (acc.push((acc.at(-1) || 0) + l / tot), acc), []);
      audio.onloadedmetadata = () => (slot.querySelector("#dur").textContent = fmt(audio.duration));
      audio.ontimeupdate = () => {
        if (!audio.duration) return;
        seek.value = (audio.currentTime / audio.duration) * 100;
        slot.querySelector("#cur").textContent = fmt(audio.currentTime);
        const f = audio.currentTime / audio.duration;
        hl(bounds.findIndex((b) => f <= b));
      };
      audio.onplay = () => (pp.innerHTML = icon("pause"));
      audio.onpause = audio.onended = () => (pp.innerHTML = icon("play"));
      pp.onclick = () => (audio.paused ? audio.play() : audio.pause());
      seek.oninput = () => audio.duration && (audio.currentTime = (seek.value / 100) * audio.duration);
      segEls.forEach((e, i) => (e.onclick = () => { if (audio.duration) { audio.currentTime = (i ? bounds[i - 1] : 0) * audio.duration; audio.play(); } }));
      slot.querySelectorAll("[data-sp]").forEach((b) => (b.onclick = () => { audio.playbackRate = Number(b.dataset.sp); slot.querySelectorAll("[data-sp]").forEach((x) => x.classList.toggle("on", x === b)); }));
      if (autoplay) audio.play().catch(() => {});
    } catch (e) {
      slot.querySelector("#pa").innerHTML = `<div class="err" style="margin-top:12px">${esc(e.message)}</div><button class="btn sec" id="fb" style="margin-top:10px">${icon("play")} Tarayıcı sesiyle dinle</button>`;
      slot.querySelector("#fb").onclick = () => { stopFb?.(); stopFb = speakFallback(p.segments, hl, () => hl(-1)); };
    }
  }

  await draw();
  return () => cleanupPlayer?.();
}
