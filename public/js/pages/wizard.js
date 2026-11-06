import { go, ctx, refreshProfile } from "../app.js";
import { store } from "../store.js";
import { ai, esc, icon, spinner, extractText, daysUntil } from "../ui.js";

const SUBJECTS = ["Matematik", "Fizik", "Kimya", "Biyoloji", "Tarih", "Coğrafya", "Edebiyat", "Türkçe", "İngilizce", "Almanca", "Felsefe", "Bilgisayar"];
const SCALES = [
  { id: "100", label: "100 üzerinden", min: 0, max: 100, def: 85, step: 5 },
  { id: "5", label: "5 üzerinden", min: 1, max: 5, def: 5, step: 1 },
  { id: "ib", label: "IB (1-7)", min: 1, max: 7, def: 6, step: 1 },
  { id: "net", label: "Net (YKS/LGS)", min: 0, max: 120, def: 80, step: 5 },
];
const LEVELS = [
  ["Hiç bilmiyorum", "Sıfırdan başlıyorum"],
  ["Biraz biliyorum", "Temel kavramları duydum"],
  ["Orta", "Bazı konular tamam"],
  ["İyi", "Pekiştirmem gerek"],
  ["Çok iyi", "Sadece tekrar"],
];
const GRADES = ["5. sınıf", "6. sınıf", "7. sınıf", "8. sınıf", "9. sınıf", "10. sınıf", "11. sınıf", "12. sınıf", "Üniversite", "Diğer"];

export function render(el) {
  const s = { scale: "100", target: 85, subject: "", custom: "", exam: "", date: "", level: 2, grade: ctx.profile?.grade || "", material: [], text: "" };
  let step = 0;

  const steps = [
    {
      ok: () => s.target !== "",
      html: () => {
        const sc = SCALES.find((x) => x.id === s.scale);
        const pct = (Number(s.target) - sc.min) / (sc.max - sc.min);
        const meter = pct >= 0.9 ? "İddialı bir hedef! Yolun buna göre yoğun olacak." : pct >= 0.7 ? "Güzel hedef. Düzenli çalışmayla ulaşılır." : "Sağlam bir başlangıç hedefi.";
        return `<h1>Bu sınavdan kaç almak istiyorsun?</h1><p class="sub">Hedefine göre yolunun yoğunluğunu ayarlayacağız.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">${SCALES.map((x) => `<button class="chip ${x.id === s.scale ? "on" : ""}" data-scale="${x.id}">${x.label}</button>`).join("")}</div>
          <div class="grade-input"><button data-d="-1" aria-label="Azalt">−</button><input id="target" inputmode="numeric" value="${esc(s.target)}" aria-label="Hedef not"><button data-d="1" aria-label="Artır">+</button></div>
          <p class="grade-meter">${meter}</p>`;
      },
      bind: (root) => {
        root.querySelectorAll("[data-scale]").forEach((b) => (b.onclick = () => { s.scale = b.dataset.scale; s.target = SCALES.find((x) => x.id === s.scale).def; draw(); }));
        root.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => {
          const sc = SCALES.find((x) => x.id === s.scale);
          s.target = Math.max(sc.min, Math.min(sc.max, Number(s.target || 0) + Number(b.dataset.d) * sc.step));
          draw();
        }));
        const inp = root.querySelector("#target");
        inp.oninput = () => {
          const sc = SCALES.find((x) => x.id === s.scale);
          const v = inp.value.replace(/[^\d]/g, "");
          s.target = v === "" ? "" : Math.max(sc.min, Math.min(sc.max, Number(v)));
        };
        inp.onblur = draw;
      },
    },
    {
      ok: () => (s.subject === "__" ? s.custom.trim() : s.subject),
      html: () => `<h1>Hangi ders için?</h1><p class="sub">Birden fazla ders için daha sonra ayrı yollar oluşturabilirsin.</p>
        <div class="choice-grid">${SUBJECTS.map((x) => `<button class="choice ${s.subject === x ? "on" : ""}" data-sub="${x}">${x}</button>`).join("")}<button class="choice ${s.subject === "__" ? "on" : ""}" data-sub="__">Diğer…</button></div>
        ${s.subject === "__" ? `<input class="field" id="custom" style="margin-top:12px" placeholder="Ders adı" value="${esc(s.custom)}" maxlength="60">` : ""}`,
      bind: (root) => {
        root.querySelectorAll("[data-sub]").forEach((b) => (b.onclick = () => { s.subject = b.dataset.sub; draw(); }));
        const c = root.querySelector("#custom");
        if (c) { c.focus(); c.oninput = () => { s.custom = c.value; updateFoot(); }; }
      },
    },
    {
      ok: () => s.exam.trim(),
      html: () => `<h1>Hangi sınava hazırlanıyorsun?</h1><p class="sub">Sınav tarihini bilirsen planı ona göre sıkıştırırız.</p>
        <label class="lbl">Sınavın adı</label><input class="field" id="exam" value="${esc(s.exam)}" placeholder="Örn. ${esc(subj())} 1. Dönem 1. Yazılı" maxlength="100">
        <label class="lbl" style="margin-top:18px">Sınav tarihi <span class="muted">(isteğe bağlı)</span></label><input class="field" id="date" type="date" value="${esc(s.date)}" min="${new Date().toLocaleDateString("sv-SE")}" style="max-width:240px">`,
      bind: (root) => {
        const e = root.querySelector("#exam");
        e.focus();
        e.oninput = () => { s.exam = e.value; updateFoot(); };
        root.querySelector("#date").onchange = (ev) => (s.date = ev.target.value);
      },
    },
    {
      ok: () => true,
      html: () => `<h1>Bu konuları ne kadar biliyorsun?</h1><p class="sub">Dürüst ol; yolun buna göre başlayacak.</p>
        <div class="choice-grid">${LEVELS.map(([t, d], i) => `<button class="choice ${s.level === i ? "on" : ""}" data-lv="${i}">${t}<small>${d}</small></button>`).join("")}</div>
        <label class="lbl" style="margin-top:22px">Sınıfın</label>
        <select class="field" id="grade" style="max-width:240px"><option value="">Seç</option>${GRADES.map((g) => `<option ${g === s.grade ? "selected" : ""}>${g}</option>`).join("")}</select>`,
      bind: (root) => {
        root.querySelectorAll("[data-lv]").forEach((b) => (b.onclick = () => { s.level = Number(b.dataset.lv); draw(); }));
        root.querySelector("#grade").onchange = (e) => (s.grade = e.target.value);
      },
    },
    {
      ok: () => !busyReading,
      html: () => `<h1>Notlarını ekle</h1><p class="sub">Ders notları, kitap bölümü, çalışma kâğıdı ya da fotoğraf. Yol ve sorular bunlardan hazırlanır. Atlarsan genel konulardan başlarız.</p>
        <label class="drop" id="drop">${icon("upload")}<b>Dosya seç ya da buraya sürükle</b><span class="muted" style="font-size:13px">PDF, TXT veya fotoğraf (el yazısı da olur)</span><input type="file" id="file" accept=".pdf,.txt,.md,image/*" multiple hidden></label>
        <div id="files">${s.material.map((m, i) => `<div class="file-row"><span>${esc(m.name)} · ${m.text.length.toLocaleString("tr-TR")} karakter</span><button data-rm="${i}" aria-label="Kaldır">${icon("x")}</button></div>`).join("")}</div>
        <div id="readmsg"></div>
        <label class="lbl" style="margin-top:20px">ya da metni yapıştır</label>
        <textarea class="field" id="text" rows="5" placeholder="Notlarını buraya yapıştır…">${esc(s.text)}</textarea>`,
      bind: (root) => {
        const input = root.querySelector("#file");
        const drop = root.querySelector("#drop");
        const handle = async (files) => {
          const msg = root.querySelector("#readmsg");
          for (const f of files) {
            if (f.size > 20 * 1024 * 1024) { msg.innerHTML = `<div class="err" style="margin-top:8px">${esc(f.name)}: 20 MB'tan büyük.</div>`; continue; }
            busyReading = true;
            updateFoot();
            msg.innerHTML = `<p class="hint">${spinner(`${f.name} okunuyor…`)}</p>`;
            try {
              const text = await extractText(f, (t) => (msg.innerHTML = `<p class="hint">${spinner(t)}</p>`));
              if (text.trim().length < 20) throw new Error("Dosyada okunabilir metin bulunamadı.");
              s.material.push({ name: f.name, text: text.slice(0, 120000) });
              msg.innerHTML = "";
            } catch (e) {
              msg.innerHTML = `<div class="err" style="margin-top:8px">${esc(f.name)}: ${esc(e.message)}</div>`;
            }
            busyReading = false;
          }
          const keep = root.querySelector("#readmsg").innerHTML;
          draw();
          el.querySelector("#readmsg").innerHTML = keep;
        };
        input.onchange = () => handle([...input.files]);
        drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
        drop.ondragleave = () => drop.classList.remove("over");
        drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); handle([...e.dataTransfer.files]); };
        root.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); s.material.splice(Number(b.dataset.rm), 1); draw(); }));
        root.querySelector("#text").oninput = (e) => (s.text = e.target.value);
      },
    },
  ];
  let busyReading = false;
  const subj = () => (s.subject === "__" ? s.custom.trim() : s.subject) || "Kimya";

  function draw() {
    el.innerHTML = `
    <div class="main-inner"><div class="wizard">
      <div class="wiz-top">
        <button class="btn ghost sm" id="close" aria-label="Kapat">${icon("x")}</button>
        <div class="progress"><div style="width:${((step + 1) / (steps.length + 1)) * 100}%"></div></div>
      </div>
      <div class="fade" id="body">${steps[step].html()}</div>
      <div class="wiz-foot">
        <button class="btn sec" id="back" ${step === 0 ? "style='visibility:hidden'" : ""}>Geri</button>
        <button class="btn" id="next">${step === steps.length - 1 ? (hasMaterial() ? "Yolumu oluştur" : "Materyalsiz devam et") : "Devam"}</button>
      </div>
    </div></div>`;
    steps[step].bind(el.querySelector("#body"));
    el.querySelector("#close").onclick = () => go("#/ana");
    el.querySelector("#back").onclick = () => { step--; draw(); };
    el.querySelector("#next").onclick = () => {
      if (!steps[step].ok()) return;
      if (step < steps.length - 1) { step++; draw(); } else generate();
    };
    updateFoot();
  }
  const hasMaterial = () => s.material.length || s.text.trim().length > 30;
  function updateFoot() {
    const n = el.querySelector("#next");
    if (n) n.disabled = !steps[step].ok();
  }

  async function generate() {
    const material = [...s.material.map((m) => `### ${m.name}\n${m.text}`), s.text.trim()].filter(Boolean).join("\n\n").slice(0, 150000);
    const sc = SCALES.find((x) => x.id === s.scale);
    const tasks = ["Notların okunuyor", "Konular belirleniyor", `Hedef ${s.target}'e göre yol çiziliyor`, "Adımlar hazırlanıyor"];
    let ti = 0;
    const paint = (err) => {
      el.innerHTML = `<div class="main-inner"><div class="wizard"><div class="gen-anim fade">
        <div class="orb"></div>
        <h1>${err ? "Bir sorun oluştu" : "Yolun hazırlanıyor…"}</h1>
        ${err ? `<div class="err" style="margin-top:18px">${esc(err)}</div><div style="display:flex;gap:10px;justify-content:center;margin-top:20px"><button class="btn sec" id="back">Geri dön</button><button class="btn" id="retry">Tekrar dene</button></div>` : `<ul>${tasks.map((t, i) => `<li class="${i < ti ? "done" : i === ti ? "on" : ""}">${i < ti ? icon("check") : i === ti ? '<span class="spin"></span>' : '<span style="width:18px"></span>'} ${t}</li>`).join("")}</ul>`}
      </div></div></div>`;
      if (err) {
        el.querySelector("#retry").onclick = generate;
        el.querySelector("#back").onclick = draw;
      }
    };
    paint();
    const timer = setInterval(() => { if (ti < tasks.length - 1) { ti++; paint(); } }, 2600);
    try {
      if (s.grade && s.grade !== ctx.profile?.grade) await store.updateProfile({ grade: s.grade }).then(refreshProfile).catch(() => {});
      const plan = await ai("plan", {
        subject: subj(), examName: s.exam.trim(), targetGrade: String(s.target), scale: sc.label, level: s.level + 1,
        daysLeft: daysUntil(s.date), grade: s.grade, material: material.slice(0, 60000),
      });
      const course = await store.createCourse({
        subject: subj(), exam_name: s.exam.trim(), exam_date: s.date || null, target_grade: String(s.target), scale: sc.label, level: s.level + 1,
        material: material.slice(0, 150000), plan,
      });
      clearInterval(timer);
      try { localStorage.setItem("alertai_course", course.id); } catch {}
      // İlk adımı hemen arka planda hazırlamaya başla.
      import("./player.js").then(async (m) => {
        const { flatSteps } = await import("./learn.js");
        const c = { ...course, plan: course.plan || plan };
        for (const s of flatSteps(c.plan).slice(0, 2)) await m.prefetchStep(c, s);
      }).catch(() => {});
      const nSteps = plan.units.reduce((n, u) => n + u.steps.length, 0);
      el.innerHTML = `<div class="main-inner"><div class="wizard"><div class="gen-anim fade">
        <div class="orb" style="animation:none;background:radial-gradient(circle at 35% 30%,#8fe0bd,#4fae86 55%,#1d4a38);box-shadow:0 0 60px rgba(79,174,134,.45)"></div>
        <h1>Yolun hazır!</h1>
        <p class="sub" style="margin-top:10px">${plan.units.length} ünite · ${nSteps} adım${plan.dailyMinutes ? ` · günde ~${plan.dailyMinutes} dakika` : ""}</p>
        ${plan.tip ? `<div class="card" style="padding:16px;text-align:left;margin:18px auto;max-width:460px"><b style="color:var(--acchi);font-size:13px">HEDEF ${esc(s.target)} İÇİN STRATEJİN</b><p style="margin-top:6px;color:var(--ink2)">${esc(plan.tip)}</p></div>` : ""}
        <button class="btn lg" id="startpath">Yola başla</button>
      </div></div></div>`;
      el.querySelector("#startpath").onclick = () => go("#/ogren");
    } catch (e) {
      clearInterval(timer);
      paint(e.message);
    }
  }

  draw();
}
