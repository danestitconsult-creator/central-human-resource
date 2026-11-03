import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { isIOS } from "./env.js";

export const configured = !String(firebaseConfig.apiKey).startsWith("YOUR_");
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Offline support: data is cached in the browser (IndexedDB) and edits made offline
// are synced automatically when the connection returns.
// Safari/iOS is less reliable with the multi-tab cache, and phones rarely use several tabs, so iOS gets the single-tab one.
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: isIOS ? persistentSingleTabManager({}) : persistentMultipleTabManager() })
  });
} catch (err) {
  console.warn("Offline cache unavailable, using online-only mode:", err);
  firestore = getFirestore(app);
}
export const db = firestore;
