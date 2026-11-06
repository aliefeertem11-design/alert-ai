import { initStore, store, isLocal } from "./store.js";
import { $, esc, icon } from "./ui.js";

const app = $("#app");
export const ctx = { session: null, profile: null };

const LOGO = `<a href="#/" class="logo"><svg width="30" height="30" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#141a26" stroke="#2a3446"/><path d="M32 13 L49 49 H40.5 L32 30 L23.5 49 H15 Z" fill="#8eaee6"/><circle cx="32" cy="44" r="3.4" fill="#e8eaef"/></svg><span>ALERT <b>AI</b></span></a>`;
export { LOGO };

const NAV = [
  { href: "#/ogren", label: "ÖĞREN", short: "Öğren", icon: "path" },
  { href: "#/egitmen", label: "EĞİTMEN", short: "Eğitmen", icon: "chat" },
  { href: "#/podcast", label: "PODCAST", short: "Podcast", icon: "head" },
  { href: "#/coz", label: "ÇEK & ÇÖZ", short: "Çöz", icon: "cam" },
  { href: "#/profil", label: "PROFİL", short: "Profil", icon: "user" },
];

const ROUTES = [
  { re: /^#?\/?$/, page: "landing", public: true, bare: true },
  { re: /^#\/giris$/, page: "auth", public: true, bare: true, arg: "login" },
  { re: /^#\/kayit$/, page: "auth", public: true, bare: true, arg: "signup" },
  { re: /^#\/sifre-unuttum$/, page: "auth", public: true, bare: true, arg: "forgot" },
  { re: /^#\/yeni-sifre$/, page: "auth", bare: true, arg: "newpass" },
  { re: /^#\/ogren$/, page: "learn" },
  { re: /^#\/yeni$/, page: "wizard", bare: true },
  { re: /^#\/adim\/([\w-]+)\/([\w-]+)$/, page: "player", bare: true },
  { re: /^#\/egitmen$/, page: "tutor" },
  { re: /^#\/podcast$/, page: "podcast" },
  { re: /^#\/coz$/, page: "solve" },
  { re: /^#\/profil$/, page: "profile" },
];

export const go = (h) => {
  if (location.hash === h) route();
  else location.hash = h;
};

export async function refreshProfile() {
  ctx.profile = await store.profile();
  return ctx.profile;
}

let cleanup = null;

async function route() {
  const hash = location.hash || "#/";
  // Supabase e-posta bağlantıları (#access_token=...) oturumu kendi işler
  if (/access_token|error_description/.test(hash)) {
    setTimeout(() => go(/type=recovery/.test(hash) ? "#/yeni-sifre" : "#/ogren"), 300);
    return;
  }
  const r = ROUTES.find((x) => x.re.test(hash)) || ROUTES[0];
  const params = hash.match(r.re)?.slice(1) || [];
  ctx.session = await store.session();
  if (!r.public && !ctx.session) return go("#/giris");
  if (r.page === "landing" && ctx.session) return go("#/ogren");
  if ((r.arg === "login" || r.arg === "signup") && ctx.session) return go("#/ogren");
  if (ctx.session && !ctx.profile) {
    try {
      await refreshProfile();
    } catch (e) {
      console.error(e);
    }
  }
  if (cleanup) {
    try {
      cleanup();
    } catch {}
    cleanup = null;
  }
  window.scrollTo(0, 0);
  let target = app;
  if (!r.bare) {
    renderShell(hash);
    target = $("#page");
  } else {
    app.innerHTML = "";
  }
  target.innerHTML = `<div class="boot" style="height:50vh"><span class="spin"></span></div>`;
  try {
    const mod = await import(`./pages/${r.page}.js`);
    cleanup = (await mod.render(target, { params, arg: r.arg })) || null;
  } catch (e) {
    console.error(e);
    target.innerHTML = `<div class="err" style="margin:40px auto;max-width:520px">Sayfa yüklenemedi: ${esc(e.message)}</div>`;
  }
}

function renderShell(hash) {
  const active = (h) => hash.startsWith(h);
  const p = ctx.profile || {};
  app.innerHTML = `
  <div class="shell">
    <aside class="side">
      ${LOGO}
      <nav>${NAV.map((n) => `<a href="${n.href}" class="${active(n.href) ? "on" : ""}">${icon(n.icon)}${n.label}</a>`).join("")}</nav>
      <div class="me"><b>${esc(p.name || ctx.session?.user?.email?.split("@")[0] || "")}</b><span class="muted">${esc(ctx.session?.user?.email || "")}</span>${isLocal() ? `<div class="badge" style="margin-top:8px">Yerel deneme modu</div>` : ""}</div>
    </aside>
    <div class="main"><div class="main-inner" id="page"></div></div>
    <nav class="bottomnav">${NAV.map((n) => `<a href="${n.href}" class="${active(n.href) ? "on" : ""}">${icon(n.icon)}${n.short}</a>`).join("")}</nav>
  </div>`;
}

export function topStats() {
  const p = ctx.profile || {};
  const today = new Date().toLocaleDateString("sv-SE");
  const active = p.last_active === today;
  return `<div class="topstats">
    <span class="s ${active ? "" : "off"}" title="Günlük seri">${icon("fire", "fire")}<span>${p.streak || 0}</span></span>
    <span class="s" title="Toplam XP">${icon("bolt", "bolt")}<span>${p.xp || 0}</span></span>
  </div>`;
}

(async () => {
  await initStore();
  store.onAuth((ev) => {
    if (ev === "SIGNED_OUT") {
      ctx.profile = null;
      go("#/");
    }
    if (ev === "PASSWORD_RECOVERY") go("#/yeni-sifre");
  });
  window.addEventListener("hashchange", route);
  route();
})();
