import { go, ctx, topStats } from "../app.js";
import { store } from "../store.js";
import { esc, icon, daysUntil, fmtDate, toast } from "../ui.js";

export const TYPE = {
  lesson: { icon: "book", label: "Ders", desc: "Kısa bir anlatım ve sorular" },
  practice: { icon: "dumbbell", label: "Pratik", desc: "Karışık alıştırma soruları" },
  cards: { icon: "cards", label: "Kartlar", desc: "Bilgi kartlarıyla hızlı tekrar" },
  podcast: { icon: "head", label: "Dinle", desc: "Konunun sesli özeti" },
  review: { icon: "repeat", label: "Tekrar", desc: "Önceki konular ve hataların" },
  boss: { icon: "crown", label: "Ünite sınavı", desc: "Üniteyi bitirmek için son sınav" },
};
const OFFSETS = [0, -70, -105, -70, 0, 70, 105, 70];

export function flatSteps(plan) {
  return plan.units.flatMap((u, ui) => u.steps.map((s) => ({ ...s, unit: ui })));
}

export async function render(el) {
  const courses = await store.courses();
  if (!courses.length) {
    el.innerHTML = `
      <div class="learn-top"><div></div>${topStats()}</div>
      <div class="card fade" style="text-align:center;padding:56px 24px;margin-top:20px">
        <div class="gen-anim" style="padding:0"><div class="orb" style="width:80px;height:80px"></div></div>
        <h1 style="font-size:26px;font-weight:800">Merhaba${ctx.profile?.name ? " " + esc(ctx.profile.name) : ""}! İlk yolunu oluşturalım.</h1>
        <p class="muted" style="margin:10px auto 24px;max-width:440px">Hedef notunu, dersini ve notlarını söyle; yapay zekâ sana özel adım adım bir çalışma yolu hazırlasın.</p>
        <a href="#/yeni" class="btn lg">${icon("plus")} Çalışma yolu oluştur</a>
      </div>`;
    return;
  }
  let cid = null;
  try { cid = localStorage.getItem("alertai_course"); } catch {}
  const course = await store.course(courses.some((c) => c.id === cid) ? cid : courses[0].id);
  const progress = await store.progress(course.id);
  const steps = flatSteps(course.plan);
  const currentIdx = steps.findIndex((s) => !progress[s.id]?.completed_at);
  const doneCount = steps.filter((s) => progress[s.id]?.completed_at).length;
  const activity = await store.activity(1).catch(() => []);
  const todayXP = activity.find((a) => a.day === new Date().toLocaleDateString("sv-SE"))?.xp || 0;
  const goal = ctx.profile?.daily_goal || 30;
  const mistakes = await store.mistakes(course.id).catch(() => []);
  const d = daysUntil(course.exam_date);

  let gi = 0;
  const unitsHTML = course.plan.units
    .map((u, ui) => {
      const us = u.steps;
      const uDone = us.every((s) => progress[s.id]?.completed_at);
      const uLocked = !uDone && steps.findIndex((s) => s.id === us[0].id) > currentIdx && currentIdx !== -1;
      return `<section class="unit">
        <div class="unit-banner ${uDone ? "done" : uLocked ? "locked" : ""}">
          <div><small>Ünite ${ui + 1}</small><h2>${esc(u.title)}</h2>${u.description ? `<p>${esc(u.description)}</p>` : ""}</div>
          ${uDone ? icon("check") : ""}
        </div>
        <div class="path">
          ${us
            .map((s) => {
              const idx = steps.findIndex((x) => x.id === s.id);
              const pr = progress[s.id];
              const state = pr?.completed_at ? "done" : idx === currentIdx ? "current" : "locked";
              const off = OFFSETS[gi++ % OFFSETS.length];
              const t = TYPE[s.type] || TYPE.practice;
              return `<div class="node-wrap" style="transform:translateX(${off}px)" data-step="${s.id}">
                ${state === "current" ? `<span class="start-bubble">BAŞLA</span>` : ""}
                <button class="node ${state} ${s.type === "boss" ? "boss" : ""}" aria-label="${esc(s.title)}">${icon(state === "locked" ? (s.type === "boss" ? "crown" : "lock") : state === "done" && s.type !== "boss" ? "check" : t.icon)}</button>
                ${state === "done" ? `<div class="stars">${[1, 2, 3].map((n) => icon("star", n <= (pr.stars || 0) ? "on" : "")).join("")}</div>` : ""}
                <div class="node-label">${esc(s.title)}</div>
              </div>`;
            })
            .join("")}
        </div>
      </section>`;
    })
    .join("");

  el.innerHTML = `
  <div class="learn-top">
    <div class="course-sel">
      ${courses.length > 1 ? courses.map((c) => `<button class="chip ${c.id === course.id ? "on" : ""}" data-course="${c.id}">${esc(c.subject)} · ${esc(c.exam_name)}</button>`).join("") : `<span style="font-weight:700">${esc(course.subject)} · ${esc(course.exam_name)}</span>`}
      <a href="#/yeni" class="chip">${icon("plus")} Yeni yol</a>
    </div>
    ${topStats()}
  </div>
  <div class="learn">
    <div class="fade">${unitsHTML}
      ${currentIdx === -1 ? `<div class="card" style="padding:24px;text-align:center"><h2 style="font-weight:800">Tebrikler, yolu tamamladın! 🎉</h2><p class="muted" style="margin-top:6px">Adımları tekrar çalışarak yıldızlarını artırabilir ya da yeni bir yol oluşturabilirsin.</p></div>` : ""}
    </div>
    <aside class="side-cards">
      <div class="card">
        <h3>Günlük hedef</h3>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px"><span class="muted">${todayXP >= goal ? "Bugünkü hedef tamam!" : "Bugün"}</span><b style="color:var(--gold)">${todayXP}/${goal} XP</b></div>
        <div class="goal-bar"><div style="width:${Math.min(100, (todayXP / goal) * 100)}%"></div></div>
      </div>
      <div class="card">
        <h3>${icon("target")} Hedefin</h3>
        <div style="display:flex;align-items:baseline;gap:8px"><span class="target-big">${esc(course.target_grade || "—")}</span><span class="muted" style="font-size:13px">${esc(course.scale || "")}</span></div>
        <p class="muted" style="font-size:13px;margin:8px 0 12px">${course.exam_date ? `${fmtDate(course.exam_date)} · ${d >= 0 ? `${d} gün kaldı` : "sınav tarihi geçti"}` : "Sınav tarihi belirtilmedi"}</p>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span class="muted">Yol ilerlemesi</span><span>${doneCount}/${steps.length}</span></div>
        <div class="progress"><div style="width:${(doneCount / steps.length) * 100}%"></div></div>
        ${course.plan.tip ? `<p style="font-size:13px;color:var(--ink2);margin-top:12px">${esc(course.plan.tip)}</p>` : ""}
      </div>
      <div class="card">
        <h3>Hata defteri</h3>
        <p class="muted" style="font-size:13px">${mistakes.length ? `${mistakes.length} soruyu yanlış yaptın. “Tekrar” adımlarında bunlara benzer sorular gelir.` : "Henüz hata yok. Yanlış yaptığın sorular burada toplanır."}</p>
        ${mistakes.length ? `<a href="#/profil" class="linkish" style="font-size:13px;display:inline-block;margin-top:8px">Hatalarımı gör →</a>` : ""}
      </div>
      <button class="btn ghost sm" id="delcourse" style="justify-self:start">${icon("trash")} Bu yolu sil</button>
    </aside>
  </div>`;

  el.querySelectorAll("[data-course]").forEach((b) => (b.onclick = () => { try { localStorage.setItem("alertai_course", b.dataset.course); } catch {} go("#/ogren"); }));

  let open = null;
  const closePop = () => { if (open) open.parentElement.style.zIndex = ""; open?.remove(); open = null; };
  el.querySelectorAll("[data-step]").forEach((w) => {
    const btn = w.querySelector(".node");
    btn.onclick = (e) => {
      e.stopPropagation();
      const had = open && open.parentElement === w;
      closePop();
      if (had) return;
      const s = steps.find((x) => x.id === w.dataset.step);
      const state = btn.classList.contains("done") ? "done" : btn.classList.contains("current") ? "current" : "locked";
      const t = TYPE[s.type] || TYPE.practice;
      open = document.createElement("div");
      open.className = "pop fade";
      open.innerHTML = state === "locked"
        ? `<h4>${esc(s.title)}</h4><p>Bu adımı açmak için önceki adımları tamamla.</p><button class="btn block sec" disabled>${icon("lock")} Kilitli</button>`
        : `<h4>${esc(s.title)}</h4><p>${t.label} · ${t.desc}</p><button class="btn block" id="startstep">${state === "done" ? "TEKRAR ÇALIŞ" : `BAŞLA · +${s.type === "boss" ? 30 : 15} XP`}</button>`;
      w.appendChild(open);
      w.style.zIndex = 30;
      open.onclick = (ev) => ev.stopPropagation();
      open.querySelector("#startstep")?.addEventListener("click", () => go(`#/adim/${course.id}/${s.id}`));
    };
  });
  document.addEventListener("click", closePop);

  el.querySelector("#delcourse").onclick = async () => {
    const m = document.createElement("div");
    m.className = "modal-bg";
    m.innerHTML = `<div class="card modal fade"><h3 style="font-weight:800">Bu yol silinsin mi?</h3><p class="muted" style="margin:8px 0 18px;font-size:14px">${esc(course.exam_name)} yolu ve ilerlemesi kalıcı olarak silinecek.</p><div style="display:flex;gap:10px"><button class="btn sec" style="flex:1" id="no">Vazgeç</button><button class="btn bad" style="flex:1" id="yes">Sil</button></div></div>`;
    document.body.appendChild(m);
    m.querySelector("#no").onclick = () => m.remove();
    m.querySelector("#yes").onclick = async () => {
      await store.deleteCourse(course.id);
      m.remove();
      toast("Yol silindi.");
      go("#/ogren");
    };
  };

  const cur = el.querySelector(".node.current");
  if (cur) setTimeout(() => cur.scrollIntoView({ block: "center", behavior: "smooth" }), 200);
  return () => document.removeEventListener("click", closePop);
}
