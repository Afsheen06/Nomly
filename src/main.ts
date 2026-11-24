import "./style.css";
import { initOnDevice, parseMeal, type Source } from "./ai";
import { startListening, voiceSupported } from "./voice";
import {
  addEntry,
  entryCalories,
  isToday,
  loadEntries,
  loadGoal,
  removeEntry,
  saveGoal,
  totals,
  type MealEntry,
} from "./store";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>("mealInput");
const logBtn = $<HTMLButtonElement>("logBtn");
const micBtn = $<HTMLButtonElement>("micBtn");
const langSel = $<HTMLSelectElement>("langSel");
const statusEl = $("status");
const listEl = $("list");
const emptyEl = $("empty");
const modeChip = $("modeChip");
const modeText = $("modeText");

const mascot = $("mascot");
const bubble = $("bubble");

/* ---------- Nomi the mascot ---------- */

type Mood = "idle" | "listening" | "thinking" | "happy" | "sleepy" | "oops";

const SAYS: Record<Mood, string> = {
  idle: "What did you eat today?",
  listening: "I'm listening...",
  thinking: "Chewing on that...",
  happy: "Yum! Logged.",
  sleepy: "Full for today. Tomorrow's a fresh plate.",
  oops: "Hmm, let's try that again.",
};

let moodTimer: number | undefined;

/** The mood Nomi settles into when nothing is happening. */
function restMood(): Mood {
  const kcal = totals(loadEntries().filter((e) => isToday(e.ts))).calories;
  return kcal > goal ? "sleepy" : "idle";
}

function setMood(mood: Mood, say?: string, revertMs = 0) {
  window.clearTimeout(moodTimer);
  mascot.dataset.mood = mood;
  bubble.textContent = say ?? SAYS[mood];
  bubble.classList.remove("pop");
  void bubble.offsetWidth; // restart the pop animation
  bubble.classList.add("pop");
  if (revertMs > 0) {
    moodTimer = window.setTimeout(() => {
      const rest = restMood();
      setMood(rest);
    }, revertMs);
  }
}

const RING_C = 2 * Math.PI * 52;
let goal = loadGoal();
let busy = false;
let stopVoice: (() => void) | null = null;

const MACRO_TARGET = { p: 60, c: 250, f: 70 };

$("today").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  day: "numeric",
  month: "short",
});

function setStatus(msg: string, kind: "info" | "error" = "info") {
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind;
}

function sourceLabel(s: Source) {
  return s === "on_device" ? "On-device" : "Cloud";
}

/* ---------- Rendering ---------- */

function animateNumber(el: HTMLElement, to: number) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = String(to);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = String(Math.round(to));
    return;
  }
  const start = performance.now();
  const dur = 700;
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderSummary(entries: MealEntry[]) {
  const t = totals(entries);
  const ringFg = document.getElementById("ringFg") as unknown as SVGCircleElement;
  ringFg.style.strokeDasharray = String(RING_C);
  const pct = Math.min(1, t.calories / goal);
  ringFg.style.strokeDashoffset = String(RING_C * (1 - pct));
  ringFg.classList.toggle("over", t.calories > goal);
  animateNumber($("kcal"), t.calories);
  $("goalBtn").textContent = String(goal);

  const setBar = (barId: string, valId: string, v: number, target: number) => {
    $(barId).style.setProperty("--w", `${Math.min(100, (v / target) * 100)}%`);
    $(valId).textContent = `${Math.round(v)} g`;
  };
  setBar("barP", "valP", t.protein, MACRO_TARGET.p);
  setBar("barC", "valC", t.carbs, MACRO_TARGET.c);
  setBar("barF", "valF", t.fat, MACRO_TARGET.f);
}

function renderList(entries: MealEntry[], newId?: string) {
  listEl.innerHTML = "";
  emptyEl.style.display = entries.length ? "none" : "block";
  for (const e of entries) {
    const li = document.createElement("li");
    li.className = "meal" + (e.id === newId ? " enter" : "");

    const head = document.createElement("div");
    head.className = "meal-head";

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = new Date(e.ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    const badge = document.createElement("span");
    badge.className = `badge ${e.source}`;
    badge.textContent = sourceLabel(e.source);
    badge.title =
      e.source === "on_device"
        ? "Processed privately on this device with Gemini Nano"
        : "Processed in the cloud with Gemini";

    const kcal = document.createElement("b");
    kcal.className = "meal-kcal";
    kcal.textContent = `${entryCalories(e)} kcal`;

    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.setAttribute("aria-label", "Delete this meal");
    del.textContent = "×";
    del.addEventListener("click", () => {
      li.classList.add("leave");
      setTimeout(() => {
        removeEntry(e.id);
        refresh();
      }, 220);
    });

    head.append(time, badge, kcal, del);

    const items = document.createElement("ul");
    items.className = "items";
    for (const i of e.items) {
      const row = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${i.name} · ${i.quantity}`;
      const cal = document.createElement("span");
      cal.className = "muted";
      cal.textContent = `${i.calories} kcal · P${Math.round(i.protein_g)} C${Math.round(i.carbs_g)} F${Math.round(i.fat_g)}`;
      row.append(name, cal);
      items.append(row);
    }

    li.append(head, items);
    listEl.append(li);
  }
}

function refresh(newId?: string) {
  const today = loadEntries().filter((e) => isToday(e.ts));
  renderSummary(today);
  renderList(today, newId);
}

/* ---------- Logging a meal ---------- */

async function logMeal() {
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true;
  logBtn.disabled = true;
  logBtn.classList.add("loading");
  setStatus("Understanding your meal...");
  setMood("thinking");
  try {
    const { items, source } = await parseMeal(text);
    if (!items.length) {
      setStatus("I couldn't find any food in that. Try describing what you ate.", "error");
      setMood("oops", "I didn't spot any food in that.", 3000);
      return;
    }
    const entry: MealEntry = { id: crypto.randomUUID(), ts: Date.now(), text, items, source };
    addEntry(entry);
    input.value = "";
    refresh(entry.id);
    const kcal = entryCalories(entry);
    setStatus(`Logged using ${source === "on_device" ? "on-device AI" : "cloud AI"}.`);
    setMood("happy", `Yum! ${kcal} kcal logged.`, 2600);
  } catch (err) {
    console.error(err);
    setMood("oops", undefined, 3000);
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(
      /app.?check|403|permission/i.test(msg)
        ? "AI request was blocked by App Check. Register this device's debug token (see README)."
        : "Couldn't reach the AI right now. Check your connection and try again.",
      "error",
    );
  } finally {
    busy = false;
    logBtn.disabled = false;
    logBtn.classList.remove("loading");
  }
}

/* ---------- Voice ---------- */

function toggleMic() {
  void ensureOnDevice();
  if (stopVoice) {
    stopVoice();
    return;
  }
  micBtn.classList.add("listening");
  setStatus("Listening...");
  setMood("listening");
  stopVoice = startListening(langSel.value, {
    onText: (text, final) => {
      input.value = text;
      if (final) setStatus("Got it. Tap Log meal, or edit the text first.");
    },
    onError: (m) => {
      setStatus(m, "error");
      setMood("oops", m, 3000);
    },
    onEnd: () => {
      stopVoice = null;
      micBtn.classList.remove("listening");
      if (input.value.trim() && statusEl.dataset.kind !== "error") void logMeal();
      else if (mascot.dataset.mood === "listening") setMood(restMood());
    },
  });
}

if (!voiceSupported) {
  micBtn.disabled = true;
  micBtn.title = "Voice input isn't supported in this browser";
}

/* ---------- On-device model status ---------- */

let onDeviceStarted = false;

function ensureOnDevice() {
  if (onDeviceStarted) return Promise.resolve();
  onDeviceStarted = true;
  modeText.textContent = "Preparing on-device AI...";
  return initOnDevice((pct) => {
    modeText.textContent = `Downloading on-device model ${pct}%`;
  }).then(updateModeChip);
}

async function updateModeChip() {
  // Chrome's Prompt API exposes availability through the LanguageModel global.
  const LM = (window as unknown as { LanguageModel?: { availability: () => Promise<string> } }).LanguageModel;
  let state = "unsupported";
  try {
    if (LM) state = await LM.availability();
  } catch {
    /* ignore */
  }
  modeChip.dataset.state = state;
  modeText.textContent =
    state === "available"
      ? "On-device AI ready"
      : state === "downloading" || state === "downloadable"
        ? "On-device AI downloading"
        : "Cloud AI (no on-device model here)";
}

/* ---------- Wiring ---------- */

logBtn.addEventListener("click", () => {
  void ensureOnDevice();
  void logMeal();
});
micBtn.addEventListener("click", toggleMic);
modeChip.addEventListener("click", () => void ensureOnDevice());
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void logMeal();
  }
});
$("goalBtn").addEventListener("click", () => {
  const v = Number(prompt("Daily calorie goal (kcal)", String(goal)));
  if (Number.isFinite(v) && v >= 800 && v <= 6000) {
    goal = Math.round(v);
    saveGoal(goal);
    refresh();
  }
});

void updateModeChip();
refresh();
setMood(restMood());

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
