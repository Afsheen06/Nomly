# Nomly

**Say what you ate. Nomly logs it.** A voice-first food log for Indian meals, built for the #BuildHybridAI hackathon with **Firebase AI Logic hybrid inference**.

- **On-device first:** when Chrome has Gemini Nano available, meal parsing runs privately on the device, free and offline-capable.
- **Cloud fallback:** on devices without an on-device model (most phones, including mid-range Android), the same request goes to Gemini in the cloud automatically.
- **Every logged meal shows which path ran** (On-device or Cloud badge), so the hybrid behaviour is visible.

## Value proposition

Calorie apps make you search and tap through databases, and they handle Indian dishes badly. Nomly lets you say "2 idli, sambar, oru filter coffee" and returns structured calories and macros in seconds. Privacy-sensitive food data stays on the device whenever the device can run the model, and nobody is excluded when it can't.

## How Firebase AI Logic is used

See [`src/ai.ts`](src/ai.ts):

- `getAI` with the Gemini Developer API backend (free tier).
- `getGenerativeModel` with `InferenceMode.PREFER_ON_DEVICE` for hybrid routing.
- Structured JSON output configured for both paths (`inCloudParams.generationConfig` and `onDeviceParams.promptOptions.responseConstraint`).
- `initializeDeviceModel()` called from a user gesture, with download progress in the UI.
- `response.inferenceSource` read on every result to show the On-device / Cloud badge.
- Firebase App Check (debug provider for development, reCAPTCHA v3 for production) in [`src/firebase.ts`](src/firebase.ts).

## Run it

Requirements: Node.js 20+, Chrome on desktop (v139+) for the on-device path.

```bash
npm install
npm run dev
```

1. Open the printed localhost URL, open the browser console, and copy the **App Check debug token**.
2. Register it in Firebase console > App Check > Apps > your web app > Manage debug tokens.
3. Reload and log a meal.

### See the on-device path in Chrome

1. Update Chrome and enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, then restart.
2. Click the status chip or the mic in Nomly once to start the model download (it can take several minutes).
3. When the chip says "On-device AI ready", logged meals show the **On-device** badge.

On devices with no on-device model, Nomly works the same and shows the **Cloud** badge.

### Build and deploy

```bash
cp .env.example .env.local   # add VITE_RECAPTCHA_SITE_KEY (or a debug token for a personal demo build)
npm run build
npx firebase-tools deploy --only hosting
```

Install on Android: open the hosted URL in Chrome, then menu > Add to Home screen.

## Built during the hackathon

Nomly began as an Android nutrition-tracking idea. This web version was built from scratch for #BuildHybridAI: the hybrid AI pipeline, voice logging, the meal-parsing prompt, the animated UI and PWA support.

## Notes and limits

- Nutrition values are AI estimates, not medical advice.
- On-device inference works in Chrome on desktop only; Tamil speech input needs an internet connection on Android Chrome, and the on-device model is configured for English text.
- Meals are stored in the browser's local storage.

## License

Apache 2.0, see [LICENSE](LICENSE).
