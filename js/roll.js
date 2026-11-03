// Firestore side of the HR nominal roll: one document per institution at roll/{key}.
// Only name, employee number, job and at-post/on-leave are stored (no bank, SSNIT, Ghana Card, date of birth or phone numbers).
import { db } from "./firebase.js";
import {
  collection, doc, getDoc, getDocs, getDocFromCache, getDocsFromCache, writeBatch, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { rollKey } from "./roll-core.js";

export * from "./roll-core.js";

// Server first, but fall back to the copy on the device if the network is slow or down.
async function withCacheFallback(online, cached, ms = 8000) {
  let timer;
  try {
    return await Promise.race([online(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("slow connection")), ms)))]);
  } catch (err) {
    try { return await cached(); } catch { throw err; }
  } finally { clearTimeout(timer); }
}

// The roll for one institution, or null if HR has not uploaded one.
export async function loadRoll(institutionName) {
  const ref = doc(db, "roll", rollKey(institutionName));
  const snap = await withCacheFallback(() => getDoc(ref), () => getDocFromCache(ref), 6000);
  return snap.exists() ? snap.data() : null;
}

// Every institution's roll (for the Nominal roll page).
export async function loadAllRolls() {
  const q = collection(db, "roll");
  const snap = await withCacheFallback(() => getDocs(q), () => getDocsFromCache(q), 10000);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// HR only (enforced by firestore.rules). Replaces the roll saved for each sheet in the upload.
export async function saveRolls(sheets, user, fileName) {
  if (!navigator.onLine) throw new Error("You need to be online to import the roll.");
  const batch = writeBatch(db);
  const now = Date.now();
  for (const s of sheets) {
    batch.set(doc(db, "roll", s.key), {
      key: s.key, institution: s.institution, sheet: s.sheet,
      staff: s.staff, count: s.count, onLeave: s.onLeave,
      importedAt: now, importedBy: user.uid, importedByName: user.displayName || user.email || "", source: fileName || ""
    });
  }
  await batch.commit();
}

// HR only (enforced by firestore.rules). Removes the roll saved for one institution.
export async function deleteRoll(key) {
  if (!navigator.onLine) throw new Error("You need to be online to delete a roll.");
  await deleteDoc(doc(db, "roll", key));
}
