import type { FoodItem, Source } from "./ai";

export interface MealEntry {
  id: string;
  ts: number;
  text: string;
  items: FoodItem[];
  source: Source;
}

const KEY = "nomly.entries.v1";
const GOAL_KEY = "nomly.goal.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app still works for this session */
  }
}

export function loadEntries(): MealEntry[] {
  return read<MealEntry[]>(KEY, []);
}

export function addEntry(entry: MealEntry) {
  write(KEY, [entry, ...loadEntries()]);
}

export function removeEntry(id: string) {
  write(KEY, loadEntries().filter((e) => e.id !== id));
}

export function loadGoal(): number {
  return read<number>(GOAL_KEY, 2000);
}

export function saveGoal(kcal: number) {
  write(GOAL_KEY, kcal);
}

export function isToday(ts: number): boolean {
  const a = new Date(ts);
  const b = new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function totals(entries: MealEntry[]) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    for (const i of e.items) {
      t.calories += i.calories;
      t.protein += i.protein_g;
      t.carbs += i.carbs_g;
      t.fat += i.fat_g;
    }
  }
  return t;
}

export function entryCalories(e: MealEntry): number {
  return e.items.reduce((sum, i) => sum + i.calories, 0);
}
