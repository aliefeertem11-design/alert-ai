import { go, isAdmin } from "../app.js";
import { store, config, isLocal } from "../store.js";
import { esc, icon, toast } from "../ui.js";

const fmt = (d) => (d ? new Date(d).toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" }) : "-");
const ago = (d) => {
  if (!d) return "hiç";
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 2) return "az önce";
  if (m < 60) return `${m} dk önce`;
  if (m < 1440) return `${Math.round(m / 60)} sa önce`;
  return `${Math.round(m / 1440)} gün önce`;
};
const TASKS = { plan: "Plan", step: "Adım", tutor: "Eğitmen", solve: "Çöz", podcast: "Podcast", ocr: "Metin okuma", tts: "Seslendirme" };

export async function render(el) {
  if (!isAdmin()) return go("#/ana");
  if (isLocal()) {
    el.innerHTML = `<div class="err">Admin paneli yalnızca Supabase bağlıyken çalışır.</div>`;
    return;
  }
  let users = [];
  let ov = null;
  try {
    [ov, users] = await Promise.all([store.adminOverview(), store.adminUsers()]);
  } catch (e) {
    const missing = /admin_overview|admin_users|function|schema cache/i.test(e.message);
    el.innerHTML = `<div class="page-h"><div><h1>Admin paneli</h1></div></div>
      <div class="card" style="padding:22px">
        ${missing ? `<b>Kurulumun son adımı eksik.</b><p class="muted" style="margin-top:8px">Supabase'te <b>SQL Editor → New query</b> aç, GitHub'daki <b>admin.sql</b> dosyasının tamamını yapıştır ve <b>Run</b>'a bas. Sonra bu sayfayı yenile.</p>` : `<div class="err">${esc(e.message)}</div>`}
      </div>`;
    return;
  }

  const maxDaily = Math.max(1, ...ov.daily.map((d) => Math.max(d.signups, d.active, d.ai)));
  let q = "";
  let sort = "created_at";

  el.innerHTML = `
  <div class="page-h"><div><h1>${icon("crown")} Admin paneli</h1><p>ALERT AI · tüm kullanıcılar ve kullanım</p></div>
    <div style="display:flex;gap:8px"><button class="btn sec sm" id="aicheck">${icon("sparkle")} Yapay zekâyı test et</button><button class="btn sec sm" id="refresh">${icon("repeat")} Yenile</button></div></div>

  <div class="adm-grid fade">
    ${[
      ["Kullanıcı", ov.users, `+${ov.new_today} bugün · +${ov.new_7d} 7 gün`],
      ["Bugün aktif", ov.active_today, `${ov.active_7d} kişi son 7 gün`],
      ["Sınav yolu", ov.courses, ""],
      ["Biten adım", ov.steps_done, ""],
      ["Podcast", ov.podcasts, ""],
      ["Toplam XP", ov.xp, ""],
      ["Yapay zekâ (bugün)", ov.ai_today, ov.ai_failed_today ? `<span style="color:var(--bad)">${ov.ai_failed_today} hata</span>` : "hata yok"],
    ].map(([l, v, s]) => `<div class="card adm-stat"><small>${l}</small><div class="v">${Number(v).toLocaleString("tr-TR")}</div>${s ? `<small>${s}</small>` : ""}</div>`).join("")}
  </div>

  <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-top:12px" class="adm-two">
    <div class="card" style="padding:18px">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px"><b>Son 14 gün</b>
        <div class="adm-legend"><span><i style="background:var(--acchi)"></i>Yeni kayıt</span><span><i style="background:var(--good)"></i>Aktif</span><span><i style="background:var(--gold)"></i>Yapay zekâ</span></div></div>
      <div class="adm-chart">${ov.daily.map((d) => `<div class="col" title="${fmt(d.day)}: ${d.signups} kayıt, ${d.active} aktif, ${d.ai} yapay zekâ isteği">
        <div class="bars"><i style="height:${(d.signups / maxDaily) * 100}%;background:var(--acchi)"></i><i style="height:${(d.active / maxDaily) * 100}%;background:var(--good)"></i><i style="height:${(d.ai / maxDaily) * 100}%;background:var(--gold)"></i></div>
        <small>${new Date(d.day).getDate()}</small></div>`).join("")}</div>
    </div>
    <div class="card" style="padding:18px">
      <b>Bugün yapay zekâ</b>
      <div style="margin-top:10px;display:grid;gap:6px;font-size:14px">${Object.keys(ov.ai_tasks_today || {}).length ? Object.entries(ov.ai_tasks_today).map(([k, v]) => `<div style="display:flex;justify-content:space-between"><span class="muted">${esc(TASKS[k] || k)}</span><b>${v}</b></div>`).join("") : `<span class="muted">Henüz istek yok.</span>`}</div>
      <b style="display:block;margin-top:18px">Popüler dersler</b>
      <div style="margin-top:10px;display:grid;gap:6px;font-size:14px">${ov.subjects.length ? ov.subjects.map((s) => `<div style="display:flex;justify-content:space-between"><span class="muted">${esc(s.subject)}</span><b>${s.n}</b></div>`).join("") : `<span class="muted">Henüz yok.</span>`}</div>
      <div class="muted" style="font-size:12px;margin-top:16px">Yapay zekâ anahtarı: ${config.aiConfigured ? `<span style="color:var(--good)">tanımlı</span>` : `<span style="color:var(--bad)">yok</span>`}</div>
    </div>
  </div>

  <div class="card" style="margin-top:12px">
    <div style="padding:16px 16px 8px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
      <b>Kullanıcılar (${users.length})</b>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="field" id="q" placeholder="E-posta veya ad ara" style="height:38px;padding:8px 12px;width:220px;font-size:14px">
        <select class="field" id="sort" style="height:38px;padding:8px 36px 8px 12px;width:auto;font-size:14px">
          <option value="created_at">En yeni</option><option value="last_sign_in_at">Son giriş</option><option value="xp">En çok XP</option><option value="steps">En çok adım</option><option value="ai">En çok yapay zekâ</option>
        </select>
      </div>
    </div>
    <div class="adm-scroll"><table class="adm-table"><thead><tr><th>E-posta</th><th>Ad</th><th>Sınıf</th><th>Kayıt</th><th>Son giriş</th><th>Sınav</th><th>Adım</th><th>XP</th><th>Seri</th><th>YZ</th></tr></thead><tbody id="rows"></tbody></table></div>
  </div>`;

  const drawRows = () => {
    const list = users
      .filter((u) => !q || `${u.email} ${u.name || ""}`.toLocaleLowerCase("tr").includes(q))
      .sort((a, b) => (sort === "created_at" || sort === "last_sign_in_at" ? new Date(b[sort] || 0) - new Date(a[sort] || 0) : (b[sort] || 0) - (a[sort] || 0)));
    el.querySelector("#rows").innerHTML = list.length
      ? list.map((u) => `<tr class="row" data-u="${u.id}"><td class="adm-mail">${esc(u.email)}${isAdmin(u.email) ? ` <span class="badge" style="color:var(--gold)">admin</span>` : ""}</td><td>${esc(u.name || "-")}</td><td>${esc(u.grade || "-")}</td><td>${fmt(u.created_at)}</td><td>${ago(u.last_sign_in_at)}</td><td>${u.courses}</td><td>${u.steps}</td><td>${u.xp}</td><td>${u.streak}</td><td>${u.ai}</td></tr>`).join("")
      : `<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">Kullanıcı bulunamadı.</td></tr>`;
    el.querySelectorAll("[data-u]").forEach((r) => (r.onclick = () => openUser(users.find((u) => u.id === r.dataset.u))));
  };
  drawRows();
  el.querySelector("#q").oninput = (e) => { q = e.target.value.trim().toLocaleLowerCase("tr"); drawRows(); };
  el.querySelector("#sort").onchange = (e) => { sort = e.target.value; drawRows(); };
  el.querySelector("#refresh").onclick = () => render(el);
  el.querySelector("#aicheck").onclick = async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    b.innerHTML = `<span class="spin"></span> Test ediliyor…`;
    try {
      const token = await store.token();
      const r = await fetch("/api/admin/ai-check", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{}" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Hata ${r.status}`);
      showModal(`<h3 style="font-weight:800">Yapay zekâ testi</h3>
        <div style="display:grid;gap:8px;margin-top:12px;font-size:14px">${j.results.map((x) => `<div style="display:flex;justify-content:space-between;gap:10px"><span>${esc(x.model)}</span><b style="color:${x.ok ? "var(--good)" : "var(--bad)"}">${x.ok ? `çalışıyor · ${(x.ms / 1000).toFixed(1)} sn` : esc(x.error)}</b></div>`).join("")}</div>
        <p class="muted" style="font-size:12.5px;margin-top:12px">Site önce en üstteki modeli kullanır; yoğunsa sıradakine geçer.</p>`);
    } catch (e) {
      toast(e.message, "bad");
    } finally {
      b.disabled = false;
      b.innerHTML = `${icon("sparkle")} Yapay zekâyı test et`;
    }
  };

  async function openUser(u) {
    const m = showModal(`<div style="text-align:center;padding:20px"><span class="spin"></span></div>`);
    let d;
    try {
      d = await store.adminUserDetail(u.id);
    } catch (e) {
      m.body.innerHTML = `<div class="err">${esc(e.message)}</div>`;
      return;
    }
    m.body.innerHTML = `
      <h3 style="font-weight:800;word-break:break-all">${esc(u.email)}</h3>
      <p class="muted" style="font-size:13px;margin-top:4px">${esc(u.name || "Adsız")}${u.grade ? ` · ${esc(u.grade)}` : ""} · Kayıt ${fmt(u.created_at)} · Son giriş ${ago(u.last_sign_in_at)}</p>
      <div class="adm-grid" style="margin-top:14px;grid-template-columns:repeat(4,1fr)">
        ${[["XP", u.xp], ["Seri", u.streak], ["Hata", d.mistakes], ["Podcast", d.podcasts]].map(([l, v]) => `<div class="card adm-stat" style="padding:10px 12px"><small>${l}</small><div class="v" style="font-size:18px">${v}</div></div>`).join("")}
      </div>
      <b style="display:block;margin-top:16px">Sınavları</b>
      <div style="display:grid;gap:8px;margin-top:8px;max-height:260px;overflow:auto">${d.courses.length ? d.courses.map((c) => `<div class="card" style="padding:12px"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(c.subject)}</b><span class="muted" style="font-size:12.5px">${c.done_steps}/${c.total_steps} adım${c.avg_score != null ? ` · ort. %${c.avg_score}` : ""}</span></div><div class="muted" style="font-size:13px">${esc(c.exam_name)} · hedef ${esc(c.target_grade || "-")}${c.exam_date ? ` · ${fmt(c.exam_date)}` : ""}</div><div class="progress" style="margin-top:8px"><div style="width:${c.total_steps ? (c.done_steps / c.total_steps) * 100 : 0}%"></div></div></div>`).join("") : `<span class="muted" style="font-size:14px">Henüz sınav yok.</span>`}</div>
      <div style="display:flex;gap:10px;margin-top:18px;justify-content:space-between;flex-wrap:wrap">
        ${isAdmin(u.email) ? "<span></span>" : `<button class="btn ghost sm" id="deluser" style="color:var(--bad)">${icon("trash")} Kullanıcıyı sil</button>`}
        <button class="btn sec sm" id="closem">Kapat</button>
      </div>`;
    m.body.querySelector("#closem").onclick = m.close;
    const del = m.body.querySelector("#deluser");
    if (del) del.onclick = async () => {
      if (!confirm(`${u.email} ve tüm verileri kalıcı olarak silinsin mi?`)) return;
      try {
        await store.adminDeleteUser(u.id);
        toast("Kullanıcı silindi.", "good");
        m.close();
        render(el);
      } catch (e) {
        toast(e.message, "bad");
      }
    };
  }
}

function showModal(html) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="card modal fade" style="max-width:560px;width:calc(100% - 32px)">${html}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.onclick = (e) => { if (e.target === bg) close(); };
  return { body: bg.firstElementChild, close };
}
