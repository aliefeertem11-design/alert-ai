import { ai, esc, md, icon, shrinkImage, toBase64 } from "../ui.js";
import { go } from "../app.js";

export function render(el) {
  let file = null;
  el.innerHTML = `
  <div class="page-h"><div><h1>Çek &amp; Çöz</h1><p>Sorunun fotoğrafını çek ya da yükle; adım adım çözümünü gör.</p></div></div>
  <div class="solve">
    <div class="card fade" style="padding:18px;display:grid;gap:12px">
      <label class="drop" id="drop">${icon("cam")}<b>Fotoğraf çek ya da seç</b><span class="muted" style="font-size:13px">Matematik, fizik, kimya, biyoloji, dil…</span><input type="file" id="file" accept="image/*" capture="environment" hidden></label>
      <img class="prev" id="prev" alt="" hidden>
      <input class="field" id="note" placeholder="İsteğe bağlı not (örn. sadece 3. soru)">
      <button class="btn block" id="go" disabled>Çöz</button>
      <p class="hint" style="margin:0">İpucu: Sorunun tamamı görünsün, ışık iyi olsun.</p>
    </div>
    <div id="out"><div class="card" style="padding:40px;text-align:center;color:var(--muted)">Çözüm burada görünecek.</div></div>
  </div>`;
  const input = el.querySelector("#file");
  const pick = (f) => {
    if (!f || !f.type.startsWith("image/")) return;
    file = f;
    const p = el.querySelector("#prev");
    p.src = URL.createObjectURL(f);
    p.hidden = false;
    el.querySelector("#go").disabled = false;
  };
  input.onchange = () => pick(input.files[0]);
  const drop = el.querySelector("#drop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0]); };

  el.querySelector("#go").onclick = async () => {
    const btn = el.querySelector("#go");
    const out = el.querySelector("#out");
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Çözülüyor…`;
    out.innerHTML = `<div class="card" style="padding:40px;text-align:center"><span class="spin"></span><p class="muted" style="margin-top:10px">Soru okunuyor ve çözülüyor…</p></div>`;
    try {
      const small = await shrinkImage(file);
      const r = await ai("solve", { mime: small.type || "image/jpeg", image: await toBase64(small), note: el.querySelector("#note").value });
      out.innerHTML = `<div class="fade">
        <div class="card step-box"><div style="display:flex;gap:8px;margin-bottom:8px"><span class="badge" style="background:var(--acclo);color:var(--acchi)">${esc(r.subject || "Soru")}</span>${r.confidence === "low" ? `<span class="badge" style="background:var(--goldlo);color:var(--gold)">Görsel tam okunamadı — kontrol et</span>` : ""}</div><div class="md">${md(r.question || "")}</div></div>
        ${(r.steps || []).map((s, i) => `<div class="card step-box"><div class="t">Adım ${i + 1} · ${esc(s.title)}</div><div class="md">${md(s.body)}</div></div>`).join("")}
        <div class="card step-box final"><div class="t">Sonuç</div><div class="md" style="font-size:17px">${md(r.answer || "")}</div></div>
        ${r.similar?.question ? `<div class="card step-box"><div class="t">Benzer alıştırma</div><div class="md">${md(r.similar.question)}</div><details style="margin-top:8px"><summary class="linkish" style="cursor:pointer">Cevabı göster</summary><div class="md" style="margin-top:6px">${md(r.similar.answer)}</div></details></div>` : ""}
        <button class="btn sec" id="ask">${icon("chat")} Eğitmene sor</button>
        <p class="hint">Yapay zekâ çözümleri hatalı olabilir; sonucu kontrol etmeyi unutma.</p>
      </div>`;
      out.querySelector("#ask").onclick = () => go("#/egitmen");
    } catch (e) {
      out.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = "Tekrar çöz";
  };
}
