import { ctx } from "../app.js";
import { store } from "../store.js";
import { ai, aiStream, esc, md, icon, relevantExcerpt } from "../ui.js";
import { podcastAudio, speakFallback } from "../audio.js";

const MODES = [
  ["explain", "Açıkla"],
  ["socratic", "Sokratik"],
  ["solver", "Çözücü"],
  ["hint", "İpucu"],
  ["practice", "Pratik"],
];

export async function render(el) {
  const courses = await store.courses().catch(() => []);
  let mode = "explain";
  let courseId = "";
  const history = [];
  let busy = false;
  let recog = null;
  let currentAudio = null;

  el.innerHTML = `
  <div class="chat-wrap">
    <div class="page-h" style="margin-bottom:12px"><div><h1>AI Eğitmen</h1><p>Takıldığın her şeyi sor. Yolundaki notlarını da kullanabilir.</p></div>
      ${courses.length ? `<select class="field" id="course" style="width:auto;min-width:220px"><option value="">Genel sohbet</option>${courses.map((c) => `<option value="${c.id}">${esc(c.subject)} · ${esc(c.exam_name)}</option>`).join("")}</select>` : ""}
    </div>
    <div class="chat-modes">${MODES.map(([k, l]) => `<button class="chip ${k === mode ? "on" : ""}" data-m="${k}">${l}</button>`).join("")}</div>
    <div class="chat-log" id="log">
      <div class="empty-chat" id="empty"><div class="av">${icon("chat")}</div><h2 style="font-weight:800">Bugün neyi öğrenmek istersin?</h2><p class="muted" style="margin-top:6px">Bir kavram, bir problem ya da ödevdeki takıldığın yer.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px">
          ${["Türevi basitçe anlatır mısın?", "x² − 5x + 6 = 0 denklemini çöz", "Hücre bölünmesini 5 maddede özetle", "Bana 3 soru sorarak beni test et"].map((s) => `<button class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join("")}
        </div></div>
    </div>
    <div class="composer">
      <button class="icon-btn" id="mic" title="Konuşarak yaz" aria-label="Mikrofon">${icon("mic")}</button>
      <textarea class="field" id="in" rows="1" placeholder="Bir soru sor…"></textarea>
      <button class="btn" id="send" style="height:50px;width:50px;padding:0" aria-label="Gönder">${icon("send")}</button>
    </div>
  </div>`;

  const log = el.querySelector("#log");
  const input = el.querySelector("#in");
  el.querySelector("#course")?.addEventListener("change", (e) => (courseId = e.target.value));
  el.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; el.querySelectorAll("[data-m]").forEach((x) => x.classList.toggle("on", x === b)); }));
  el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { input.value = b.dataset.s; send(); }));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(160, input.scrollHeight) + "px"; });
  el.querySelector("#send").onclick = send;

  function add(role, html) {
    el.querySelector("#empty")?.remove();
    const d = document.createElement("div");
    d.className = role === "user" ? "msg-u fade" : "msg-a fade";
    d.innerHTML = role === "user" ? html : `<div class="av">${icon("sparkle")}</div><div><div class="bub md">${html}</div></div>`;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    input.value = "";
    input.style.height = "auto";
    add("user", esc(text));
    history.push({ role: "user", content: text });
    const pending = add("assistant", `<span class="spin"></span>`);
    try {
      let material = "";
      let subject = "";
      if (courseId) {
        const c = await store.course(courseId);
        subject = c.subject;
        material = relevantExcerpt(c.material, history.slice(-3).map((h) => h.content).join(" "), 6000);
      }
      let raf = 0;
      const bub = pending.querySelector(".bub");
      const full = await aiStream("tutor", { messages: history, mode, grade: ctx.profile?.grade, subject, material }, (t) => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80; bub.innerHTML = md(t); if (near) log.scrollTop = log.scrollHeight; });
      });
      cancelAnimationFrame(raf);
      const r = { text: full };
      history.push({ role: "assistant", content: r.text });
      bub.innerHTML = md(r.text);
      log.scrollTop = log.scrollHeight;
      const tools = document.createElement("div");
      tools.className = "msg-tools";
      tools.innerHTML = `<button data-listen>${icon("volume")} Dinle</button><button data-copy>Kopyala</button>`;
      pending.querySelector(".bub").after(tools);
      tools.querySelector("[data-copy]").onclick = () => navigator.clipboard?.writeText(r.text).catch(() => {});
      tools.querySelector("[data-listen]").onclick = async (ev) => {
        const b = ev.currentTarget;
        currentAudio?.pause?.();
        b.innerHTML = `<span class="spin"></span> Hazırlanıyor`;
        const plain = r.text.replace(/\$\$?([^$]+)\$\$?/g, "$1").replace(/[*#_`>]/g, "").slice(0, 2400);
        try {
          const blob = await podcastAudio([{ speaker: "Ece", text: plain }], { A: ctx.profile?.voice_a || "Kore", B: ctx.profile?.voice_b || "Puck" });
          currentAudio = new Audio(URL.createObjectURL(blob));
          currentAudio.play();
        } catch {
          const stop = speakFallback([{ speaker: "Ece", text: plain }]);
          currentAudio = { pause: stop };
        }
        b.innerHTML = `${icon("volume")} Dinle`;
      };
    } catch (e) {
      history.pop();
      pending.querySelector(".bub").innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`;
      input.value = text;
    }
    busy = false;
    log.scrollTop = log.scrollHeight;
  }

  // Mikrofon: tarayıcının ücretsiz konuşma tanıması (Chrome, Edge, Safari)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = el.querySelector("#mic");
  if (!SR) micBtn.style.display = "none";
  micBtn.onclick = () => {
    if (recog) { recog.stop(); return; }
    recog = new SR();
    recog.lang = "tr-TR";
    recog.interimResults = true;
    recog.continuous = true;
    const startText = input.value;
    recog.onresult = (e) => { input.value = startText + [...e.results].map((r) => r[0].transcript).join(""); };
    recog.onend = () => { micBtn.classList.remove("rec"); recog = null; };
    recog.onerror = (e) => { if (e.error === "not-allowed") input.placeholder = "Mikrofon izni verilmedi."; };
    micBtn.classList.add("rec");
    recog.start();
  };

  return () => { recog?.stop(); currentAudio?.pause?.(); };
}
