// Podcast sesi: Gemini TTS (doğal ses, seçilebilir seslendirici). Üretilen ses tarayıcıda saklanır,
// tekrar açıldığında yeniden üretilmez (kota tasarrufu).
import { tts } from "./ui.js";

const DB = "alertai_audio";
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("a");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function cacheGet(key) {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const q = db.transaction("a").objectStore("a").get(key);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
async function cachePut(key, blob) {
  try {
    const db = await idb();
    db.transaction("a", "readwrite").objectStore("a").put(blob, key);
  } catch {
    /* depolama yoksa önemli değil */
  }
}
async function hashKey(obj) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(obj)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Segmentleri seslendirip tek bir WAV döndürür. Uzun metinler parçalara bölünür ve birleştirilir. */
export async function podcastAudio(segments, voices, onProgress) {
  const key = await hashKey({ segments, voices });
  const cached = await cacheGet(key);
  if (cached) return cached;
  // ~2500 karakterlik parçalar (konuşmacı değişimlerinde bölünür)
  const parts = [];
  let cur = [];
  let len = 0;
  for (const s of segments) {
    if (len + s.text.length > 2500 && cur.length) {
      parts.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(s);
    len += s.text.length;
  }
  if (cur.length) parts.push(cur);
  const blobs = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress?.(parts.length > 1 ? `Seslendiriliyor ${i + 1}/${parts.length}…` : "Seslendiriliyor…");
    blobs.push(await tts({ segments: parts[i], voiceA: voices.A, voiceB: voices.B }));
  }
  const out = blobs.length === 1 ? blobs[0] : await mergeWav(blobs);
  cachePut(key, out);
  return out;
}

async function mergeWav(blobs) {
  const pcs = [];
  let rate = 24000;
  for (const b of blobs) {
    const buf = new Uint8Array(await b.arrayBuffer());
    rate = new DataView(buf.buffer).getUint32(24, true);
    pcs.push(buf.subarray(44));
  }
  const total = pcs.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(44 + total);
  out.set(new Uint8Array(await blobs[0].slice(0, 44).arrayBuffer()), 0);
  const v = new DataView(out.buffer);
  v.setUint32(4, 36 + total, true);
  v.setUint32(40, total, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  let o = 44;
  for (const p of pcs) {
    out.set(p, o);
    o += p.length;
  }
  return new Blob([out], { type: "audio/wav" });
}

/** Yedek: tarayıcının yerleşik sesi (Gemini kotası dolduğunda). */
export function speakFallback(segments, onSeg, onEnd) {
  if (!("speechSynthesis" in window)) return null;
  let stopped = false;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("tr"));
  const say = (i) => {
    if (stopped || i >= segments.length) return onEnd?.();
    onSeg?.(i);
    const u = new SpeechSynthesisUtterance(segments[i].text);
    u.lang = "tr-TR";
    if (voices.length) u.voice = voices[segments[i].speaker === "Deniz" && voices.length > 1 ? 1 : 0];
    u.pitch = segments[i].speaker === "Deniz" ? 0.9 : 1.05;
    u.onend = () => say(i + 1);
    u.onerror = () => onEnd?.();
    speechSynthesis.speak(u);
  };
  say(0);
  return () => {
    stopped = true;
    speechSynthesis.cancel();
  };
}

/** Basit ses efektleri (doğru / yanlış / tamamlandı) */
let ctx;
export function sfx(kind) {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === "right" ? [660, 880] : kind === "wrong" ? [220, 180] : [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = kind === "wrong" ? "square" : "sine";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === "wrong" ? 0.04 : 0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch {
    /* ses kapalı olabilir */
  }
}
