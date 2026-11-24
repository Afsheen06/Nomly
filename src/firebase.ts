import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// Public web config (safe to ship; access is protected by App Check).
const firebaseConfig = {
  apiKey: "AIzaSyCwdNTQYyuJHUzC54DLT1EThAdQcPkJtJo",
  authDomain: "nutrisnap-98489.firebaseapp.com",
  projectId: "nutrisnap-98489",
  storageBucket: "nutrisnap-98489.firebasestorage.app",
  messagingSenderId: "696789514663",
  appId: "1:696789514663:web:238660f65366b475d55e82",
};

export const firebaseApp = initializeApp(firebaseConfig);

/**
 * App Check is enforced for Firebase AI Logic, so it must be initialised
 * BEFORE the first AI call.
 *
 * - Local dev (`npm run dev`): debug provider. Open the browser console, copy the
 *   printed debug token and register it in Firebase console > App Check > Apps >
 *   Manage debug tokens.
 * - Demo / phone build: set VITE_APPCHECK_DEBUG_TOKEN in .env.local to a token you
 *   registered yourself (never commit it).
 * - Production: set VITE_RECAPTCHA_SITE_KEY (reCAPTCHA v3 site key registered in App Check).
 */
const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;

if (import.meta.env.DEV || debugToken) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    debugToken || true;
}

initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaEnterpriseProvider(siteKey || "debug-placeholder"),
  isTokenAutoRefreshEnabled: true,
});
