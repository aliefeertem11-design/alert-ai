import { ctx, go, refreshProfile } from "../app.js";
import { store, isLocal } from "../store.js";
import { esc, icon, md, toast, VOICES } from "../ui.js";

const GRADES = ["5. sınıf", "6. sınıf", "7. sınıf", "8. sınıf", "9. sınıf", "10. sınıf", "11. sınıf", "12. sınıf", "Üniversite", "Diğer"];

export async function render(el) {
  const p = await refreshProfile();
  const [act, courses, mistakes] = await Promise.all([store.activity(7).catch(() => []), store.courses().catch(() => []), store.mistakes().catch(() => [])]);
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    const key = d.toLocaleDateString("sv-SE");
    return { key, label: d.toLocaleDateString("tr-TR", { weekday: "short" }), xp: act.find((a) => a.day === key)?.xp || 0, today: i === 6 };
  });
  const maxXP = Math.max(p.daily_goal || 30, ...days.map((d) => d.xp));
  const weekXP = days.reduce((a, d) => a + d.xp, 0);

  el.innerHTML = `
  <div class="page-h"><div><h1>${esc(p.name || "Profilim")}</h1><p>${esc(ctx.session.user.email)}${p.grade ? ` · ${esc(p.grade)}` : ""}</p></div></div>
  <div class="stat-grid fade">
    <div class="card stat"><div class="v" style="color:#f08a4b">${icon("fire")} ${p.streak || 0}</div><small>Günlük seri</small></div>
    <div class="card stat"><div class="v" style="color:var(--gold)">${icon("bolt")} ${p.xp || 0}</div><small>Toplam XP</small></div>
    <div class="card stat"><div class="v">${weekXP}</div><small>Bu hafta XP</small></div>
    <div class="card stat"><div class="v">${courses.length}</div><small>Çalışma yolu</small></div>
  </div>

  <div class="card" style="padding:20px;margin-top:16px">
    <h3 style="font-weight:800">Bu hafta</h3>
    <div class="week">${days.map((d) => `<div class="b"><small>${d.xp || ""}</small><div class="bar ${d.today ? "today" : ""}" style="height:${(d.xp / maxXP) * 100}%"></div><small>${d.label}</small></div>`).join("")}</div>
  </div>

  <div class="card" style="padding:20px;margin-top:16px;display:grid;gap:16px">
    <h3 style="font-weight:800">Ayarlar</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div><label class="lbl">Adın</label><input class="field" id="name" value="${esc(p.name || "")}" maxlength="40"></div>
      <div><label class="lbl">Sınıfın</label><select class="field" id="grade"><option value="">Seç</option>${GRADES.map((g) => `<option ${g === p.grade ? "selected" : ""}>${g}</option>`).join("")}</select></div>
    </div>
    <div><label class="lbl">Günlük hedef</label><div style="display:flex;gap:6px;flex-wrap:wrap">${[[10, "Rahat"], [30, "Normal"], [50, "Ciddi"], [80, "Yoğun"]].map(([v, l]) => `<button class="chip ${p.daily_goal === v ? "on" : ""}" data-goal="${v}">${l} · ${v} XP</button>`).join("")}</div></div>
    <div><label class="lbl">Podcast seslendiricisi</label><select class="field" id="va" style="max-width:320px">${VOICES.map((v) => `<option value="${v.id}" ${v.id === p.voice_a ? "selected" : ""}>${v.label} — ${v.desc}</option>`).join("")}</select>
      <label class="lbl" style="margin-top:10px">Sohbetteki ikinci ses</label><select class="field" id="vb" style="max-width:320px">${VOICES.map((v) => `<option value="${v.id}" ${v.id === p.voice_b ? "selected" : ""}>${v.label} — ${v.desc}</option>`).join("")}</select></div>
    <div><button class="btn" id="save">Kaydet</button></div>
  </div>

  <div class="card" style="margin-top:16px">
    <div style="padding:18px 20px 6px"><h3 style="font-weight:800">Hata defteri</h3><p class="muted" style="font-size:13px">Yanlış yaptığın sorular. “Tekrar” adımlarında bunlara benzer sorular gelir.</p></div>
    ${mistakes.length ? mistakes.slice(0, 30).map((m) => `<div class="list-row"><div style="min-width:0"><div class="md" style="font-size:14.5px">${md(m.question)}</div><div style="font-size:13px;margin-top:4px"><span style="color:var(--bad)">Senin cevabın: ${esc(m.user_answer || "-")}</span> · <span style="color:var(--good)">Doğru: ${esc(m.correct_answer || "-")}</span></div></div><button class="btn sec sm" data-res="${m.id}">${icon("check")} Öğrendim</button></div>`).join("") : `<p class="muted" style="padding:6px 20px 20px;font-size:14px">Henüz hata yok. 🎉</p>`}
  </div>

  <div class="card" style="padding:20px;margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <button class="btn sec" id="logout">${icon("logout")} Çıkış yap</button>
    <button class="btn ghost" id="del" style="color:var(--bad)">${icon("trash")} Hesabımı ve verilerimi sil</button>
    ${isLocal() ? `<span class="badge">Yerel deneme modu — veriler yalnızca bu tarayıcıda</span>` : ""}
  </div>`;

  let goal = p.daily_goal;
  el.querySelectorAll("[data-goal]").forEach((b) => (b.onclick = () => { goal = Number(b.dataset.goal); el.querySelectorAll("[data-goal]").forEach((x) => x.classList.toggle("on", x === b)); }));
  el.querySelector("#save").onclick = async () => {
    try {
      await store.updateProfile({ name: el.querySelector("#name").value.trim() || null, grade: el.querySelector("#grade").value || null, daily_goal: goal, voice_a: el.querySelector("#va").value, voice_b: el.querySelector("#vb").value });
      await refreshProfile();
      toast("Kaydedildi.", "good");
    } catch (e) {
      toast(e.message, "bad");
    }
  };
  el.querySelectorAll("[data-res]").forEach((b) => (b.onclick = async () => { await store.resolveMistake(isNaN(b.dataset.res) ? b.dataset.res : Number(b.dataset.res)); b.closest(".list-row").remove(); }));
  el.querySelector("#logout").onclick = async () => { await store.signOut(); ctx.profile = null; go("#/"); };
  el.querySelector("#del").onclick = () => {
    const m = document.createElement("div");
    m.className = "modal-bg";
    m.innerHTML = `<div class="card modal fade"><h3 style="font-weight:800">Hesabın silinsin mi?</h3><p class="muted" style="margin:8px 0 14px;font-size:14px">Tüm yolların, ilerlemen, podcastlerin ve hesabın kalıcı olarak silinecek. Onaylamak için <b>SİL</b> yaz.</p><input class="field" id="conf"><div style="display:flex;gap:10px;margin-top:14px"><button class="btn sec" style="flex:1" id="no">Vazgeç</button><button class="btn bad" style="flex:1" id="yes" disabled>Sil</button></div></div>`;
    document.body.appendChild(m);
    m.querySelector("#conf").oninput = (e) => (m.querySelector("#yes").disabled = e.target.value.trim().toLocaleUpperCase("tr") !== "SİL");
    m.querySelector("#no").onclick = () => m.remove();
    m.querySelector("#yes").onclick = async () => {
      try {
        await store.deleteAccount();
        m.remove();
        ctx.profile = null;
        go("#/");
      } catch (e) {
        toast(e.message, "bad");
      }
    };
  };
}
