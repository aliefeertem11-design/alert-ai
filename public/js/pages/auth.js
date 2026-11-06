import { LOGO, go, refreshProfile } from "../app.js";
import { store, isLocal } from "../store.js";
import { esc, icon, spinner } from "../ui.js";

const COPY = {
  login: { title: "Tekrar hoş geldin", sub: "Kaldığın yerden devam et.", btn: "Giriş yap" },
  signup: { title: "Hesabını oluştur", sub: "Ücretsiz. İki dakikada çalışma yolun hazır.", btn: "Hesap oluştur" },
  forgot: { title: "Şifreni sıfırla", sub: "E-posta adresine bir sıfırlama bağlantısı gönderelim.", btn: "Bağlantı gönder" },
  newpass: { title: "Yeni şifre belirle", sub: "En az 6 karakter.", btn: "Şifreyi kaydet" },
};

export function render(el, { arg }) {
  const c = COPY[arg];
  el.innerHTML = `
  <div class="auth">
    <div class="auth-side">
      ${LOGO}
      <div>
        <h2>Her gün birkaç dakika. Sınavda hedeflediğin not.</h2>
        <ul>
          <li>${icon("check")} Hedef notuna göre kişisel çalışma yolu</li>
          <li>${icon("check")} Notlarından kısa dersler ve sorular</li>
          <li>${icon("check")} Doğal sesli podcastler</li>
          <li>${icon("check")} 7/24 yapay zekâ eğitmen</li>
        </ul>
      </div>
      <span class="muted" style="font-size:13px">Öğrenciler için ücretsiz.</span>
    </div>
    <div class="auth-main">
      <div class="auth-box fade">
        <h1>${c.title}</h1>
        <p class="sub">${c.sub}</p>
        <form id="f" novalidate>
          ${arg === "signup" ? `<div><label class="lbl" for="name">Adın</label><input class="field" id="name" autocomplete="given-name" maxlength="40" placeholder="Sana nasıl hitap edelim?"></div>` : ""}
          ${arg !== "newpass" ? `<div><label class="lbl" for="email">E-posta</label><input class="field" id="email" type="email" autocomplete="email" required></div>` : ""}
          ${arg !== "forgot" ? `<div><label class="lbl" for="pw">Şifre</label><input class="field" id="pw" type="password" autocomplete="${arg === "login" ? "current-password" : "new-password"}" required minlength="6"></div>` : ""}
          ${arg === "login" ? `<a href="#/sifre-unuttum" class="linkish" style="font-size:13px;justify-self:end;margin-top:-6px">Şifremi unuttum</a>` : ""}
          <div id="msg"></div>
          <button class="btn lg block" id="go">${c.btn}</button>
        </form>
        <div class="auth-foot">
          ${arg === "login" ? `Hesabın yok mu? <a href="#/kayit">Ücretsiz kaydol</a>` : arg === "signup" ? `Zaten hesabın var mı? <a href="#/giris">Giriş yap</a>` : `<a href="#/giris">Girişe dön</a>`}
        </div>
        ${isLocal() ? `<p class="local-note">Yerel deneme modu: Supabase bağlanmadığı için hesap yalnızca bu tarayıcıda saklanır.</p>` : ""}
      </div>
    </div>
  </div>`;

  const f = el.querySelector("#f");
  const msg = el.querySelector("#msg");
  const btn = el.querySelector("#go");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.innerHTML = "";
    const email = el.querySelector("#email")?.value.trim();
    const pw = el.querySelector("#pw")?.value;
    const name = el.querySelector("#name")?.value.trim();
    if (arg !== "newpass" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "")) return (msg.innerHTML = `<div class="err">Geçerli bir e-posta adresi gir.</div>`);
    if (arg !== "forgot" && (pw || "").length < 6) return (msg.innerHTML = `<div class="err">Şifre en az 6 karakter olmalı.</div>`);
    btn.disabled = true;
    btn.innerHTML = spinner();
    try {
      if (arg === "login") {
        await store.signIn(email, pw);
        await refreshProfile();
        go("#/ana");
      } else if (arg === "signup") {
        const r = await store.signUp(email, pw, name);
        if (r.needsConfirm) {
          msg.innerHTML = `<div class="ok-box"><b>Neredeyse tamam!</b> ${esc(email)} adresine bir onay bağlantısı gönderdik. Bağlantıya tıkladıktan sonra giriş yapabilirsin.</div>`;
          btn.textContent = c.btn;
          btn.disabled = false;
          return;
        }
        await refreshProfile();
        go("#/ana");
      } else if (arg === "forgot") {
        await store.resetPassword(email);
        msg.innerHTML = `<div class="ok-box">Hesap varsa sıfırlama bağlantısı ${esc(email)} adresine gönderildi.</div>`;
      } else {
        await store.updatePassword(pw);
        go("#/ana");
      }
    } catch (err) {
      msg.innerHTML = `<div class="err">${esc(err.message)}</div>`;
    }
    btn.disabled = false;
    btn.textContent = c.btn;
  });
}
