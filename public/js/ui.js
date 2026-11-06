// Ortak arayüz yardımcıları
import { store } from "./store.js";

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Markdown + KaTeX (öğrenci ham LaTeX görmez)
export function md(text) {
  const store_ = [];
  let t = String(text ?? "")
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m}$`);
  const km = (m, d) => {
    try {
      return window.katex.renderToString(m, { displayMode: d, throwOnError: false });
    } catch {
      return esc(m);
    }
  };
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => (store_.push(km(m, true)), `§§M${store_.length - 1}§§`)).replace(/\$([^$\n]+?)\$/g, (_, m) => (store_.push(km(m, false)), `§§M${store_.length - 1}§§`));
  const html = window.marked ? window.marked.parse(esc(t).replace(/^&gt;/gm, ">"), { breaks: true }) : esc(t).replace(/\n/g, "<br>");
  return html.replace(/§§M(\d+)§§/g, (_, i) => store_[i]);
}
export const mdInline = (t) => md(t).replace(/^<p>/, "").replace(/<\/p>\s*$/, "");

// Yapay zekâ çağrısı (oturum belirteci ile)
export async function ai(task, payload) {
  const token = await store.token();
  let res;
  try {
    res = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ task, ...payload }) });
  } catch {
    throw new Error("Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.");
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `İstek başarısız (${res.status}).`);
  return j;
}

export async function tts(payload) {
  const token = await store.token();
  const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const e = new Error(j.error || "Seslendirme başarısız oldu.");
    e.code = j.code;
    throw e;
  }
  return res.blob();
}

export function toast(msg, kind = "info") {
  let box = $("#toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.classList.add("out"), 3200);
  setTimeout(() => el.remove(), 3700);
}

export const spinner = (t = "") => `<span class="spin"></span>${t ? ` <span>${esc(t)}</span>` : ""}`;

export function icon(name, cls = "") {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d + "T00:00:00") - new Date(new Date().toDateString())) / 86400000);
}

export function fmtDate(d) {
  if (!d) return "";
  return new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
}

// Materyal içinde basit anahtar kelime araması (yalnızca ilgili kısım yapay zekâya gönderilir)
export function relevantExcerpt(material, query, max = 8000) {
  if (!material) return "";
  if (material.length <= max) return material;
  const chunks = material.match(/[\s\S]{1,1200}(?=\s|$)/g) || [];
  const norm = (s) => s.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = [...new Set(norm(query).split(/\s+/).filter((w) => w.length > 2).map((w) => w.slice(0, 6)))];
  const scored = chunks.map((c, i) => {
    const n = norm(c);
    return { i, c, s: words.reduce((a, w) => a + (n.split(w).length - 1), 0) };
  });
  const picked = scored.sort((a, b) => b.s - a.s).slice(0, Math.ceil(max / 1200)).sort((a, b) => a.i - b.i);
  return picked.map((p) => p.c).join("\n…\n").slice(0, max);
}

// PDF / metin / görsel dosyasından metin çıkar (tarayıcıda)
export async function extractText(file, onProgress) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`PDF okunuyor: ${i}/${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      out += `\n[Sayfa ${i}]\n` + tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("");
    }
    if (out.replace(/\[Sayfa \d+\]|\s/g, "").length < 50 * pdf.numPages * 0.2) throw new Error("Bu PDF taranmış görünüyor (metin katmanı yok). Sayfaların fotoğrafını yükleyebilirsin.");
    return out.trim();
  }
  if (file.type.startsWith("image/")) {
    onProgress?.("Fotoğraftaki yazı okunuyor…");
    const { text } = await ai("ocr", { mime: file.type, image: await toBase64(await shrinkImage(file)) });
    return text;
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) return file.text();
  throw new Error("Desteklenen dosyalar: PDF, TXT, fotoğraf.");
}

export function toBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

// Büyük fotoğrafları küçült (kota ve hız için)
export async function shrinkImage(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 2_500_000) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
  } catch {
    return file;
  }
}

export const VOICES = [
  { id: "Kore", label: "Kore", desc: "Kadın · net ve sakin" },
  { id: "Puck", label: "Puck", desc: "Erkek · neşeli" },
  { id: "Aoede", label: "Aoede", desc: "Kadın · ferah" },
  { id: "Charon", label: "Charon", desc: "Erkek · bilgilendirici" },
  { id: "Leda", label: "Leda", desc: "Kadın · genç" },
  { id: "Orus", label: "Orus", desc: "Erkek · kararlı" },
  { id: "Zephyr", label: "Zephyr", desc: "Kadın · parlak" },
  { id: "Fenrir", label: "Fenrir", desc: "Erkek · heyecanlı" },
  { id: "Callirrhoe", label: "Callirrhoe", desc: "Kadın · rahat" },
  { id: "Enceladus", label: "Enceladus", desc: "Erkek · yumuşak" },
  { id: "Sulafat", label: "Sulafat", desc: "Kadın · sıcak" },
  { id: "Achird", label: "Achird", desc: "Erkek · samimi" },
];
