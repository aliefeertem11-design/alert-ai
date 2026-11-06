import { go, ctx, topStats, isAdmin } from "../app.js";
import { store } from "../store.js";
import { esc, icon, daysUntil } from "../ui.js";
import { flatSteps } from "./learn.js";

const greet = () => {
  const h = new Date().getHours();
  return h < 6 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
};

export async function render(el) {
  const p = ctx.profile || {};
  const [courses, activity] = await Promise.all([store.courses(), store.activity(1).catch(() => [])]);
  const progresses = await Promise.all(courses.map((c) => store.progress(c.id).catch(() => ({}))));
  const todayXP = activity.reduce((n, a) => n + (a.xp || 0), 0);
  const goal = p.daily_goal || 30;
  const goalPct = Math.min(100, Math.round((todayXP / goal) * 100));

  const cards = courses.map((c, i) => {
    const steps = flatSteps(c.plan);
    const pr = progresses[i] || {};
    const done = steps.filter((s) => pr[s.id]?.completed_at).length;
    const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
    const left = daysUntil(c.exam_date);
    const next = steps.find((s) => !pr[s.id]?.completed_at);
    return { c, done, total: steps.length, pct, left, next };
  });
  let lastId = null;
  try { lastId = localStorage.getItem("alertai_course"); } catch {}
  const cont = cards.find((x) => x.c.id === lastId && x.next) || cards.find((x) => x.next);

  el.innerHTML = `
  <div class="learn-top"><div></div>${topStats()}</div>
  <div class="page-h fade" style="margin-top:6px"><div><h1>${greet()}${p.name ? `, ${esc(p.name)}` : ""} 👋</h1><p>${courses.length ? "Bugün ne çalışmak istersin?" : "Hadi ilk sınavını ekleyelim."}</p></div></div>

  <div class="home-top fade">
    <div class="card home-goal">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div><b>Günlük hedef</b><div class="muted" style="font-size:13px">${todayXP} / ${goal} XP</div></div>
        <span class="badge" style="${goalPct >= 100 ? "background:var(--goodlo);color:var(--good)" : ""}">${goalPct >= 100 ? "Tamamlandı ✓" : `%${goalPct}`}</span>
      </div>
      <div class="progress" style="margin-top:12px"><div style="width:${goalPct}%"></div></div>
      ${cont ? `<button class="btn" id="cont" style="margin-top:16px;width:100%">${icon("play")} Devam et · ${esc(cont.c.subject)} — ${esc(cont.next.title)}</button>` : `<a href="#/yeni" class="btn" style="margin-top:16px;width:100%">${icon("plus")} Yeni sınav ekle</a>`}
    </div>
    <div class="card home-streak">
      <div class="v" style="color:#f08a4b">${icon("fire")} ${p.streak || 0}</div><small class="muted">günlük seri</small>
      <div class="v" style="color:var(--gold);margin-top:10px">${icon("bolt")} ${p.xp || 0}</div><small class="muted">toplam XP</small>
    </div>
  </div>

  <div class="home-h"><h3 style="font-weight:800">Sınavların</h3></div>
  <div class="home-grid fade">
    ${cards.map((x) => `
      <button class="card home-course" data-id="${x.c.id}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div style="min-width:0;text-align:left"><b class="hc-sub">${esc(x.c.subject)}</b><div class="muted hc-ex">${esc(x.c.exam_name)}</div></div>
          ${x.left != null ? `<span class="badge" style="${x.left <= 3 ? "background:var(--badlo);color:var(--bad)" : ""}">${x.left < 0 ? "Geçti" : x.left === 0 ? "Bugün!" : `${x.left} gün`}</span>` : ""}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-top:14px" class="muted"><span>Hedef ${esc(x.c.target_grade || "-")}</span><span>${x.done}/${x.total} adım</span></div>
        <div class="progress" style="margin-top:6px"><div style="width:${x.pct}%"></div></div>
      </button>`).join("")}
    <a href="#/yeni" class="card home-course home-new">
      <div class="plus">${icon("plus")}</div>
      <b>Yeni sınav</b>
      <span class="muted" style="font-size:13px">Hedef notunu söyle, yolunu hazırlayalım</span>
    </a>
  </div>

  <div class="home-h"><h3 style="font-weight:800">Araçlar</h3></div>
  <div class="home-tools fade">
    <a href="#/egitmen" class="card"><span class="t-ic">${icon("chat")}</span><b>Yapay zekâ eğitmen</b><small class="muted">Takıldığın her şeyi sor</small></a>
    <a href="#/podcast" class="card"><span class="t-ic">${icon("head")}</span><b>Podcast</b><small class="muted">Konuyu dinleyerek çalış</small></a>
    <a href="#/coz" class="card"><span class="t-ic">${icon("cam")}</span><b>Çek &amp; Çöz</b><small class="muted">Sorunun fotoğrafını çek</small></a>
    ${isAdmin() ? `<a href="#/admin" class="card"><span class="t-ic" style="color:var(--gold)">${icon("crown")}</span><b>Admin paneli</b><small class="muted">Kullanıcılar ve istatistikler</small></a>` : ""}
  </div>`;

  el.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => {
    try { localStorage.setItem("alertai_course", b.dataset.id); } catch {}
    go("#/ogren");
  }));
  const cb = el.querySelector("#cont");
  if (cb) cb.onclick = () => {
    try { localStorage.setItem("alertai_course", cont.c.id); } catch {}
    go(`#/adim/${cont.c.id}/${cont.next.id}`);
  };
}
