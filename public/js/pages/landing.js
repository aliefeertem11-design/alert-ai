import { LOGO } from "../app.js";
import { icon } from "../ui.js";

const node = (cls, ic, extra = "") => `<div class="node-wrap" ${extra}><div class="node ${cls}">${icon(ic)}</div></div>`;

export function render(el) {
  el.innerHTML = `
  <div class="landing">
    <nav><div class="wrap">
      ${LOGO}
      <div class="nav-links"><a href="#ozellikler" data-scroll>Özellikler</a><a href="#nasil" data-scroll>Nasıl çalışır</a><a href="#sss" data-scroll>SSS</a></div>
      <div style="display:flex;gap:8px"><a href="#/giris" class="btn ghost sm">Giriş yap</a><a href="#/kayit" class="btn sm">Ücretsiz başla</a></div>
    </div></nav>

    <div class="wrap">
      <section class="hero">
        <div class="fade">
          <span class="badge" style="margin-bottom:18px;background:var(--acclo);color:var(--acchi)">${icon("sparkle")} Öğrenciler için ücretsiz</span>
          <h1>Hedef notunu söyle.<br><span>Yolunu biz çizelim.</span></h1>
          <p class="lead">ALERT AI ders notlarını okur, sınavda kaç almak istediğini sorar ve sana özel, adım adım ilerleyen bir çalışma yolu hazırlar. Her gün birkaç dakika: kısa dersler, sorular, kartlar ve podcastler.</p>
          <div class="cta">
            <a href="#/kayit" class="btn lg">Ücretsiz hesap oluştur</a>
            <a href="#/giris" class="btn sec lg">Hesabım var</a>
          </div>
          <div class="trust">
            <span>${icon("check")} Kredi kartı yok</span>
            <span>${icon("check")} Türkçe</span>
            <span>${icon("check")} Telefon, tablet, bilgisayar</span>
          </div>
        </div>
        <div class="mock fade" style="animation-delay:.1s">
          <div class="mock-top">
            <span style="font-weight:700;color:var(--ink2)">Kimya · 1. Yazılı</span>
            <div class="mock-stats"><span class="f">${icon("fire")} 12</span><span class="x">${icon("bolt")} 840</span></div>
          </div>
          <div class="mock-unit"><small>ÜNİTE 2</small><div>Elektron dizilimi</div></div>
          <div class="mock-path">
            ${node("done", "check", 'style="margin-left:-90px"')}
            ${node("done", "check", 'style="margin-left:-20px"')}
            <div class="node-wrap" style="margin-left:60px;margin-top:26px"><span class="start-bubble">BAŞLA</span><div class="node current">${icon("dumbbell")}</div></div>
            ${node("locked", "cards", 'style="margin-left:10px"')}
            ${node("locked boss", "crown", 'style="margin-left:-70px"')}
          </div>
        </div>
      </section>
    </div>

    <section class="section" id="ozellikler"><div class="wrap">
      <div class="section-h"><h2>Çalışmak hiç bu kadar net olmamıştı</h2><p>Astra AI gibi premium çalışma araçlarının sunduğu her şey, tek bir ücretsiz uygulamada.</p></div>
      <div class="grid3">
        ${[
          ["target", "Hedefe göre plan", "Sınav tarihin, hedef notun ve seviyene göre yapay zekâ kişisel bir öğrenme yolu çıkarır."],
          ["path", "Duolingo gibi yol", "Üniteler ve adımlar halinde ilerle. Her adım 3-5 dakika; yıldız topla, XP kazan, serini koru."],
          ["book", "Notlarından öğren", "PDF, fotoğraf ya da yapıştırdığın notlardan dersler ve sorular üretilir; kaynak senin materyalin."],
          ["head", "Gerçek sesli podcast", "Konuların iki kişilik bir sohbete dönüşür. Seslendireni sen seçersin."],
          ["chat", "7/24 AI eğitmen", "Takıldığın yeri sor; açıklar, ipucu verir ya da sokratik sorularla düşündürür."],
          ["cam", "Çek & Çöz", "Sorunun fotoğrafını çek, adım adım çözümünü ve benzer bir alıştırmayı gör."],
        ]
          .map(([ic, t, d]) => `<div class="card feature"><div class="fi">${icon(ic)}</div><h3>${t}</h3><p>${d}</p></div>`)
          .join("")}
      </div>
    </div></section>

    <section class="section" id="nasil"><div class="wrap">
      <div class="section-h"><h2>Üç adımda başla</h2><p>Hesabını aç, iki dakikada yolun hazır.</p></div>
      <div class="steps-l">
        <div class="card"><div class="n">1</div><h3>Kaç almak istiyorsun?</h3><p>Hedef notunu, sınav tarihini ve dersi söyle.</p></div>
        <div class="card"><div class="n">2</div><h3>Notlarını yükle</h3><p>PDF, fotoğraf ya da metin. İstersen materyalsiz de başlayabilirsin.</p></div>
        <div class="card"><div class="n">3</div><h3>Yolunda ilerle</h3><p>Her gün birkaç adım. Hataların otomatik tekrar edilir.</p></div>
      </div>
    </div></section>

    <section class="section" id="sss"><div class="wrap">
      <div class="section-h"><h2>Sık sorulan sorular</h2></div>
      <div class="faq">
        <details><summary>Gerçekten ücretsiz mi?</summary><p>Evet. ALERT AI öğrenciler için ücretsizdir; temel öğrenme araçları için ücretli bir üyelik yoktur.</p></details>
        <details><summary>Hangi dersler için kullanabilirim?</summary><p>Matematik, fizik, kimya, biyoloji, tarih, coğrafya, edebiyat, yabancı diller ve daha fazlası. Kendi notlarını yüklediğinde içerik tamamen onlara göre hazırlanır.</p></details>
        <details><summary>Verilerim güvende mi?</summary><p>Her kullanıcının verisi yalnızca kendi hesabına bağlıdır; başkaları göremez. Hesabını ve tüm verilerini istediğin zaman Profil sayfasından silebilirsin.</p></details>
        <details><summary>Yapay zekâ hata yapar mı?</summary><p>Yapabilir. İçerikler senin materyaline dayanır ama önemli bilgileri ders kitabından veya öğretmeninden kontrol etmeni öneririz.</p></details>
      </div>
    </div></section>

    <div class="wrap"><div class="cta-band">
      <h2>Bir sonraki sınavın için hazır mısın?</h2>
      <p>Hesabını aç, hedef notunu söyle, ilk adımını bugün at.</p>
      <a href="#/kayit" class="btn lg">Ücretsiz başla</a>
    </div></div>

    <footer class="site"><div class="wrap"><span>© ${new Date().getFullYear()} ALERT AI</span><span>Öğrenciler için ücretsiz yapay zekâ çalışma arkadaşı</span></div></footer>
  </div>`;
  el.querySelectorAll("[data-scroll]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelector(a.getAttribute("href"))?.scrollIntoView({ behavior: "smooth" });
    }),
  );
}
