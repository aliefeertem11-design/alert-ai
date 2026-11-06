// Veri katmanı: Supabase (gerçek hesaplar) veya yerel deneme modu (Supabase yapılandırılmamışsa).
// Sayfalar yalnızca bu dosyadaki fonksiyonları kullanır.

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (yerel saat)
const yesterday = () => new Date(Date.now() - 86400000).toLocaleDateString("sv-SE");

let backend = null;
export let config = { supabaseUrl: "", supabaseAnonKey: "", aiConfigured: false };
export const isLocal = () => backend?.local === true;

export async function initStore() {
  try {
    const r = await fetch("/api/config");
    if (r.ok) config = await r.json();
  } catch {
    /* sunucu yoksa yerel mod */
  }
  if (config.supabaseUrl && config.supabaseAnonKey) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    backend = supabaseBackend(createClient(config.supabaseUrl, config.supabaseAnonKey));
  } else {
    backend = localBackend();
  }
  return backend;
}

export const store = new Proxy({}, { get: (_, k) => (...a) => backend[k](...a) });

// ───────── Ortak: seri ve XP hesabı ─────────
function applyXP(profile, xp) {
  const t = today();
  let streak = profile.streak || 0;
  if (profile.last_active !== t) streak = profile.last_active === yesterday() ? streak + 1 : 1;
  return { xp: (profile.xp || 0) + xp, streak, last_active: t };
}

// ───────── Supabase ─────────
function supabaseBackend(sb) {
  const uid = async () => (await sb.auth.getUser()).data.user?.id;
  const check = ({ data, error }) => {
    if (error) throw new Error(trError(error.message));
    return data;
  };
  return {
    local: false,
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session ? { user: { id: data.session.user.id, email: data.session.user.email, name: data.session.user.user_metadata?.name } } : null;
    },
    async token() {
      return (await sb.auth.getSession()).data.session?.access_token || null;
    },
    onAuth(cb) {
      sb.auth.onAuthStateChange((ev) => cb(ev));
    },
    async signUp(email, password, name) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: location.origin } });
      if (error) throw new Error(trError(error.message));
      return { needsConfirm: !data.session };
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(trError(error.message));
    },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/#/yeni-sifre" });
      if (error) throw new Error(trError(error.message));
    },
    async updatePassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(trError(error.message));
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async profile() {
      const id = await uid();
      let p = check(await sb.from("profiles").select("*").eq("id", id).maybeSingle());
      if (!p) {
        const u = (await sb.auth.getUser()).data.user;
        p = check(await sb.from("profiles").insert({ id, name: u?.user_metadata?.name || null }).select().single());
      }
      return p;
    },
    async updateProfile(patch) {
      const id = await uid();
      return check(await sb.from("profiles").update(patch).eq("id", id).select().single());
    },
    async addXP(xp) {
      const p = await this.profile();
      const next = applyXP(p, xp);
      await this.updateProfile(next);
      const id = p.id;
      const t = today();
      const cur = check(await sb.from("activity").select("xp").eq("user_id", id).eq("day", t).maybeSingle());
      check(await sb.from("activity").upsert({ user_id: id, day: t, xp: (cur?.xp || 0) + xp }));
      return next;
    },
    async activity(days = 7) {
      const id = await uid();
      const since = new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString("sv-SE");
      return check(await sb.from("activity").select("day,xp").eq("user_id", id).gte("day", since));
    },
    async courses() {
      return check(await sb.from("courses").select("id,subject,exam_name,exam_date,target_grade,scale,level,plan,created_at").order("created_at", { ascending: false }));
    },
    async course(id) {
      return check(await sb.from("courses").select("*").eq("id", id).single());
    },
    async createCourse(c) {
      const user_id = await uid();
      return check(await sb.from("courses").insert({ ...c, user_id }).select().single());
    },
    async deleteCourse(id) {
      check(await sb.from("courses").delete().eq("id", id));
    },
    async progress(courseId) {
      const rows = check(await sb.from("step_progress").select("step_id,stars,best_score,completed_at").eq("course_id", courseId));
      return Object.fromEntries(rows.map((r) => [r.step_id, r]));
    },
    async stepContent(courseId, stepId) {
      const r = check(await sb.from("step_progress").select("content").eq("course_id", courseId).eq("step_id", stepId).maybeSingle());
      return r?.content || null;
    },
    async saveStepContent(courseId, stepId, content) {
      const user_id = await uid();
      const existing = check(await sb.from("step_progress").select("step_id").eq("course_id", courseId).eq("step_id", stepId).maybeSingle());
      if (existing) check(await sb.from("step_progress").update({ content }).eq("course_id", courseId).eq("step_id", stepId));
      else check(await sb.from("step_progress").insert({ user_id, course_id: courseId, step_id: stepId, content }));
    },
    async completeStep(courseId, stepId, stars, score) {
      const user_id = await uid();
      const prev = check(await sb.from("step_progress").select("stars,best_score").eq("course_id", courseId).eq("step_id", stepId).maybeSingle());
      const row = { user_id, course_id: courseId, step_id: stepId, stars: Math.max(stars, prev?.stars || 0), best_score: Math.max(score, prev?.best_score || 0), completed_at: new Date().toISOString() };
      if (prev) check(await sb.from("step_progress").update(row).eq("course_id", courseId).eq("step_id", stepId));
      else check(await sb.from("step_progress").insert(row));
    },
    async addMistakes(courseId, list) {
      if (!list.length) return;
      const user_id = await uid();
      check(await sb.from("mistakes").insert(list.map((m) => ({ ...m, user_id, course_id: courseId }))));
    },
    async mistakes(courseId) {
      let q = sb.from("mistakes").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(100);
      if (courseId) q = q.eq("course_id", courseId);
      return check(await q);
    },
    async resolveMistake(id) {
      check(await sb.from("mistakes").update({ resolved: true }).eq("id", id));
    },
    async podcasts() {
      return check(await sb.from("podcasts").select("*").order("created_at", { ascending: false }).limit(50));
    },
    async savePodcast(p) {
      const user_id = await uid();
      return check(await sb.from("podcasts").insert({ ...p, user_id }).select().single());
    },
    async deletePodcast(id) {
      check(await sb.from("podcasts").delete().eq("id", id));
    },
    async adminOverview() { return check(await sb.rpc("admin_overview")); },
    async adminUsers() { return check(await sb.rpc("admin_users")); },
    async adminUserDetail(id) { return check(await sb.rpc("admin_user_detail", { p_user: id })); },
    async adminDeleteUser(id) { check(await sb.rpc("admin_delete_user", { p_user: id })); },
    async deleteAccount() {
      check(await sb.rpc("delete_my_account"));
      await sb.auth.signOut();
    },
  };
}

function trError(m) {
  const map = [
    [/Invalid login credentials/i, "E-posta veya şifre hatalı."],
    [/Email not confirmed/i, "E-postanı henüz onaylamadın. Gelen kutundaki bağlantıya tıkla."],
    [/User already registered/i, "Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene."],
    [/Password should be at least/i, "Şifre en az 6 karakter olmalı."],
    [/rate limit|too many/i, "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene."],
    [/invalid.*email|Unable to validate email/i, "Geçerli bir e-posta adresi gir."],
    [/Failed to fetch|NetworkError/i, "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et."],
  ];
  for (const [re, t] of map) if (re.test(m)) return t;
  return m;
}

// ───────── Yerel deneme modu (yalnızca bu tarayıcı) ─────────
function localBackend() {
  const K = "alertai_local_v1";
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(K)) || { users: {}, session: null, data: {} };
    } catch {
      return { users: {}, session: null, data: {} };
    }
  };
  let db = load();
  const save = () => {
    try {
      localStorage.setItem(K, JSON.stringify(db));
    } catch {
      /* depolama dolu */
    }
  };
  const me = () => {
    if (!db.session) throw new Error("Lütfen giriş yap.");
    db.data[db.session] ||= { profile: null, courses: [], progress: {}, mistakes: [], activity: {}, podcasts: [] };
    return db.data[db.session];
  };
  const hash = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const listeners = [];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  return {
    local: true,
    async session() {
      if (!db.session) return null;
      const u = db.users[db.session];
      return u ? { user: { id: db.session, email: u.email, name: u.name } } : null;
    },
    async token() {
      return "yerel";
    },
    onAuth(cb) {
      listeners.push(cb);
    },
    async signUp(email, password, name) {
      email = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Geçerli bir e-posta adresi gir.");
      if (password.length < 6) throw new Error("Şifre en az 6 karakter olmalı.");
      if (Object.values(db.users).some((u) => u.email === email)) throw new Error("Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.");
      const id = uuid();
      db.users[id] = { email, name, pw: await hash(password) };
      db.session = id;
      save();
      listeners.forEach((l) => l("SIGNED_IN"));
      return { needsConfirm: false };
    },
    async signIn(email, password) {
      email = email.trim().toLowerCase();
      const pw = await hash(password);
      const id = Object.keys(db.users).find((k) => db.users[k].email === email && db.users[k].pw === pw);
      if (!id) throw new Error("E-posta veya şifre hatalı.");
      db.session = id;
      save();
      listeners.forEach((l) => l("SIGNED_IN"));
    },
    async resetPassword() {
      throw new Error("Yerel deneme modunda şifre sıfırlama e-postası gönderilemez.");
    },
    async updatePassword(password) {
      db.users[db.session].pw = await hash(password);
      save();
    },
    async signOut() {
      db.session = null;
      save();
      listeners.forEach((l) => l("SIGNED_OUT"));
    },
    async profile() {
      const d = me();
      d.profile ||= { id: db.session, name: db.users[db.session].name, grade: null, xp: 0, streak: 0, last_active: null, daily_goal: 30, voice_a: "Kore", voice_b: "Puck" };
      save();
      return { ...d.profile };
    },
    async updateProfile(patch) {
      const d = me();
      await this.profile();
      Object.assign(d.profile, patch);
      save();
      return { ...d.profile };
    },
    async addXP(xp) {
      const d = me();
      const p = await this.profile();
      const next = applyXP(p, xp);
      Object.assign(d.profile, next);
      d.activity[today()] = (d.activity[today()] || 0) + xp;
      save();
      return next;
    },
    async activity(days = 7) {
      const d = me();
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const day = new Date(Date.now() - i * 86400000).toLocaleDateString("sv-SE");
        if (d.activity[day]) out.push({ day, xp: d.activity[day] });
      }
      return out;
    },
    async courses() {
      return me().courses.map(({ material, ...c }) => c);
    },
    async course(id) {
      const c = me().courses.find((x) => x.id === id);
      if (!c) throw new Error("Kurs bulunamadı.");
      return c;
    },
    async createCourse(c) {
      const row = { ...c, id: uuid(), created_at: new Date().toISOString() };
      me().courses.unshift(row);
      save();
      return row;
    },
    async deleteCourse(id) {
      const d = me();
      d.courses = d.courses.filter((c) => c.id !== id);
      delete d.progress[id];
      save();
    },
    async progress(courseId) {
      const p = me().progress[courseId] || {};
      return Object.fromEntries(Object.entries(p).filter(([, v]) => v.completed_at).map(([k, v]) => [k, { step_id: k, stars: v.stars, best_score: v.best_score, completed_at: v.completed_at }]));
    },
    async stepContent(courseId, stepId) {
      return me().progress[courseId]?.[stepId]?.content || null;
    },
    async saveStepContent(courseId, stepId, content) {
      const d = me();
      d.progress[courseId] ||= {};
      d.progress[courseId][stepId] = { ...(d.progress[courseId][stepId] || { stars: 0 }), content };
      save();
    },
    async completeStep(courseId, stepId, stars, score) {
      const d = me();
      d.progress[courseId] ||= {};
      const prev = d.progress[courseId][stepId] || {};
      d.progress[courseId][stepId] = { ...prev, stars: Math.max(stars, prev.stars || 0), best_score: Math.max(score, prev.best_score || 0), completed_at: new Date().toISOString() };
      save();
    },
    async addMistakes(courseId, list) {
      const d = me();
      list.forEach((m) => d.mistakes.unshift({ ...m, id: uuid(), course_id: courseId, resolved: false, created_at: new Date().toISOString() }));
      d.mistakes = d.mistakes.slice(0, 300);
      save();
    },
    async mistakes(courseId) {
      return me().mistakes.filter((m) => !m.resolved && (!courseId || m.course_id === courseId)).slice(0, 100);
    },
    async resolveMistake(id) {
      const m = me().mistakes.find((x) => x.id === id);
      if (m) m.resolved = true;
      save();
    },
    async podcasts() {
      return me().podcasts;
    },
    async savePodcast(p) {
      const row = { ...p, id: uuid(), created_at: new Date().toISOString() };
      me().podcasts.unshift(row);
      save();
      return row;
    },
    async deletePodcast(id) {
      const d = me();
      d.podcasts = d.podcasts.filter((p) => p.id !== id);
      save();
    },
    async deleteAccount() {
      delete db.data[db.session];
      delete db.users[db.session];
      db.session = null;
      save();
    },
  };
}
