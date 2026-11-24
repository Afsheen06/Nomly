import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  Schema,
} from "firebase/ai";
import { firebaseApp } from "./firebase";

export type Source = "on_device" | "in_cloud";

export interface FoodItem {
  name: string;
  quantity: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ParsedMeal {
  items: FoodItem[];
  source: Source;
}

const CLOUD_MODEL = "gemini-3.5-flash-lite";

/** The prompt that turns spoken or typed meal text into structured data. */
const SYSTEM_PROMPT = `You are the food-logging parser inside Nomly, an app for everyday Indian eating.
Read the meal text and return JSON: {"items":[...]}.
Rules:
- One item per food or drink. Split combos: "idli sambar" is idli plus sambar.
- Understand English, Tamil and Hindi food words, in English letters or native script.
  Number words: oru/onnu=1, rendu/irandu=2, moonu=3, naalu=4, anju=5; ek=1, do=2, teen=3.
  Words like thosai/dosai, vadai, kuzhambu, poriyal, kootu, appalam, chai, roti, sabzi, dal are food.
- "quantity" is a short phrase such as "2 pieces", "1 bowl", "1 cup", "1 plate". With no amount, use one typical home serving.
- calories are whole kcal for the quantity eaten; protein_g, carbs_g, fat_g are grams. All are honest estimates.
- Typical values: idli 58 kcal each; plain dosa 130; masala dosa 250; medu vada 140; pongal 1 bowl 230; chapati 100; parotta 260; cooked rice 1 cup 205; sambar 1 bowl 90; rasam 1 cup 40; coconut chutney 2 tbsp 60; chicken biryani 1 plate 450; boiled egg 78; banana 90; filter coffee 70; tea with milk and sugar 90; pizza slice 285.
- If the text has no food, return {"items":[]}.
Example input: oru dosai, rendu idli, coconut chutney
Example output: {"items":[{"name":"Dosa","quantity":"1 piece","calories":130,"protein_g":3,"carbs_g":25,"fat_g":2},{"name":"Idli","quantity":"2 pieces","calories":116,"protein_g":4,"carbs_g":24,"fat_g":0.4},{"name":"Coconut chutney","quantity":"2 tbsp","calories":60,"protein_g":1,"carbs_g":3,"fat_g":5}]}
Example input: 3 slices of pizza
Example output: {"items":[{"name":"Pizza","quantity":"3 slices","calories":855,"protein_g":36,"carbs_g":99,"fat_g":33}]}`;

const mealSchema = Schema.object({
  properties: {
    items: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          quantity: Schema.string(),
          calories: Schema.number(),
          protein_g: Schema.number(),
          carbs_g: Schema.number(),
          fat_g: Schema.number(),
        },
      }),
    }),
  },
});

const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });

/** Hybrid model: Gemini Nano in Chrome when available, otherwise Gemini in the cloud. */
const hybridModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: {
    model: CLOUD_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json", responseSchema: mealSchema },
  },
  onDeviceParams: {
    createOptions: {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
      initialPrompts: [{ role: "system", content: [{ type: "text", value: SYSTEM_PROMPT }] }],
    },
    promptOptions: { responseConstraint: mealSchema },
  },
});

/** Safety net: if the on-device attempt throws, we retry in the cloud. */
const cloudModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: {
    model: CLOUD_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json", responseSchema: mealSchema },
  },
});

let deviceInit: Promise<void> | null = null;

/**
 * Starts the on-device model download. Chrome requires a user gesture, so call this
 * from a click/tap handler. Safe to call many times.
 */
export function initOnDevice(onProgress: (pct: number) => void): Promise<void> {
  if (!deviceInit) {
    deviceInit = Promise.resolve()
      .then(() => hybridModel.initializeDeviceModel((v) => onProgress(Math.round(v * 100))))
      .catch((err) => {
        console.warn("On-device model unavailable, using cloud only:", err);
      });
  }
  return deviceInit;
}

function toSource(s: string | undefined): Source {
  return s === InferenceSource.ON_DEVICE ? "on_device" : "in_cloud";
}

function parse(text: string): FoodItem[] {
  const data = JSON.parse(text) as { items?: FoodItem[] };
  return (data.items ?? []).map((i) => ({
    name: String(i.name ?? "Food"),
    quantity: String(i.quantity ?? "1 serving"),
    calories: Math.max(0, Math.round(Number(i.calories) || 0)),
    protein_g: Math.max(0, Math.round((Number(i.protein_g) || 0) * 10) / 10),
    carbs_g: Math.max(0, Math.round((Number(i.carbs_g) || 0) * 10) / 10),
    fat_g: Math.max(0, Math.round((Number(i.fat_g) || 0) * 10) / 10),
  }));
}

/**
 * The on-device model here is configured for English text, so meals written in Tamil or other
 * scripts go straight to the cloud model. Everything else uses hybrid routing.
 */
const NON_LATIN = /[^\u0000-\u024F\u2000-\u206F]/;

/** Turns "2 idli with sambar" into structured items and reports which path ran. */
export async function parseMeal(text: string): Promise<ParsedMeal> {
  const prompt = `Meal: ${text}`;
  if (NON_LATIN.test(text)) {
    const result = await cloudModel.generateContent(prompt);
    return { items: parse(result.response.text()), source: "in_cloud" };
  }
  try {
    const result = await hybridModel.generateContent(prompt);
    return { items: parse(result.response.text()), source: toSource(result.response.inferenceSource) };
  } catch (err) {
    console.warn("Hybrid call failed, retrying in the cloud:", err);
    const result = await cloudModel.generateContent(prompt);
    return { items: parse(result.response.text()), source: "in_cloud" };
  }
}

/* ---------- Photo scan (cloud vision) ---------- */

const PHOTO_PROMPT = `You are the photo food scanner inside Nomly, an app for everyday Indian eating.
Look at the photo of a meal and return JSON: {"items":[...]} using the same fields as the text parser
(name, quantity, calories, protein_g, carbs_g, fat_g).
- One item per visible food or drink. Judge portion size from the plate, bowl, or hand if visible.
- "quantity" is a short phrase such as "2 pieces" or "1 plate". Values are honest estimates.
- If you are unsure of a dish, give your best guess in "name" with a typical home-style serving.
- If the photo has no food, return {"items":[]}.`;

const photoModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: {
    model: CLOUD_MODEL,
    systemInstruction: PHOTO_PROMPT,
    generationConfig: { responseMimeType: "application/json", responseSchema: mealSchema },
  },
});

/** Shrinks a phone photo before upload: faster, cheaper, and still plenty for food. */
async function shrinkImage(file: File, maxSide = 1024): Promise<{ mimeType: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { mimeType: "image/jpeg", data: dataUrl.split(",")[1] };
}

/** Scans a photo of a meal. Always runs in the cloud, because image input isn't available on-device. */
export async function parsePhoto(file: File): Promise<ParsedMeal> {
  const image = await shrinkImage(file);
  const result = await photoModel.generateContent([
    "Scan this meal photo.",
    { type: "inlineData", inlineData: image },
  ]);
  return { items: parse(result.response.text()), source: "in_cloud" };
}
