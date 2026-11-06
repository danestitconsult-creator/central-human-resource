import { db, configured } from "./firebase.js";
import { initAuth } from "./auth.js";
import {
  collection, doc, getDoc, getDocFromCache, setDoc, updateDoc, deleteDoc, query, where, getDocs, getDocsFromCache
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { computeSummary, pct, LEVELS, CHECKLIST, LEAVE_TYPES, computeLeave, leaveDays, leaveResumes, leaveStatus } from "./calc.js";
import { isIOS, isStandalone, isEmbeddedWebView } from "./env.js";
import { loadRoll, loadAllRolls, saveRolls, deleteRoll, parseRollWorkbook, prepareRoll, matchStaff, crossCheck, rollKey } from "./roll.js";
import { EV_LIMITS, EV_CATEGORIES, EV_CATEGORIES_EDTECH, prepareEvidenceFile, dataUrlToBlob, fmtSize } from "./evidence.js";
import { prepareAvatar } from "./avatar.js";
import { computeEdtech, FIXED_TOOLS, ITEM_TYPES, CONDITIONS, EDTECH_AREAS } from "./edtech-calc.js";

const $ = id => document.getElementById(id);
const main = $("main");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const LIMITS = { attendance: 200, movement: 60, findings: 15, tools: 20, allocation: 200, leave: 100 };
// Two monitoring departments share one app: Human Resource (the original attendance check, listed first) and EdTech.
// A check with no "department" field was recorded before EdTech existed, so it is a Human Resource check.
const DEPTS = [["hr", "Human Resource"], ["edtech", "EdTech"]];
const deptOf = d => (d?.department === "edtech" ? "edtech" : "hr");
const deptName = k => DEPTS.find(([x]) => x === k)[1];
const TABS_HR = [
  ["institution", "Institution"],
  ["attendance", "Attendance"],
  ["roll", "Nominal roll"],
  ["movement", "Movement log"],
  ["leave", "Leave"],
  ["records", "Records checklist"],
  ["findings", "Findings"],
  ["evidence", "Evidence"],
  ["summary", "Summary"]
];
const TABS_ET = [
  ["institution", "Institution"],
  ["tools", "Technology tools"],
  ["allocation", "Staff allocation"],
  ["findings", "Findings"],
  ["evidence", "Evidence"],
  ["summary", "Summary"]
];
const tabsFor = d => (d === "edtech" ? TABS_ET : TABS_HR);
const isEt = () => state?.department === "edtech";
const homeHash = d => (d === "edtech" ? "#/edtech" : "#/");
const CHECK_TYPES = ["Announced", "Unannounced"];

const DEFAULT_INSTITUTIONS = [
  "CENTRAL REGIONAL DIRECTORATE", "AJUMAKO AFRANSE TECHNICAL", "TSC ASSIN ADUBIASE TECHNICAL", "ASSIN FOSO TECHNICAL",
  "BIRIWA TECHNICAL", "CAPE COAST TECHNICAL", "ENYAN ABAASA TECHNICAL", "GOMOA ADAA TECHNICAL", "NEW EBU TECHNICAL",
  "ASAFORA TECHNICAL", "PANFOKROM TECHNICAL", "MANKESSIM TECHNICAL", "BREMAN ASIKUMA TECHNICAL",
  "SOCIAL WELFARE GIRLS TECHNICAL", "ASSIN JAKAI TECHNICAL", "ASUANSI TECHNICAL", "AGONA SWEDRU TECHNICAL",
  "WINNEBA TECHNICAL", "TSC AWUTU BERAKU TECHNICAL", "GOMOA MAMPONG TECHNICAL"
];

// The 22 Metropolitan, Municipal and District Assemblies of the Central Region of Ghana
const DISTRICTS = [
  "Abura-Asebu-Kwamankese", "Agona East", "Agona West Municipal", "Ajumako-Enyan-Essiam", "Asikuma-Odoben-Brakwa",
  "Assin Central Municipal", "Assin North", "Assin South", "Awutu Senya", "Awutu Senya East Municipal",
  "Cape Coast Metropolitan", "Effutu Municipal", "Ekumfi", "Gomoa Central", "Gomoa East", "Gomoa West",
  "Komenda-Edina-Eguafo-Abirem (KEEA) Municipal", "Mfantsiman Municipal", "Twifo Atti-Morkwa",
  "Twifo-Heman-Lower Denkyira", "Upper Denkyira East Municipal", "Upper Denkyira West"
];

const STAFF_CATEGORIES = ["Principals", "Regional Staff", "Institute staff", "NSS Personnels", "Voluntary Staff", "Reporting staff"];

const sortList = arr => [...arr].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
let institutions = sortList(DEFAULT_INSTITUTIONS);
let schoolCodes = {};   // { institution name: institute code }, kept by HR and team leads
const codeFor = name => String(schoolCodes[name] || "").trim();
const STATUSES = ["On time", "Late", "Absent", "On leave", "On duty elsewhere"];
const RATINGS = ["Good", "Fair", "Poor"];
const AREAS = [["attendance", "Attendance"], ["punctuality", "Punctuality"], ["movement", "Staff movement control"], ["records", "Quality of records"]];
const ROLES = [["lead", "Lead monitor"], ["member", "Monitoring team member"], ["head", "Head of institution (acknowledgement)"]];

let user = null, state = null, docId = null, tab = "institution", dashDept = "hr";
let rollStaff = null, rollInfo = null, evidence = null, evidenceError = "", allRolls = null, lastRollTotal = null;   // HR nominal roll of the open check's institution, its evidence files, all rolls (Nominal roll page)
let profile = { role: "monitor" }, readOnly = false, dashView = "mine";
let saveTimer = null, dirty = false;

/* ---------- blank data ---------- */
const blankAtt = () => ({ name: "", level: "", grade: "", dept: "", signed: "", arrival: "", present: "", status: "", remarks: "" });
const blankMov = () => ({ name: "", level: "", dept: "", left: "", reason: "", destination: "", authorisedBy: "", entered: "", expectedReturn: "", remarks: "" });
const blankFind = () => ({ finding: "", level: "", evidence: "", action: "", officer: "", deadline: "" });
const blankLeave = (name = "") => ({ name, type: "", start: "", end: "", remarks: "" });
const blankFindEt = () => ({ finding: "", evidence: "", action: "", officer: "", deadline: "" });
const blankTool = (item = "") => ({ item, quantity: "", distributed: "", stores: "", condition: "", remarks: "" });
const blankAlloc = (type = "") => ({ type, other: "", staff: "", dept: "", quantity: "", condition: "", remarks: "" });
const rep = (n, f) => Array.from({ length: n }, f);

function newInspection(dept = "hr") {
  if (dept === "edtech") {
    return {
      ownerId: user.uid,
      ownerName: user.displayName || user.email || "",
      department: "edtech",
      createdAt: Date.now(), updatedAt: Date.now(),
      institution: { name: "", code: "", location: "", head: "", date: "", type: "", team: "", arrived: "", departed: "" },
      tools: [...FIXED_TOOLS.map(blankTool), blankTool()],    // desktops, laptops, SM1 tablets, then one row for other items
      allocation: ITEM_TYPES.map(blankAlloc),
      findings: rep(3, blankFindEt),
      assessment: Object.fromEntries(EDTECH_AREAS.map(([k]) => [k, { rating: "", comment: "" }])),
      signoff: Object.fromEntries(ROLES.map(([k]) => [k, { name: "", signature: "", date: "" }]))
    };
  }
  return {
    ownerId: user.uid,
    department: "hr",
    ownerName: user.displayName || user.email || "",
    createdAt: Date.now(), updatedAt: Date.now(),
    institution: { name: "", code: "", location: "", head: "", date: "", type: "", team: "", arrived: "", departed: "", roll: "", startTime: "", categories: [] },
    attendance: rep(10, blankAtt),
    movement: rep(5, blankMov),
    leave: rep(5, blankLeave),
    records: CHECKLIST.map(() => ({ response: "", remarks: "" })),
    findings: rep(3, blankFind),
    assessment: Object.fromEntries(AREAS.map(([k]) => [k, { rating: "", comment: "" }])),
    signoff: Object.fromEntries(ROLES.map(([k]) => [k, { name: "", signature: "", date: "" }]))
  };
}

// Make sure documents loaded from Firestore always have every field
const yn = v => (v === "Y" ? "Yes" : v === "N" ? "No" : v || "");   // older checks stored Y / N

function parseCategories(v) {
  const list = Array.isArray(v) ? v : String(v || "").split(/[,;\n]/);
  return STAFF_CATEGORIES.filter(c => list.some(x => String(x).trim().toLowerCase() === c.toLowerCase()));
}

function normaliseEdtech(d) {
  const base = newInspection("edtech");
  const tools = (d.tools || []).map(r => ({ ...blankTool(), ...r }));
  FIXED_TOOLS.forEach((item, n) => { tools[n] = { ...blankTool(), ...(tools[n] || {}), item }; });   // the first three rows are fixed
  if (tools.length === FIXED_TOOLS.length) tools.push(blankTool());
  return {
    ...base, ...d, department: "edtech",
    institution: { ...base.institution, ...(d.institution || {}) },
    tools,
    allocation: (d.allocation?.length ? d.allocation : base.allocation).map(r => ({ ...blankAlloc(), ...r })),
    findings: (d.findings?.length ? d.findings : base.findings).map(r => ({ ...blankFindEt(), ...r })),
    assessment: { ...base.assessment, ...(d.assessment || {}) },
    signoff: { ...base.signoff, ...(d.signoff || {}) }
  };
}

function normalise(d) {
  if (deptOf(d) === "edtech") return normaliseEdtech(d);
  const base = newInspection("hr");
  return {
    ...base, ...d, department: "hr",
    institution: { ...base.institution, ...(d.institution || {}), categories: parseCategories(d.institution?.categories) },
    attendance: (d.attendance?.length ? d.attendance : base.attendance)
      .map(r => ({ ...blankAtt(), ...r, signed: yn(r.signed), present: yn(r.present) })),
    movement: (d.movement?.length ? d.movement : base.movement)
      .map(r => ({ ...blankMov(), ...r, entered: yn(r.entered) })),
    leave: (d.leave?.length ? d.leave : base.leave).map(r => ({ ...blankLeave(), ...r })),
    records: CHECKLIST.map((_, i) => ({ ...base.records[i], ...(d.records?.[i] || {}) })),
    findings: d.findings?.length ? d.findings : base.findings,
    assessment: { ...base.assessment, ...(d.assessment || {}) },
    signoff: { ...base.signoff, ...(d.signoff || {}) }
  };
}

/* ---------- small helpers ---------- */
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hidden"), 3000);
}
/* In-app dialogs. window.prompt/confirm are blocked or missing in iPhone Home Screen apps and wrapped apps, so we draw our own. */
function modal({ title, message = "", input = "", confirmLabel = "OK", cancelLabel = "Cancel", danger = false }) {
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <h3 id="m-title">${esc(title)}</h3>
      ${message ? `<p class="muted">${esc(message)}</p>` : ""}
      ${input ? `<label>${esc(input)}<input id="m-input" type="text" autocomplete="off" autocapitalize="characters" enterkeyhint="done"></label>` : ""}
      <div class="modal-actions">
        <button type="button" class="btn" data-m="cancel">${esc(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? "danger-solid" : "primary"}" data-m="ok">${esc(confirmLabel)}</button>
      </div></div>`;
    document.body.appendChild(back);
    const field = back.querySelector("#m-input");
    const done = v => { document.removeEventListener("keydown", onKey); back.remove(); resolve(v); };
    const ok = () => done(field ? field.value : true);
    const onKey = e => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter" && e.target === field) { e.preventDefault(); ok(); }
    };
    back.addEventListener("click", e => {
      if (e.target === back || e.target.dataset.m === "cancel") done(null);
      else if (e.target.dataset.m === "ok") ok();
    });
    document.addEventListener("keydown", onKey);
    (field || back.querySelector('[data-m="ok"]')).focus();
  });
}
const askText = (title, label, confirmLabel) => modal({ title, input: label, confirmLabel });
const askConfirm = (title, message, confirmLabel = "Delete") => modal({ title, message, confirmLabel, danger: true }).then(v => v === true);

// Waits for the server to confirm a write, but not forever: on a weak mobile connection Firestore keeps the
// write safely on the device and syncs later, so after a few seconds we carry on instead of freezing the screen.
async function settle(write, ms = 6000) {
  let timer;
  const timeout = new Promise(res => (timer = setTimeout(() => res("pending"), ms)));
  try { return await Promise.race([write.then(() => "synced"), timeout]); }
  finally { clearTimeout(timer); }
}

// Reads from the server, but falls back to the copy saved on the device if the network is slow or down.
// (navigator.onLine is often wrong on iPhones, e.g. on a weak signal.)
async function withCacheFallback(online, cached, ms = 8000) {
  let timer;
  try {
    return await Promise.race([online(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("slow connection")), ms)))]);
  } catch (err) {
    try { return await cached(); } catch { throw err; }
  } finally { clearTimeout(timer); }
}

const opts = (list, val, blank = true) =>
  (blank ? '<option value=""></option>' : "") + list.map(o => `<option${o === val ? " selected" : ""}>${esc(o)}</option>`).join("");
const inp = (path, val, type = "text", extra = "") => `<input type="${type}" data-path="${path}" value="${esc(val)}" ${extra}>`;
const sel = (path, list, val) => `<select data-path="${path}" data-val="${esc(val)}">${opts(list, val)}</select>`;
const YN = ["Yes", "No"];

function setByPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}
const getByPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

/* ---------- saving ---------- */
function setStatus(text) {
  const el = $("save-status");
  if (!el) return;
  el.textContent = text;
  el.className = "muted small " + (/failed/i.test(text) ? "failed" : /unsaved|saving|on this device/i.test(text) ? "pending" : "");
}

function scheduleSave() {
  if (readOnly) return;
  dirty = true; setStatus("Unsaved changes…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1200);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (readOnly || !dirty || !state || !docId) return;
  dirty = false; setStatus("Saving…");
  try {
    state.updatedAt = Date.now();
    const write = setDoc(doc(db, "inspections", docId), state);
    const outcome = navigator.onLine ? await settle(write) : "pending";
    if (outcome === "synced") {
      setStatus("All changes saved");
    } else {
      // Offline or slow: the write is stored on the device and sent automatically when the connection returns.
      setStatus("Saved on this device. Will sync when online");
      write.then(() => { if (!dirty) setStatus("All changes saved"); }).catch(console.error);
    }
  } catch (err) {
    dirty = true; setStatus("Save failed");
    console.error(err); toast("Could not save: " + (err.code || err.message));
  }
}
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
// iPhones freeze and discard pages the moment you switch apps and rarely fire "beforeunload", so save right away
// whenever the page is hidden instead of waiting for the typing pause.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveNow(); });
window.addEventListener("pagehide", () => { saveNow(); });

/* ---------- user profile, roles, network ---------- */
const isLead = () => profile.role === "lead";
const isHr = () => profile.role === "hr";
const isEdtechRole = () => profile.role === "edtech";
const isDeputy = () => profile.role === "deputy";   // Deputy Director: supervises every department (read-only)
// Leads, HR and the Deputy Director can open every monitor's check (read-only). The EdTech role does the same, but for EdTech checks only.
const canSeeAll = () => isLead() || isHr() || isDeputy() || isEdtechRole();
const canSeeDept = d => isLead() || isHr() || isDeputy() || (isEdtechRole() && d === "edtech");
const deptsFor = () => (isEdtechRole() ? DEPTS.filter(([k]) => k === "edtech") : DEPTS);
const canEvidenceAny = () => isHr() || (isEdtechRole() && isEt());   // may add evidence to other monitors' checks

const ROLE_LABELS = { monitor: "Monitor", lead: "Team lead", hr: "HR", edtech: "EdTech officer", deputy: "Deputy Director" };
const initialsOf = who => who.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
function renderAvatar() {
  const who = user.displayName || user.email || "";
  for (const el of document.querySelectorAll(".avatar")) {
    const photo = profile.photo || "";
    el.classList.toggle("has-photo", !!photo);
    el.style.backgroundImage = photo ? `url("${photo}")` : "";
    el.textContent = photo ? "" : initialsOf(who);
  }
}

async function loadProfile() {
  profile = { role: "monitor" };
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await withCacheFallback(() => getDoc(ref), () => getDocFromCache(ref), 5000);
    const name = user.displayName || "", email = user.email || "";
    if (!snap.exists()) {
      profile = { name, email, role: "monitor", createdAt: Date.now() };
      setDoc(ref, profile).catch(e => console.warn("Could not create profile", e));
    } else {
      profile = snap.data();
      if (name && profile.name !== name) {
        profile.name = name;
        updateDoc(ref, { name }).catch(e => console.warn("Could not update profile", e));
      }
    }
  } catch (e) { console.warn("Could not load profile (are the Firestore rules published?)", e); }
  const who = user.displayName || user.email || "";
  $("user-label").textContent = who;
  renderAvatar();
  const badge = $("role-badge");
  badge.textContent = isHr() ? "HR" : isDeputy() ? "Deputy Director" : isEdtechRole() ? "EdTech" : "Team lead";
  dashView = isDeputy() ? "all" : "mine";   // the Deputy Director opens on everyone's records
  badge.classList.toggle("hidden", !canSeeAll());
}

async function loadInstitutions() {
  institutions = sortList(DEFAULT_INSTITUTIONS);
  try {
    const ref = doc(db, "config", "institutions");
    const snap = await withCacheFallback(() => getDoc(ref), () => getDocFromCache(ref), 5000);
    if (snap.exists() && Array.isArray(snap.data().list)) institutions = sortList(snap.data().list);
  } catch (e) { console.warn("Could not load institution list (are the Firestore rules published?)", e); }
  schoolCodes = {};
  try {
    const ref = doc(db, "config", "schoolCodes");
    const snap = await withCacheFallback(() => getDoc(ref), () => getDocFromCache(ref), 5000);
    if (snap.exists() && snap.data().codes && typeof snap.data().codes === "object") schoolCodes = { ...snap.data().codes };
  } catch (e) { console.warn("Could not load institute codes (are the Firestore rules published?)", e); }
}

const canEditCodeList = () => isHr() || isLead();
// Saves one institution's code in the shared list (HR and team leads only, enforced by the rules too).
async function saveSchoolCode(name, code) {
  if (!name || !canEditCodeList()) return false;
  code = String(code || "").trim();
  const previous = schoolCodes[name];
  schoolCodes[name] = code;
  try {
    const write = setDoc(doc(db, "config", "schoolCodes"), { codes: { [name]: code }, updatedAt: Date.now(), updatedBy: user.uid }, { merge: true });
    if (navigator.onLine) await settle(write); else write.catch(console.error);
    return true;
  } catch (err) {
    if (previous === undefined) delete schoolCodes[name]; else schoolCodes[name] = previous;
    toast("Could not save the institute code: " + (err.code || err.message));
    return false;
  }
}

// Saves the shared institution list. Returns true on success, restores the old list on failure.
async function persistInstitutions(list) {
  const previous = institutions;
  institutions = sortList(list);
  try {
    const write = setDoc(doc(db, "config", "institutions"), { list: institutions, updatedAt: Date.now(), updatedBy: user.uid });
    if (navigator.onLine) await settle(write); else write.catch(console.error);
    return true;
  } catch (err) {
    institutions = previous;
    toast("Could not update the institution list: " + (err.code || err.message));
    return false;
  }
}

async function addInstitution() {
  const raw = await askText("Add an institution", "Name of the new institution", "Add");
  if (raw === null) return;
  const name = raw.trim().replace(/\s+/g, " ").toUpperCase();
  if (!name) return;
  if (institutions.some(x => x.toLowerCase() === name.toLowerCase())) return toast("That institution is already in the list.");
  if (await persistInstitutions([...institutions, name])) {
    state.institution.name = name;
    $("title").textContent = name;
    scheduleSave(); renderTab(); toast("Institution added");
  }
}

async function deleteInstitution() {
  const name = state.institution.name;
  if (!name) return toast("Select an institution to delete first.");
  if (!institutions.includes(name)) return toast("That name is not in the list.");
  if (!(await askConfirm(`Remove "${name}"?`, "It will be removed from the institution list. Checks already recorded for it are not deleted.", "Remove"))) return;
  if (await persistInstitutions(institutions.filter(x => x !== name))) { renderTab(); toast("Institution removed from the list"); }
}

function updateNet() { $("offline-badge").classList.toggle("hidden", navigator.onLine); }
window.addEventListener("online", () => { updateNet(); saveNow(); });
window.addEventListener("offline", updateNet);

/* ---------- routing ---------- */
function route() {
  if (!user) return;
  const h = location.hash;
  if (h === "#/new" || h === "#/new/edtech") {   // app-icon shortcuts "New check" / "New EdTech check"
    const dept = h === "#/new/edtech" || isEdtechRole() ? "edtech" : "hr";
    history.replaceState(null, "", location.pathname + location.search + homeHash(dept));
    return createInspection(dept);
  }
  if (h === "#/roll") return showRollPage();
  if (h === "#/profile") return showProfilePage();
  const m = h.match(/^#\/i\/(.+)$/);
  if (m) return openEditor(m[1]);
  dashDept = h === "#/edtech" || isEdtechRole() ? "edtech" : "hr";
  showDashboard();
}
window.addEventListener("hashchange", async () => { await saveNow(); route(); });

initAuth(async u => {
  user = u;
  $("config-warning").classList.toggle("hidden", configured);
  $("auth-view").classList.toggle("hidden", !!u);
  $("app-view").classList.toggle("hidden", !u);
  updateNet();
  if (u) { await loadProfile(); await loadInstitutions(); showIosHint(); route(); }
  else { state = null; docId = null; profile = { role: "monitor" }; dashView = "mine"; dashDept = "hr"; allRolls = null; rollStaff = null; evidence = null; main.innerHTML = ""; }
});

/* ---------- dashboard ---------- */
async function showDashboard() {
  await saveNow();
  state = null; docId = null; readOnly = false;
  main.innerHTML = '<p class="muted pad">Loading…</p>';
  if (isEdtechRole()) dashDept = "edtech";
  const all = canSeeAll() && dashView === "all";
  try {
    const q = all
      ? (isEdtechRole() ? query(collection(db, "inspections"), where("department", "==", "edtech")) : collection(db, "inspections"))   // the rules only let the EdTech role read EdTech checks
      : query(collection(db, "inspections"), where("ownerId", "==", user.uid));
    const snap = await withCacheFallback(() => getDocs(q), () => getDocsFromCache(q));
    const everything = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const counts = { hr: 0, edtech: 0 };
    everything.forEach(i => counts[deptOf(i)]++);
    const dept = dashDept, et = dept === "edtech";
    const items = everything.filter(i => deptOf(i) === dept);

    const deptTabs = `<nav class="tabs dept-tabs" aria-label="Department">${deptsFor().map(([k, l]) =>
      `<button type="button" data-dtab="${k}" class="${k === dept ? "active" : ""}">${esc(l)}<span class="count">${counts[k]}</span></button>`).join("")}</nav>`;

    const toggle = canSeeAll() ? `<div class="seg inline">
        <button class="seg-btn ${all ? "" : "active"}" data-view="mine">My checks</button>
        <button class="seg-btn ${all ? "active" : ""}" data-view="all">All monitors</button></div>` : "";

    const toneOf = r => (r === null ? "none" : r >= 0.9 ? "good" : r >= 0.75 ? "warn" : "bad");

    const etIssues = e => Object.values(e.flags).reduce((a, b) => a + b, 0);
    const cardEt = i => {
      const own = i.ownerId === user.uid;
      const e = computeEdtech(i);
      const search = [i.institution?.name, i.institution?.code, i.institution?.location, i.ownerName].join(" ").toLowerCase();
      return `<article class="card tone-${toneOf(e.accountedRate)}" data-search="${esc(search)}">
        <div class="card-top">
          <div><h3>${esc(i.institution?.name || "Untitled check")}</h3>
            <p class="muted small">${esc([i.institution?.code ? "Code " + i.institution.code : "", i.institution?.location || "No district chosen"].filter(Boolean).join(" · "))}</p></div>
          <div class="rate"><b>${pct(e.accountedRate)}</b><span>accounted for</span></div>
        </div>
        <div class="chips">
          <span>${esc(i.institution?.date ? new Date(i.institution.date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No date")}</span>
          ${i.institution?.type ? `<span class="pill">${esc(i.institution.type)}</span>` : ""}
          ${all ? `<span>by ${esc(own ? "you" : (i.ownerName || "unknown"))}</span>` : ""}
        </div>
        <div class="mini">
          <div><b>${e.totalRecorded}</b>devices recorded</div>
          <div><b>${e.totalAllocated}</b>allocated</div>
          <div><b>${etIssues(e)}</b>to follow up</div>
        </div>
        <div class="row-actions">
          <a class="btn small primary" href="#/i/${i.id}">${own ? "Open" : "View"}</a>
          ${own ? `<button class="btn small danger" data-action="delete" data-id="${i.id}">Delete</button>` : ""}
        </div></article>`;
    };

    const card = i => {
      if (et) return cardEt(i);
      const own = i.ownerId === user.uid;
      const sum = computeSummary(i);
      const search = [i.institution?.name, i.institution?.code, i.institution?.location, i.ownerName].join(" ").toLowerCase();
      return `<article class="card tone-${toneOf(sum.attendanceRate)}" data-search="${esc(search)}">
        <div class="card-top">
          <div><h3>${esc(i.institution?.name || "Untitled check")}</h3>
            <p class="muted small">${esc([i.institution?.code ? "Code " + i.institution.code : "", i.institution?.location || "No district chosen"].filter(Boolean).join(" · "))}</p></div>
          <div class="rate"><b>${pct(sum.attendanceRate)}</b><span>attendance</span></div>
        </div>
        <div class="chips">
          <span>${esc(i.institution?.date ? new Date(i.institution.date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No date")}</span>
          ${i.institution?.type ? `<span class="pill">${esc(i.institution.type)}</span>` : ""}
          ${all ? `<span>by ${esc(own ? "you" : (i.ownerName || "unknown"))}</span>` : ""}
        </div>
        <div class="mini">
          <div><b>${sum.listed}${Number(i.institution?.roll) > 0 ? `<small>/${esc(i.institution.roll)}</small>` : ""}</b>staff listed${Number(i.institution?.roll) > 0 ? " of roll" : ""}</div>
          <div><b>${sum.late}</b>late</div>
          <div><b>${sum.absent}</b>absent</div>
        </div>
        <div class="row-actions">
          <a class="btn small primary" href="#/i/${i.id}">${own ? "Open" : "View"}</a>
          ${own ? `<button class="btn small danger" data-action="delete" data-id="${i.id}">Delete</button>` : ""}
        </div></article>`;
    };

    const hr = new Date().getHours();
    const greeting = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const first = (user.displayName || user.email || "").split(/[\s@]/)[0];
    const rates = items.map(i => (et ? computeEdtech(i).accountedRate : computeSummary(i).attendanceRate)).filter(r => r !== null);
    const avg = rates.length ? rates.reduce((x, y) => x + y, 0) / rates.length : null;
    const places = new Set(items.map(i => i.institution?.name).filter(Boolean)).size;
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const lede = items.length
      ? `${plural(items.length, "check")} ${all ? "from all monitors" : "recorded"} across ${plural(places, "institution")}.${avg !== null ? (et ? ` On average ${pct(avg)} of equipment is accounted for.` : ` Average attendance ${pct(avg)}.`) : ""}`
      : `Record your first ${deptName(dept)} check to see results here.`;

    main.innerHTML = `
      <div class="page-head">
        <div><h2>${esc(greeting)}${first ? ", " + esc(first) : ""}</h2><p class="muted">${esc(lede)}</p></div>
        <div class="head-actions">${toggle}<button class="btn primary" data-action="new" data-dept="${dept}">+ New ${et ? "EdTech " : ""}check</button></div>
      </div>
      ${deptTabs}
      ${all ? `<input id="filter" class="filter" type="search" placeholder="Filter by institution, district or monitor…">` : ""}
      ${items.length ? `<div class="cards" id="cards">${items.map(card).join("")}</div>`
        : `<div class="empty"><h3>No ${esc(deptName(dept))} checks yet</h3><p class="muted">${et ? "Start a check when you arrive at an institution to verify its technology tools and who holds them. It saves as you type." : "Start a check when you arrive at an institution. It saves as you type."}</p>
           <button class="btn primary" data-action="new" data-dept="${dept}">+ Start your first check</button></div>`}`;
  } catch (err) {
    console.error(err);
    main.innerHTML = `<p class="error pad">Could not load checks: ${esc(err.code || err.message)}.<br>
      Check that Firestore is created and the security rules are published (see README).</p>`;
  }
}

async function createInspection(dept = "hr") {
  if (isEdtechRole()) dept = "edtech";
  try {
    const ref = doc(collection(db, "inspections"));   // id is generated locally, so this also works offline
    const write = setDoc(ref, newInspection(dept));
    if (navigator.onLine) await settle(write); else write.catch(console.error);
    location.hash = `#/i/${ref.id}`;
  } catch (err) { toast("Could not create check: " + (err.code || err.message)); }
}

async function deleteInspection(id) {
  if (!(await askConfirm("Delete this check?", "This permanently removes the check and all its data, including evidence files. It cannot be undone."))) return;
  try {
    // evidence files live in a sub-collection, which Firestore does not delete with the parent
    try {
      const q = collection(db, "inspections", id, "evidence");
      const evs = await withCacheFallback(() => getDocs(q), () => getDocsFromCache(q), 5000);
      evs.docs.forEach(d => deleteDoc(d.ref).catch(console.error));
    } catch (e) { console.warn("Could not clear evidence files", e); }
    const del = deleteDoc(doc(db, "inspections", id));
    if (navigator.onLine) await settle(del); else del.catch(console.error);
    toast("Deleted"); showDashboard();
  } catch (err) { toast("Could not delete: " + (err.code || err.message)); }
}

/* ---------- editor ---------- */
async function openEditor(id) {
  await saveNow();
  main.innerHTML = '<p class="muted pad">Loading…</p>';
  try {
    const ref = doc(db, "inspections", id);
    const snap = await withCacheFallback(() => getDoc(ref), () => getDocFromCache(ref));
    const data = snap.exists() ? snap.data() : null;
    if (!data || (data.ownerId !== user.uid && !canSeeDept(deptOf(data)))) {
      main.innerHTML = '<p class="pad">Check not found. <a href="#/">Back to list</a></p>'; return;
    }
    docId = id; state = normalise(data); dashDept = state.department; dirty = false; tab = "institution"; rollStaff = null; rollInfo = null; evidence = null; evidenceError = ""; lastRollTotal = null;
    readOnly = data.ownerId !== user.uid;   // leads and HR can view other monitors' checks but not edit them (HR can still add evidence)
    // A check recorded before institute codes existed picks up its institution's listed code the first time its owner opens it
    if (!readOnly && !filled(state.institution.code) && codeFor(state.institution.name)) { state.institution.code = codeFor(state.institution.name); scheduleSave(); }
    renderEditor();
    refreshRoll();
  } catch (err) {
    main.innerHTML = `<p class="error pad">Could not open check: ${esc(err.code || err.message)} <a href="#/">Back</a></p>`;
  }
}

const filled = v => String(v ?? "").trim() !== "";
function tabDone(k) {
  if (!state) return false;
  const common = {
    institution: () => filled(state.institution.name) && filled(state.institution.date),
    findings: () => state.findings.some(r => filled(r.finding)),
    evidence: () => (evidence || []).length > 0,
    summary: () => false
  };
  if (isEt()) return (({
    ...common,
    tools: () => state.tools.some(r => filled(r.quantity)),
    allocation: () => state.allocation.some(r => filled(r.staff))
  })[k] || (() => false))();
  return ({
    institution: () => filled(state.institution.name) && filled(state.institution.date),
    attendance: () => state.attendance.some(r => filled(r.name)),
    movement: () => state.movement.some(r => filled(r.name)),
    leave: () => state.leave.some(r => filled(r.name)),
    records: () => state.records.some(r => filled(r.response)),
    findings: () => state.findings.some(r => filled(r.finding)),
    roll: () => !!rollStaff && crossCheck(state.attendance, rollStaff).matched > 0,
    evidence: () => (evidence || []).length > 0,
    summary: () => false
  })[k]();
}
function updateTabDots() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("done", tabDone(b.dataset.tab)));
}

function renderEditor() {
  main.innerHTML = `
    <div class="editor-head">
      <a href="${homeHash(state.department)}" class="btn small">← All checks</a>
      <h2 id="title">${esc(state.institution.name || "Untitled check")}</h2>
      <span class="pill dept-pill">${esc(deptName(state.department))}</span>
      <span class="pill code-pill${state.institution.code ? "" : " hidden"}" id="code-pill">Institute code ${esc(state.institution.code || "")}</span>
      <span id="save-status" class="muted small">${readOnly ? "" : "All changes saved"}</span>
      <button class="btn small" data-action="export">Export Excel</button>
    </div>
    ${readOnly ? `<p class="banner-ro">Read-only view of a check recorded by <b>${esc(state.ownerName || "another monitor")}</b>.${canEvidenceAny() ? ` As ${isHr() ? "HR" : "the EdTech team"} you can add evidence of the visit on the Evidence tab.` : ""}</p>` : ""}
    <nav class="tabs" id="tabs">${tabsFor(state.department).map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}${tabDone(k) ? " done" : ""}">${k === "summary" ? "" : '<i class="dot"></i>'}${l}</button>`).join("")}</nav>
    <div id="tab-body" class="panel"></div>`;
  renderTab();
}

function renderTab() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const body = $("tab-body");
  const views = isEt()
    ? { institution: tInstitution, tools: tTools, allocation: tAllocation, findings: tFindings, summary: tSummaryEt, evidence: tEvidence }
    : { institution: tInstitution, attendance: tAttendance, movement: tMovement, leave: tLeave, records: tRecords, findings: tFindings, summary: tSummary, roll: tRoll, evidence: tEvidence };
  if (!views[tab]) tab = "institution";
  body.innerHTML = views[tab]();
  // On phones each table row becomes a card; the CSS shows each field's column heading above it (see "stackable" in style.css)
  body.querySelectorAll("table.stackable").forEach(t => {
    const heads = [...t.querySelectorAll("thead th")].map(th => th.textContent.trim());
    t.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => {
      if (heads[i]) td.dataset.label = heads[i];
      // short fields (dropdowns, times, dates, numbers) sit two to a line; long ones (names, remarks...) take the full width
      const short = td.querySelector('select:not([data-path$=".status"]), input[type=time], input[type=date], input[type=number], [data-path$=".grade"], [data-path$=".dept"]');
      td.classList.toggle("wide", !short);
    }));
    t.closest(".scroll")?.classList.add("stack");
  });
  if (readOnly) body.querySelectorAll("input, select, textarea, button").forEach(el => {
    if (!el.dataset.action && !el.closest("[data-keep]")) el.disabled = true;   // keep Print working, and the Evidence panel (HR can add evidence)
  });
}

// A code that is in the shared list is shown but cannot be changed on the check; HR and team leads can change it.
const codeLocked = i => !!codeFor(i.name) && !canEditCodeList();
const codeNote = i => (!filled(i.name) ? "Choose the institution first."
  : codeFor(i.name) ? (canEditCodeList() ? "From the institute code list. Changes here update the list for everyone." : "From the institute code list.")
  : canEditCodeList() ? "Not in the institute code list yet. What you type here is saved to the list." : "Not in the institute code list yet. Ask HR to add it.");
// After the institution changes: fill in its listed code, and refresh the field, the note and the header badge
function syncSchoolCode() {
  const i = state.institution;
  if (!readOnly) i.code = codeFor(i.name);
  const box = $("school-code");
  if (box) { box.value = i.code; box.readOnly = readOnly || codeLocked(i); }
  const note = $("school-code-note"); if (note) note.textContent = codeNote(i);
  const pill = $("code-pill"); if (pill) { pill.textContent = "Institute code " + (i.code || ""); pill.classList.toggle("hidden", !i.code); }
}
let codeTimer = null;

function tInstitution() {
  const i = state.institution;
  const f = (label, key, type = "text", extra = "") => `<label>${label}${inp("institution." + key, i[key], type, extra)}</label>`;
  const listed = (list, val, placeholder) =>
    `<option value="">${placeholder}</option>` + list.map(o => `<option${o === val ? " selected" : ""}>${esc(o)}</option>`).join("") +
    (val && !list.includes(val) ? `<option value="${esc(val)}" selected>${esc(val)} (not in list)</option>` : "");
  const cats = i.categories || [];
  const et = isEt();
  return `
  <section class="section">
    <h3>Institution <small>Where the check took place</small></h3>
    <div class="grid">
      <div class="field">
        <span>Name of institution</span>
        <div class="inline">
          <select data-path="institution.name">${listed(institutions, i.name, "Select institution…")}</select>
          <button type="button" class="btn small" data-inst="add" title="Add an institution to the list">+ Add</button>
          <button type="button" class="btn small danger" data-inst="del" title="Remove the selected institution from the list">Delete</button>
        </div>
      </div>
      <div class="field">
        <label for="school-code">Institute code</label>
        <input id="school-code" type="text" data-path="institution.code" value="${esc(i.code)}" placeholder="e.g. 0701234" autocomplete="off"${codeLocked(i) ? " readonly" : ""}>
        <small class="muted" id="school-code-note">${esc(codeNote(i))}</small>
      </div>
      <label>Location / district<select data-path="institution.location">${listed(DISTRICTS, i.location, "Select district…")}</select></label>
      ${f("Head of institution", "head")}
    </div>
  </section>
  <section class="section">
    <h3>The visit <small>Date, team and timing</small></h3>
    <div class="grid">
      ${f("Date of check", "date", "date")}
      <label>Type of check<select data-path="institution.type">${opts(CHECK_TYPES, i.type)}</select></label>
      ${f("Monitoring team members", "team")}
      ${f("Time team arrived", "arrived", "time")}
      ${f("Time team departed", "departed", "time")}
      ${et ? "" : f("Official start time of work", "startTime", "time")}
    </div>
  </section>
  ${et ? "" : `<section class="section">
    <h3>Staff <small>Who the check covers</small></h3>
    <div class="grid">
      ${f("Total staff in the institute", "roll", "number", 'inputmode="numeric" min="0"')}
      <div class="field">
        <span>Total staff on HR nominal roll</span>
        <div class="inline roll-total-box">
          <b id="roll-total" class="roll-total">${rollStaff ? rollStaff.length : "—"}</b>
          <button type="button" class="btn small" data-roll="use" title="Copy the HR total into the box beside it">Use this number</button>
        </div>
        <small id="roll-note" class="muted">${esc(rollNote())}</small>
      </div>
      <div class="field">
        <span>Staff categories covered</span>
        <details class="multi">
          <summary id="cats-summary">${esc(cats.length ? cats.join(", ") : "Select categories…")}</summary>
          <div class="multi-list">${STAFF_CATEGORIES.map(c => `<label class="check">
            <input type="checkbox" data-multi="institution.categories" value="${esc(c)}"${cats.includes(c) ? " checked" : ""}> ${esc(c)}</label>`).join("")}</div>
        </details>
      </div>
    </div>
  </section>`}`;
}

function tAttendance() {
  const rows = state.attendance.map((r, n) => `<tr data-row="${n}">
    <td class="num">${n + 1}</td>
    <td>${inp(`attendance.${n}.name`, r.name, "text", 'list="roll-names" autocomplete="off"')}</td>
    <td class="roll-cell" data-rb="${n}">${rollBadge(r.name)}</td>
    <td>${sel(`attendance.${n}.level`, LEVELS, r.level)}</td>
    <td>${inp(`attendance.${n}.grade`, r.grade)}</td>
    <td>${inp(`attendance.${n}.dept`, r.dept)}</td>
    <td>${sel(`attendance.${n}.signed`, YN, r.signed)}</td>
    <td>${inp(`attendance.${n}.arrival`, r.arrival, "time")}</td>
    <td>${sel(`attendance.${n}.present`, YN, r.present)}</td>
    <td>${sel(`attendance.${n}.status`, STATUSES, r.status)}</td>
    <td>${inp(`attendance.${n}.remarks`, r.remarks)}</td>
    <td><button class="icon" title="Remove row" data-del="attendance.${n}">✕</button></td></tr>`).join("");
  return `<h3>Attendance and punctuality</h3>
    <p class="muted small">Entering an arrival time sets the status to <b>On time</b> or <b>Late</b> automatically using the official start time (you can still change it).</p>
    <div class="scroll"><table class="grid-table stackable"><thead><tr>
      <th>No.</th><th>Name of staff</th><th>On roll?</th><th>Level</th><th>Grade</th><th>Unit / Dept</th><th>Signed register?</th>
      <th>Arrival (hh:mm)</th><th>Physically present?</th><th>Status</th><th>Remarks</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <button class="btn" data-add="attendance">+ Add row (${state.attendance.length}/${LIMITS.attendance})</button>${rollDatalist()}`;
}

function tMovement() {
  const rows = state.movement.map((r, n) => `<tr>
    <td class="num">${n + 1}</td>
    <td>${inp(`movement.${n}.name`, r.name)}</td>
    <td>${sel(`movement.${n}.level`, LEVELS, r.level)}</td>
    <td>${inp(`movement.${n}.dept`, r.dept)}</td>
    <td>${inp(`movement.${n}.left`, r.left, "time")}</td>
    <td>${inp(`movement.${n}.reason`, r.reason)}</td>
    <td>${inp(`movement.${n}.destination`, r.destination)}</td>
    <td>${inp(`movement.${n}.authorisedBy`, r.authorisedBy)}</td>
    <td>${sel(`movement.${n}.entered`, YN, r.entered)}</td>
    <td>${inp(`movement.${n}.expectedReturn`, r.expectedReturn, "time")}</td>
    <td>${inp(`movement.${n}.remarks`, r.remarks)}</td>
    <td><button class="icon" title="Remove row" data-del="movement.${n}">✕</button></td></tr>`).join("");
  return `<h3>Staff movement log</h3>
    <div class="scroll"><table class="grid-table stackable"><thead><tr>
      <th>No.</th><th>Name of staff</th><th>Level</th><th>Department</th><th>Time left office</th><th>Reason given</th>
      <th>Destination</th><th>Authorised by</th><th>In movement book?</th><th>Expected return</th><th>Remarks</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <button class="btn" data-add="movement">+ Add row (${state.movement.length}/${LIMITS.movement})</button>`;
}

function recordsFooter() {
  const s = computeSummary(state);
  return `<tr><td></td><td>Items answered Yes</td><td>${s.recordsYes}</td><td></td></tr>
          <tr><td></td><td>Items answered No</td><td>${s.recordsNo}</td><td></td></tr>
          <tr class="total"><td></td><td>Compliance rate (Yes / (Yes + No), N/A excluded)</td><td>${pct(s.complianceRate)}</td><td></td></tr>`;
}

function tRecords() {
  const rows = CHECKLIST.map((item, n) => `<tr>
    <td class="num">${n + 1}</td><td>${esc(item)}</td>
    <td>${sel(`records.${n}.response`, ["Yes", "No", "N/A"], state.records[n].response)}</td>
    <td>${inp(`records.${n}.remarks`, state.records[n].remarks)}</td></tr>`).join("");
  return `<h3>Records verification checklist</h3>
    <p class="muted small">Pick Yes, No or N/A for each item and note evidence or gaps in Remarks.</p>
    <div class="scroll"><table class="grid-table stackable"><thead><tr><th>No.</th><th>Item to verify</th><th>Response</th><th>Remarks</th></tr></thead>
    <tbody>${rows}</tbody><tbody id="records-footer">${recordsFooter()}</tbody></table></div>`;
}

function tFindings() {
  const et = isEt();
  const rows = state.findings.map((r, n) => `<tr>
    <td class="num">${n + 1}</td>
    <td>${inp(`findings.${n}.finding`, r.finding)}</td>
    ${et ? "" : `<td><select data-path="findings.${n}.level">${opts([...LEVELS, "All levels"], r.level)}</select></td>`}
    <td>${inp(`findings.${n}.evidence`, r.evidence)}</td>
    <td>${inp(`findings.${n}.action`, r.action)}</td>
    <td>${inp(`findings.${n}.officer`, r.officer)}</td>
    <td>${inp(`findings.${n}.deadline`, r.deadline, "date")}</td>
    <td><button class="icon" title="Remove row" data-del="findings.${n}">✕</button></td></tr>`).join("");
  const areas = (et ? EDTECH_AREAS : AREAS).map(([k, l]) => `<tr><td>${l}</td>
    <td>${sel(`assessment.${k}.rating`, RATINGS, state.assessment[k].rating)}</td>
    <td>${inp(`assessment.${k}.comment`, state.assessment[k].comment)}</td></tr>`).join("");
  const sign = ROLES.map(([k, l]) => `<tr><td>${l}</td>
    <td>${inp(`signoff.${k}.name`, state.signoff[k].name)}</td>
    <td>${inp(`signoff.${k}.signature`, state.signoff[k].signature)}</td>
    <td>${inp(`signoff.${k}.date`, state.signoff[k].date, "date")}</td></tr>`).join("");
  return `<h3>Findings and recommendations</h3>
    <p class="muted small">Complete at the exit meeting and share a copy with the head of institution.</p>
    <div class="scroll"><table class="grid-table stackable"><thead><tr><th>No.</th><th>Finding</th>${et ? "" : "<th>Staff level affected</th>"}<th>Evidence</th><th>Recommended action</th><th>Responsible officer</th><th>Deadline</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <button class="btn" data-add="findings">+ Add finding (${state.findings.length}/${LIMITS.findings})</button>
    <h3>Overall assessment</h3>
    <div class="scroll"><table class="grid-table stackable"><thead><tr><th>Area</th><th>Rating</th><th>Comment</th></tr></thead><tbody>${areas}</tbody></table></div>
    <h3>Sign-off</h3>
    <div class="scroll"><table class="grid-table stackable"><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody>${sign}</tbody></table></div>`;
}

function tSummary() {
  const s = computeSummary(state), i = state.institution, lv2 = computeLeave(state, asOfDay());
  const toneOf = r => (r === null ? "none" : r >= 0.9 ? "good" : r >= 0.75 ? "warn" : "bad");
  const r = (l, v) => `<tr><td>${l}</td><td class="val">${esc(v)}</td></tr>`;

  const kpi = (label, rate, sub) => `<div class="kpi tone-${toneOf(rate)}">
    <div class="ring-wrap"><div class="ring" style="--p:${rate === null ? 0 : Math.round(rate * 1000) / 10}"></div><span>${pct(rate)}</span></div>
    <div><b>${label}</b><p class="muted small">${sub}</p></div></div>`;

  const segs = [["On time", s.onTime, "good"], ["Late", s.late, "warn"], ["Absent without approval", s.absent, "bad"], ["Absent with approval", s.approved, "info"], ["Status not marked", s.unmarked, "none"]];
  const bar = s.listed
    ? segs.filter(x => x[1]).map(([l, n, t]) => `<i class="fill-${t}" style="flex:${n}" title="${l}: ${n}"></i>`).join("")
    : '<i class="fill-none" style="flex:1"></i>';

  const flag = (n, label) => `<div class="flag${n > 0 ? " raised" : ""}"><b>${n}</b><span>${label}</span></div>`;

  const levelRows = [...s.byLevel, ...(s.noLevel.listed ? [s.noLevel] : [])];
  const lv = levelRows.map(x => `<tr><td>${x.level}</td><td>${x.listed}</td><td>${x.present}</td><td>${x.late}</td><td>${x.absent}</td>
    <td><div class="cellbar"><div class="bar"><i class="fill-${toneOf(x.rate)}" style="flex:${x.rate === null ? 0 : x.rate}"></i><i style="flex:${x.rate === null ? 1 : 1 - x.rate};background:transparent;min-width:0"></i></div><span>${pct(x.rate)}</span></div></td></tr>`).join("");

  const when = i.date ? new Date(i.date + "T00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "No date set";

  return `<div class="sum-head">
      <div><h3>${esc(i.name || "Untitled check")}</h3>
        <p class="muted">${esc([i.location, when, i.type].filter(Boolean).join(", "))}</p></div>
      <button class="btn small" data-action="print">Print summary</button>
    </div>

    <div class="kpis">
      ${kpi("Attendance rate", s.attendanceRate, `${s.onTime + s.late} of ${s.listed} listed staff were present`)}
      ${kpi("Punctuality rate", s.punctualityRate, `${s.onTime} of ${s.onTime + s.late} present staff were on time`)}
      ${kpi("Records compliance", s.complianceRate, `${s.recordsYes} Yes, ${s.recordsNo} No on the checklist`)}
    </div>

    <div class="dist">
      <h4>How the ${s.listed} listed staff were recorded</h4>
      <div class="bar">${bar}</div>
      <ul class="legend">${segs.map(([l, n, t]) => `<li><i class="fill-${t}"></i>${l} <b>${n}</b></li>`).join("")}</ul>
    </div>

    <h4 style="margin-bottom:10px">Needs attention</h4>
    <div class="flags">
      ${flag(s.signedNotPresent, "Signed the register but were not present")}
      ${flag(s.notInBook, "Out of office, not in the movement book")}
      ${flag(s.absent, "Absent without approval")}
      ${flag(s.unmarked, "Listed staff with no attendance status chosen")}
      ${flag(lv2.signedWhileOnLeave, "On leave but signed or present on the attendance sheet")}
      ${rollFlags(flag)}
    </div>

    <div class="two-col">
      <table class="grid-table"><tbody>
        <tr class="sec"><td colspan="2">Institution</td></tr>
        ${r("Institute code", i.code || "—")}${rollSummaryRows(r, i)}
        ${r("Staff categories covered", (i.categories || []).join(", ") || "—")}
        <tr class="sec"><td colspan="2">Attendance</td></tr>
        ${r("Staff listed on attendance sheet", s.listed)}${r("Present on time", s.onTime)}${r("Present but late", s.late)}
        ${r("Absent with approval (leave or on duty elsewhere)", s.approved)}${r("Absent without approval", s.absent)}
        <tr class="sec"><td colspan="2">Staff movement</td></tr>
        ${r("Staff found out of office", s.movementListed)}${r("Not entered in movement book", s.notInBook)}
        <tr class="sec"><td colspan="2">Staff on leave</td></tr>
        ${r("Staff on leave recorded", lv2.count)}${r("On leave on the day of the check", lv2.ongoing)}${r("Total leave days", lv2.totalDays)}
        ${r("Average length of leave (days)", lv2.avgDays === null ? "—" : (Math.round(lv2.avgDays * 10) / 10))}${r("Longest leave (days)", lv2.longest || "—")}
      </tbody></table>
      <div><h4 style="margin-bottom:10px">By staff level</h4>
      <div class="scroll" style="max-height:none;margin-top:0"><table class="grid-table"><thead><tr><th>Level</th><th>Listed</th><th>Present</th><th>Late</th><th>Absent</th><th>Attendance rate</th></tr></thead><tbody>${lv}</tbody>
        <tfoot><tr class="total"><td>All staff listed</td><td>${s.listed}</td><td>${s.onTime + s.late}</td><td>${s.late}</td><td>${s.absent}</td><td>${pct(s.attendanceRate)}</td></tr></tfoot></table></div>
      <p class="muted small">Present means On time or Late. Absent means without approval. The last row before the total, if shown, holds staff whose Level has not been selected.</p></div>
    </div>`;
}

/* ---------- profile: my photo, details and activity ---------- */
async function showProfilePage() {
  await saveNow();
  state = null; docId = null; readOnly = false;
  main.innerHTML = '<p class="muted pad">Loading…</p>';
  let mine = [];
  try { const snap = await getDocs(query(collection(db, "inspections"), where("ownerId", "==", user.uid))); mine = snap.docs.map(d => d.data()); }
  catch (err) { console.warn("Could not count the checks", err); }
  const hr = mine.filter(i => deptOf(i) === "hr").length, et = mine.filter(i => deptOf(i) === "edtech").length;
  const last = mine.reduce((m, i) => Math.max(m, i.updatedAt || 0), 0);
  const who = user.displayName || user.email || "";
  const row = (l, v) => `<tr><td>${l}</td><td class="val">${esc(v)}</td></tr>`;
  main.innerHTML = `
    <div class="page-head">
      <div><h2>My profile</h2><p class="muted">Your photo and details. Your photo is shown in the top bar on your devices.</p></div>
      <div class="head-actions"><a class="btn" href="${homeHash(isEdtechRole() ? "edtech" : "hr")}">← All checks</a></div>
    </div>
    <div class="panel profile-card">
      <span class="avatar xl" id="profile-avatar" aria-hidden="true"></span>
      <div>
        <h3>${esc(who || "Your account")}</h3>
        <p class="muted">${esc(ROLE_LABELS[profile.role] || "Monitor")}${user.email && user.email !== who ? " · " + esc(user.email) : ""}</p>
        <div class="actions">
          <button type="button" class="btn primary" data-action="photo-pick">${profile.photo ? "Change photo" : "Upload photo"}</button>
          ${profile.photo ? '<button type="button" class="btn danger" data-action="photo-remove">Remove photo</button>' : ""}
          <input id="photo-file" type="file" accept="image/*" hidden>
        </div>
        <p class="muted small" id="photo-note">A clear, front-facing photo works best. It is cropped to a square and shrunk automatically.</p>
      </div>
    </div>
    <div class="two-col">
      <div class="panel"><h3>My details</h3>
        <table class="grid-table"><tbody>
          ${row("Name", who || "—")}${row("Email", user.email || "—")}${row("Role", ROLE_LABELS[profile.role] || "Monitor")}
        </tbody></table></div>
      <div class="panel"><h3>My activity</h3>
        <table class="grid-table"><tbody>
          ${row("Human Resource checks recorded", hr)}${row("EdTech checks recorded", et)}
          ${row("Last updated", last ? fmtDay(last) : "—")}
        </tbody></table></div>
    </div>`;
  renderAvatar();
}

async function uploadPhoto(file) {
  const note = $("photo-note");
  try {
    if (note) note.textContent = "Preparing your photo…";
    const data = await prepareAvatar(file);
    const write = updateDoc(doc(db, "users", user.uid), { photo: data, photoUpdatedAt: Date.now() });
    if (navigator.onLine) await settle(write); else write.catch(console.error);
    profile.photo = data;
    toast("Photo saved");
    showProfilePage();
  } catch (err) {
    console.error(err);
    if (note) note.textContent = "Could not save the photo: " + (err.message || err.code);
    toast("Could not save the photo");
  }
}

async function removePhoto() {
  if (!(await askConfirm("Remove your photo?", "Your initials will be shown instead.", "Remove"))) return;
  try {
    const write = updateDoc(doc(db, "users", user.uid), { photo: "", photoUpdatedAt: Date.now() });
    if (navigator.onLine) await settle(write); else write.catch(console.error);
    profile.photo = "";
    toast("Photo removed");
    showProfilePage();
  } catch (err) { toast("Could not remove the photo: " + (err.code || err.message)); }
}

/* ---------- Leave: staff on leave and how long it lasts (Human Resource) ---------- */
const todayIso = () => new Date().toISOString().slice(0, 10);
const asOfDay = () => state.institution.date || todayIso();
const fmtIsoDay = v => (v ? new Date(v + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

function leaveCells(r) {
  const days = leaveDays(r.start, r.end), st = leaveStatus(r, asOfDay());
  const dur = days === null ? (filled(r.start) && filled(r.end) ? '<span class="roll-badge no" title="The end date is before the start date">Check dates</span>' : "") : `<b>${days}</b> ${days === 1 ? "day" : "days"}`;
  const badge = { ongoing: ["warn", "On leave"], upcoming: ["info", "Starts later"], ended: ["ok", "Back at work"] }[st];
  const back = st && st !== "ended" ? `<small class="muted">back ${esc(fmtIsoDay(leaveResumes(r.end)))}</small>` : "";
  return { dur, status: badge ? `<span class="roll-badge ${badge[0]}">${badge[1]}</span> ${back}` : "" };
}

function leaveFlags() {
  const l = computeLeave(state, asOfDay());
  return `<div class="flag neutral"><b>${l.count}</b><span>Staff on leave recorded</span></div>
    <div class="flag neutral"><b>${l.ongoing}</b><span>On leave on the day of the check</span></div>
    <div class="flag neutral"><b>${l.totalDays}</b><span>Leave days in total (longest ${l.longest})</span></div>
    ${etFlag(l.signedWhileOnLeave, "On leave but signed or present on the attendance sheet")}
    ${etFlag(l.badDates, "Rows with a missing or wrong date")}`;
}

function leaveRollHint() {
  if (!rollStaff || readOnly) return "";
  const listed = new Set(state.leave.filter(r => filled(r.name)).map(r => r.name.trim().toLowerCase()));
  const onRollLeave = rollStaff.filter(x => x.post === "On leave" && !listed.has(String(x.name).trim().toLowerCase()));
  return onRollLeave.length
    ? `<p class="banner-ro">The HR nominal roll marks <b>${onRollLeave.length}</b> ${onRollLeave.length === 1 ? "staff member" : "staff"} at this institution as on leave who ${onRollLeave.length === 1 ? "is" : "are"} not listed below. <button class="link" type="button" data-action="leave-from-roll">Add ${onRollLeave.length === 1 ? "them" : "them all"}</button></p>`
    : "";
}

function tLeave() {
  const rows = state.leave.map((r, n) => { const c = leaveCells(r); return `<tr>
    <td class="num">${n + 1}</td>
    <td>${inp(`leave.${n}.name`, r.name, "text", 'list="roll-names" autocomplete="off"')}</td>
    <td class="roll-cell" data-rb="${n}">${rollBadge(r.name)}</td>
    <td>${sel(`leave.${n}.type`, LEAVE_TYPES, r.type)}</td>
    <td>${inp(`leave.${n}.start`, r.start, "date")}</td>
    <td>${inp(`leave.${n}.end`, r.end, "date")}</td>
    <td class="chk-cell" data-ld="${n}">${c.dur}</td>
    <td class="chk-cell" data-ls="${n}">${c.status}</td>
    <td>${inp(`leave.${n}.remarks`, r.remarks)}</td>
    <td><button class="icon" title="Remove row" data-del="leave.${n}">✕</button></td></tr>`; }).join("");
  return `<h3>Staff on leave</h3>
    <p class="muted small">Record each staff member on leave, the type of leave, and the first and last day of it. The number of days and whether the person is on leave on the day of the check are worked out for you.</p>
    <div id="leave-hint">${leaveRollHint()}</div>
    <div class="scroll"><table class="grid-table stackable"><thead><tr>
      <th>No.</th><th>Name of staff</th><th>On roll?</th><th>Type of leave</th><th>Leave starts</th><th>Leave ends (last day)</th><th>Duration</th><th>Status</th><th>Remarks</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <button class="btn" data-add="leave">+ Add row (${state.leave.length}/${LIMITS.leave})</button>
    <div class="flags" id="leave-flags" style="margin-top:18px">${leaveFlags()}</div>${rollDatalist()}`;
}

/* ---------- EdTech department: technology tools, staff allocation, summary ---------- */
const NUM = 'inputmode="numeric" min="0" step="1"';
const etFlag = (n, label) => `<div class="flag${n > 0 ? " raised" : ""}"><b>${n}</b><span>${label}</span></div>`;
const numOf = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// Per-row check on the tools sheet: Distributed + Stores should add up to Quantities
function toolCheck(r) {
  if (!filled(r.quantity) || !(filled(r.distributed) || filled(r.stores))) return "";
  const gap = numOf(r.quantity) - numOf(r.distributed) - numOf(r.stores);
  if (gap === 0) return '<span class="roll-badge ok" title="Distributed + Stores equals Quantities">Adds up</span>';
  return gap > 0
    ? `<span class="roll-badge warn" title="Distributed + Stores is less than Quantities">${gap} not accounted for</span>`
    : `<span class="roll-badge no" title="Distributed + Stores is more than Quantities">${-gap} more than recorded</span>`;
}

function toolsFlags() {
  const e = computeEdtech(state);
  return `<div class="flag neutral"><b>${e.totalRecorded}</b><span>Desktops, laptops and tablets recorded</span></div>
    ${etFlag(e.flags.notReconciled, "Lines where Distributed + Stores do not add up to Quantities")}
    ${etFlag(e.flags.badTools, "Lines in poor, faulty or missing condition")}`;
}

function tTools() {
  const rows = state.tools.map((r, n) => `<tr>
    <td>${n < FIXED_TOOLS.length ? `<b>${esc(r.item)}</b>` : inp(`tools.${n}.item`, r.item, "text", 'placeholder="Others: name the item, e.g. Projector"')}</td>
    <td>${inp(`tools.${n}.quantity`, r.quantity, "number", NUM)}</td>
    <td>${inp(`tools.${n}.distributed`, r.distributed, "number", NUM)}</td>
    <td>${inp(`tools.${n}.stores`, r.stores, "number", NUM)}</td>
    <td>${sel(`tools.${n}.condition`, CONDITIONS, r.condition)}</td>
    <td class="chk-cell" data-tc="${n}">${toolCheck(r)}</td>
    <td>${inp(`tools.${n}.remarks`, r.remarks)}</td>
    <td>${n < FIXED_TOOLS.length ? "" : `<button class="icon" title="Remove row" data-del="tools.${n}">✕</button>`}</td></tr>`).join("");
  return `<h3>Institute technology tools</h3>
    <p class="muted small"><b>Quantities</b> is what the records show. <b>Distributed</b> (in use by staff or classes) and <b>Stores</b> (kept in the store) should add up to it. Use Add row for any other item.</p>
    <div class="scroll"><table class="grid-table stackable"><thead><tr>
      <th>Items to verify</th><th>Quantities</th><th>Distributed</th><th>Stores</th><th>Condition</th><th>Check</th><th>Remarks</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <button class="btn" data-add="tools">+ Add row (${state.tools.length}/${LIMITS.tools})</button>
    <div class="flags" id="tools-flags" style="margin-top:18px">${toolsFlags()}</div>`;
}

function allocFooter() {
  const e = computeEdtech(state);
  const flagOf = x => (x.overAllocated ? '<span class="roll-badge no">More than recorded</span>' : x.allocMismatch ? `<span class="roll-badge warn">Distributed is ${x.distributed}</span>` : "");
  const rows = e.byType.map(x => `<tr><td>${esc(x.type)}</td><td class="val">${x.qEntered ? x.quantity : "—"}</td><td class="val">${x.allocated}</td>
    <td class="val">${x.qEntered ? x.unallocated : "—"}</td>
    <td>${x.type === "Others" ? "" : flagOf(x)}</td></tr>` + (x.type !== "Others" ? "" : e.othersItems.map(it => `<tr class="sub"><td>&nbsp;&nbsp;– ${esc(it.name || "Item not named")}</td><td class="val">${it.qEntered ? it.quantity : "—"}</td><td class="val">${it.allocated}</td>
    <td class="val">${it.qEntered ? Math.max(it.quantity - it.allocated, 0) : "—"}</td><td>${flagOf(it)}</td></tr>`).join(""))).join("");
  return `<h4 style="margin:22px 0 10px">Allocated so far</h4>
    <div class="scroll" style="max-height:none;margin-top:0"><table class="grid-table"><thead><tr><th>Type of item</th><th>Recorded</th><th>Allocated to staff</th><th>Not yet allocated</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function tAllocation() {
  const rows = state.allocation.map((r, n) => `<tr>
    <td class="num">${n + 1}</td>
    <td>${sel(`allocation.${n}.type`, ITEM_TYPES, r.type)}
      <input type="text" class="other-name${r.type === "Others" ? "" : " hidden"}" data-path="allocation.${n}.other" value="${esc(r.other)}" list="other-items" placeholder="Name the item, e.g. Projector" aria-label="Name of the other item" autocomplete="off"></td>
    <td>${inp(`allocation.${n}.staff`, r.staff, "text", 'list="roll-names" autocomplete="off"')}</td>
    <td class="roll-cell" data-rb="${n}">${rollBadge(r.staff)}</td>
    <td>${inp(`allocation.${n}.dept`, r.dept)}</td>
    <td>${inp(`allocation.${n}.quantity`, r.quantity, "number", NUM)}</td>
    <td>${sel(`allocation.${n}.condition`, CONDITIONS, r.condition)}</td>
    <td>${inp(`allocation.${n}.remarks`, r.remarks)}</td>
    <td><button class="icon" title="Remove row" data-del="allocation.${n}">✕</button></td></tr>`).join("");
  return `<h3>Staff allocation</h3>
    <p class="muted small">One row for each staff member holding equipment. When you choose <b>Others</b>, type the name of the item (for example Projector); names you listed on the Technology tools tab are suggested. ${rollStaff ? "Staff names are suggested from the HR nominal roll." : ""}</p>
    <div class="scroll"><table class="grid-table stackable"><thead><tr>
      <th>No.</th><th>Type of item</th><th>Staff name</th><th>On roll?</th><th>Department</th><th>Quantities</th><th>Condition</th><th>Remarks</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <button class="btn" data-add="allocation">+ Add row (${state.allocation.length}/${LIMITS.allocation})</button>
    <div id="alloc-footer">${allocFooter()}</div>${rollDatalist()}
    <datalist id="other-items">${[...new Set(state.tools.slice(FIXED_TOOLS.length).map(t => String(t.item || "").trim()).filter(Boolean))].map(x => `<option value="${esc(x)}">`).join("")}</datalist>`;
}

function tSummaryEt() {
  const e = computeEdtech(state), i = state.institution;
  const toneOf = r => (r === null ? "none" : r >= 0.9 ? "good" : r >= 0.75 ? "warn" : "bad");
  const r = (l, v) => `<tr><td>${l}</td><td class="val">${esc(v)}</td></tr>`;
  const kpi = (label, rate, sub) => `<div class="kpi tone-${toneOf(rate)}">
    <div class="ring-wrap"><div class="ring" style="--p:${rate === null ? 0 : Math.round(Math.min(rate, 1) * 1000) / 10}"></div><span>${pct(rate)}</span></div>
    <div><b>${label}</b><p class="muted small">${sub}</p></div></div>`;

  const segs = [["Good", "good"], ["Fair", "info"], ["Poor", "warn"], ["Faulty", "bad"], ["Missing", "bad"]].map(([c, t]) => [c, e.conditionQty[c], t]);
  const bar = e.ratedQty
    ? segs.filter(x => x[1]).map(([l, n, t]) => `<i class="fill-${t}" style="flex:${n}" title="${l}: ${n}"></i>`).join("")
    : '<i class="fill-none" style="flex:1"></i>';

  const notOnRoll = rollStaff ? state.allocation.filter(a => filled(a.staff) && !matchStaff(a.staff, rollStaff)).length : null;
  const f = e.flags;
  const when = i.date ? new Date(i.date + "T00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "No date set";

  const itemRow = (name, x, sub) => `<tr${sub ? ' class="sub"' : ""}><td>${sub ? "&nbsp;&nbsp;– " : ""}${esc(name)}</td><td>${x.qEntered ? x.quantity : "—"}</td><td>${x.dEntered ? x.distributed : "—"}</td><td>${x.stores || "—"}</td><td>${x.allocated}</td>
    <td><div class="cellbar"><div class="bar"><i class="fill-${toneOf(x.allocationRate)}" style="flex:${x.allocationRate === null ? 0 : Math.min(x.allocationRate, 1)}"></i><i style="flex:${x.allocationRate === null ? 1 : Math.max(1 - x.allocationRate, 0)};background:transparent;min-width:0"></i></div><span>${pct(x.allocationRate)}</span></div></td></tr>`;
  const byItem = e.byType.map(x => itemRow(x.type, x) + (x.type === "Others" ? e.othersItems.map(it => itemRow(it.name || "Item not named", it, true)).join("") : "")).join("");

  return `<div class="sum-head">
      <div><h3>${esc(i.name || "Untitled check")}</h3>
        <p class="muted">${esc([i.location, when, i.type].filter(Boolean).join(", "))}</p></div>
      <button class="btn small" data-action="print">Print summary</button>
    </div>

    <div class="kpis">
      ${kpi("Accounted for", e.accountedRate, `${e.accountedQty} of ${e.qtyTotal} items are distributed or in stores`)}
      ${kpi("Allocated to staff", e.allocationRate, `${e.totalAllocated} of ${e.totalRecorded} desktops, laptops and tablets`)}
      ${kpi("In good condition", e.goodRate, `${e.goodQty} of ${e.ratedQty} items rated Good`)}
    </div>

    <div class="dist">
      <h4>Condition of the ${e.ratedQty} items rated</h4>
      <div class="bar">${bar}</div>
      <ul class="legend">${segs.map(([l, n, t]) => `<li><i class="fill-${t}"></i>${l} <b>${n}</b></li>`).join("")}</ul>
    </div>

    <h4 style="margin-bottom:10px">Needs attention</h4>
    <div class="flags">
      ${etFlag(f.notReconciled, "Lines where Distributed + Stores do not add up")}
      ${etFlag(f.overAllocated, "Item types allocated beyond the quantity recorded")}
      ${etFlag(f.allocMismatch, "Item types where Distributed differs from the staff list")}
      ${etFlag(f.badTools, "Tool lines in poor, faulty or missing condition")}
      ${etFlag(f.badAlloc, "Allocated items in poor, faulty or missing condition")}
      ${etFlag(f.noName, "Allocation rows with no staff name")}
      ${etFlag(f.noType, "Allocation rows with no item type")}
      ${etFlag(f.noOtherName, "Others rows with no item name")}
      ${notOnRoll === null ? "" : etFlag(notOnRoll, "Staff holding equipment who are not on the nominal roll")}
    </div>

    <div class="two-col">
      <table class="grid-table"><tbody>
        <tr class="sec"><td colspan="2">Institution</td></tr>
        ${r("Name of institute", i.name || "—")}${r("Institute code", i.code || "—")}${r("Location / district", i.location || "—")}${r("Head of institution", i.head || "—")}
        <tr class="sec"><td colspan="2">Technology tools</td></tr>
        ${r("Total number of desktop computers", e.desktop.quantity)}${r("Total number of laptop computers", e.laptop.quantity)}${r("Total number of SM1 tablets", e.tablet.quantity)}
        ${r("Others", e.others || "—")}
        <tr class="sec"><td colspan="2">Allocated to staff</td></tr>
        ${r("Total number of desktop computers allocated", e.desktop.allocated)}${r("Total number of laptop computers allocated", e.laptop.allocated)}${r("Total number of SM1 tablets allocated", e.tablet.allocated)}
        ${r("Others allocated", e.other.allocated + (e.othersAllocated ? ` (${e.othersAllocated})` : ""))}
      </tbody></table>
      <div><h4 style="margin-bottom:10px">By type of item</h4>
      <div class="scroll" style="max-height:none;margin-top:0"><table class="grid-table"><thead><tr><th>Item</th><th>Recorded</th><th>Distributed</th><th>Stores</th><th>Allocated</th><th>Allocation rate</th></tr></thead><tbody>${byItem}</tbody></table></div>
      <p class="muted small">Allocation rate is the number allocated to staff divided by the quantity recorded. A dash means that figure has not been entered yet.</p></div>
    </div>`;
}

/* ---------- nominal roll (HR records) ---------- */
const rollNote = () => {
  if (!rollStaff) return state?.institution.name ? "No nominal roll uploaded for this institution yet." : "Choose the institution first.";
  const leave = rollStaff.filter(x => x.post === "On leave").length;
  const when = rollInfo?.importedAt ? new Date(rollInfo.importedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  return `${rollStaff.length - leave} at post, ${leave} on leave${when ? ", roll uploaded " + when : ""}.`;
};

// Loads the HR roll for the institution chosen on the open check, then refreshes whatever depends on it.
async function refreshRoll() {
  const name = state?.institution.name;
  const id = docId;
  rollStaff = null; rollInfo = null;
  if (name) {
    try {
      const r = await loadRoll(name);
      if (r) { rollInfo = r; rollStaff = prepareRoll(r.staff); }
    } catch (e) { console.warn("Could not load the nominal roll (are the Firestore rules published?)", e); }
  }
  if (!state || id !== docId || name !== state.institution.name) return;   // the person moved on while it loaded
  // Pre-fill the monitor's own total from the roll, but never overwrite a number they typed themselves
  // (a number equal to the previous institution's roll total was pre-filled by us, so that one is replaced).
  if (rollStaff && !readOnly && !isEt() && (!filled(state.institution.roll) || String(state.institution.roll) === String(lastRollTotal))) {
    state.institution.roll = String(rollStaff.length); scheduleSave();
    const box = main.querySelector('[data-path="institution.roll"]'); if (box) box.value = state.institution.roll;
  }
  lastRollTotal = rollStaff ? rollStaff.length : null;
  const tot = $("roll-total"); if (tot) tot.textContent = rollStaff ? rollStaff.length : "—";
  const note = $("roll-note"); if (note) note.textContent = rollNote();
  if (tab === "attendance" || tab === "roll" || tab === "summary" || tab === "allocation") renderTab();
  updateTabDots();
}

function rollBadge(name) {
  if (!rollStaff || !filled(name)) return "";
  return matchStaff(name, rollStaff)
    ? '<span class="roll-badge ok" title="Found on the nominal roll">On roll</span>'
    : '<span class="roll-badge no" title="Not found on this institution\'s nominal roll">Not on roll</span>';
}
const rollDatalist = () => rollStaff
  ? `<datalist id="roll-names">${rollStaff.map(x => `<option value="${esc(x.name)}">${esc(x.job)}</option>`).join("")}</datalist>` : "";

function rollSummaryRows(r, i) {
  const entered = r("Total staff in the institute", i.roll || "—");
  if (!rollStaff) return entered;
  const cc = crossCheck(state.attendance, rollStaff);
  return entered + r("Staff on HR nominal roll", cc.total)
    + r("Roll staff checked during this visit", `${cc.matched} of ${cc.total} (${pct(cc.coverage)})`)
    + r("Roll staff not yet checked", cc.notChecked)
    + r("Listed on the attendance sheet but not on the roll", cc.notOnRoll.length);
}
const rollFlags = flag => rollStaff ? flag(crossCheck(state.attendance, rollStaff).notOnRoll.length, "Listed staff not found on the nominal roll") : "";

const statusTone = st => ({ "On time": "ok", "Late": "warn", "Absent": "no" })[st] || "info";

function tRoll() {
  const name = state.institution.name;
  if (!name) return `<h3>Nominal roll</h3><p class="muted">Choose the institution on the Institution tab first.</p>`;
  if (!rollStaff) return `<h3>Nominal roll</h3>
    <div class="empty slim"><h3>No nominal roll for ${esc(name)} yet</h3>
    <p class="muted">HR can upload the nominal roll on the <a href="#/roll">Nominal roll</a> page. Once it is there, you can cross-check every staff member here.</p></div>`;
  const cc = crossCheck(state.attendance, rollStaff);
  const tile = (n, label, cls = "neutral") => `<div class="flag ${cls}"><b>${n}</b><span>${label}</span></div>`;
  const entered = Number(state.institution.roll);
  const rows = rollStaff.map((x, n) => {
    const row = cc.byStaff.get(n);
    return `<tr data-search="${esc(`${x.name} ${x.no} ${x.job}`.toLowerCase())}">
      <td class="num">${n + 1}</td><td>${esc(x.no)}</td><td>${esc(x.name)}</td><td>${esc(x.job)}</td>
      <td><span class="roll-badge ${x.post === "On leave" ? "warn" : "info"}">${esc(x.post)}</span></td>
      <td>${row ? `<span class="roll-badge ${statusTone(row.status)}">${esc(row.status || "Listed")}</span>` : '<span class="roll-badge no">Not yet checked</span>'}</td>
      <td>${row ? "" : `<button type="button" class="btn small" data-roll-add="${n}">Add to attendance</button>`}</td></tr>`;
  }).join("");
  return `<h3>Nominal roll cross-check <small class="muted">${esc(name)}</small></h3>
    <p class="muted small">Staff names are matched in any order (for example “Hannah Asamoah” and “ASAMOAH HANNAH”). Source: the HR nominal roll. ${esc(rollNote())}</p>
    <div class="flags">
      ${tile(cc.total, "Staff on the HR nominal roll")}
      ${tile(cc.matched, `Checked during this visit (${pct(cc.coverage)})`, "")}
      ${tile(cc.notChecked, "On the roll, not yet checked", cc.notChecked ? "warn" : "")}
      ${tile(cc.notOnRoll.length, "Listed but not on the roll", cc.notOnRoll.length ? "raised" : "")}
    </div>
    ${Number.isFinite(entered) && filled(state.institution.roll) && entered !== cc.total ? `<p class="banner-ro">You entered <b>${entered}</b> as the total staff in the institute on the Institution tab, but the HR roll shows <b>${cc.total}</b>.</p>` : ""}
    ${cc.notOnRoll.length ? `<p class="small"><b>Not found on the roll:</b> ${cc.notOnRoll.map(esc).join(", ")}. Check the spelling, or flag these staff to HR.</p>` : ""}
    ${cc.duplicates.length ? `<p class="small"><b>Entered more than once:</b> ${cc.duplicates.map(esc).join(", ")}.</p>` : ""}
    <div class="inline roll-tools">
      <input id="roll-filter" type="search" placeholder="Filter the roll by name, employee no. or job…" autocomplete="off">
      <button type="button" class="btn" data-roll="addall">Add all not yet checked (${cc.notChecked})</button>
    </div>
    <div class="scroll"><table class="grid-table stackable"><thead><tr><th>No.</th><th>Employee no.</th><th>Name</th><th>Job</th><th>On the roll as</th><th>This check</th><th></th></tr></thead>
    <tbody id="roll-rows">${rows}</tbody></table></div>`;
}

function addStaffToAttendance(idxs) {
  let added = 0;
  for (const n of idxs) {
    const x = rollStaff[n]; if (!x) continue;
    let row = state.attendance.find(r => !filled(r.name));
    if (!row) {
      if (state.attendance.length >= LIMITS.attendance) { toast(`The attendance list is full (${LIMITS.attendance} rows).`); break; }
      row = blankAtt(); state.attendance.push(row);
    }
    row.name = x.name; row.grade = x.job || ""; added++;
  }
  if (added) { scheduleSave(); updateTabDots(); renderTab(); toast(added === 1 ? "Added to the attendance list" : `${added} staff added to the attendance list`); }
}

async function addAllUnchecked() {
  const cc = crossCheck(state.attendance, rollStaff);
  const todo = rollStaff.map((_, n) => n).filter(n => !cc.byStaff.has(n));
  if (!todo.length) return toast("Everyone on the roll is already on the attendance list.");
  if (!(await modal({ title: `Add ${todo.length} staff?`, message: "They are added to the Attendance tab with their name and job. You then record who was present.", confirmLabel: "Add them" }))) return;
  addStaffToAttendance(todo);
}

/* ---------- evidence of visit ---------- */
const evCats = () => (isEt() ? EV_CATEGORIES_EDTECH : EV_CATEGORIES);
const canAddEvidence = () => !!state && (!readOnly || canEvidenceAny());
const canDeleteEvidence = ev => !!state && (!readOnly || canEvidenceAny() || ev.uploadedBy === user.uid);

async function loadEvidence() {
  const id = docId;
  evidenceError = "";
  try {
    const q = collection(db, "inspections", id, "evidence");
    const snap = await withCacheFallback(() => getDocs(q), () => getDocsFromCache(q));
    if (id !== docId) return;
    evidence = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
  } catch (err) {
    console.error(err);
    if (id !== docId) return;
    evidence = []; evidenceError = err.code || err.message;
  }
  if (tab === "evidence") renderTab();
  updateTabDots();
}

function tEvidence() {
  if (evidence === null) { loadEvidence(); return `<h3>Evidence of visit</h3><p class="muted">Loading…</p>`; }
  const when = t => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const card = ev => `<figure class="ev-card">
      <button type="button" class="ev-thumb${ev.kind === "pdf" ? " pdf" : ""}" data-ev-view="${esc(ev.id)}" aria-label="Open ${esc(ev.caption || ev.name || "evidence")}">
        ${ev.kind === "pdf" ? "<span>PDF</span>" : `<img src="${esc(ev.data)}" alt="${esc(ev.caption || ev.category || "Evidence")}" loading="lazy">`}</button>
      <figcaption>
        <span class="pill">${esc(ev.category || "Other")}</span>
        <p>${esc(ev.caption || ev.name || "")}</p>
        <p class="muted small">${esc(ev.uploadedByName || "Unknown")} · ${esc(when(ev.uploadedAt || 0))} · ${esc(fmtSize(ev.size || 0))}</p>
        ${canDeleteEvidence(ev) ? `<button type="button" class="btn small danger" data-ev-del="${esc(ev.id)}">Remove</button>` : ""}
      </figcaption></figure>`;
  const upload = canAddEvidence() ? `
    <div class="grid">
      <label>Type of evidence<select id="ev-cat">${opts(evCats(), evCats()[0], false)}</select></label>
      <label>Remarks (optional)<input id="ev-cap" type="text" placeholder="e.g. Register at 8:15 am, Block B" autocomplete="off"></label>
    </div>
    <div class="inline ev-actions">
      <label class="btn primary file-btn">Take a photo<input id="ev-cam" type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn file-btn">Choose photos or PDFs<input id="ev-file" type="file" accept="image/*,application/pdf" multiple hidden></label>
      <span id="ev-status" class="muted small" role="status"></span>
    </div>` : "";
  return `<div data-keep>
    <h3>Evidence of visit</h3>
    <p class="muted small">${isEt() ? "Photos of equipment in store, serial numbers and asset labels, faulty items, the allocation register or signed findings, and short PDFs." : "Photos of the attendance register, the movement book, signed findings or staff on site, and short PDFs."} Photos are shrunk automatically.
      Up to ${EV_LIMITS.files} files per check, PDFs up to ${Math.round(EV_LIMITS.pdfBytes / 1024)} KB. ${readOnly && !canEvidenceAny() ? "You can view the evidence but not add to it." : ""}</p>
    ${evidenceError ? `<p class="error">Could not load evidence: ${esc(evidenceError)}. Check the Firestore rules are the latest version (see README).</p>` : ""}
    ${upload}
    ${evidence.length ? `<div class="ev-grid">${evidence.map(card).join("")}</div>` : `<div class="empty slim"><h3>No evidence uploaded yet</h3><p class="muted">${canAddEvidence() ? "Use the buttons above to add the first photo." : "Nothing has been added to this check yet."}</p></div>`}
  </div>`;
}

async function uploadEvidence(files) {
  if (!canAddEvidence() || !files.length) return;
  const id = docId;
  const cat = $("ev-cat")?.value || evCats()[0];
  const cap = ($("ev-cap")?.value || "").trim();
  let ok = 0;
  for (const f of files) {
    if (evidence.length >= EV_LIMITS.files) { toast(`Maximum of ${EV_LIMITS.files} files per check.`); break; }
    const status = $("ev-status");
    try {
      if (status) status.textContent = `Preparing ${f.name || "photo"}…`;
      const p = await prepareEvidenceFile(f);
      if (status) status.textContent = "Saving…";
      const rec = {
        kind: p.kind, mime: p.mime, name: p.name, size: p.size, data: p.data, category: cat, caption: cap,
        uploadedBy: user.uid, uploadedByName: user.displayName || user.email || "", uploadedAt: Date.now()
      };
      const ref = doc(collection(db, "inspections", id, "evidence"));
      const write = setDoc(ref, rec);
      const outcome = navigator.onLine ? await settle(write, 15000) : "pending";
      if (outcome !== "synced") write.catch(err => { console.error(err); toast("An evidence file could not sync: " + (err.code || err.message)); });
      if (id !== docId) return;
      evidence.unshift({ id: ref.id, ...rec }); ok++;
    } catch (err) {
      console.error(err);
      toast(err.code === "permission-denied" ? "Not allowed. Publish the latest firestore.rules (see README)." : (err.code ? "Could not save: " + err.code : err.message));
    }
  }
  if (id !== docId) return;
  if ($("ev-cap") && ok) $("ev-cap").value = "";
  renderTab(); updateTabDots();
  if (ok) toast(ok === 1 ? "Evidence added" : `${ok} files added`);
}

async function deleteEvidence(evId) {
  if (!(await askConfirm("Remove this evidence?", "The file is deleted from this check. This cannot be undone.", "Remove"))) return;
  try {
    const del = deleteDoc(doc(db, "inspections", docId, "evidence", evId));
    if (navigator.onLine) await settle(del); else del.catch(console.error);
    evidence = evidence.filter(e => e.id !== evId);
    renderTab(); updateTabDots(); toast("Evidence removed");
  } catch (err) { toast("Could not remove: " + (err.code || err.message)); }
}

function viewEvidence(evId) {
  const ev = evidence.find(e => e.id === evId);
  if (!ev) return;
  let url;
  try { url = URL.createObjectURL(dataUrlToBlob(ev.data)); } catch { return toast("This file could not be opened."); }
  const fileName = ev.name || (ev.kind === "pdf" ? "evidence.pdf" : "evidence.jpg");
  const back = document.createElement("div");
  back.className = "modal-back viewer";
  back.innerHTML = `<div class="viewer-box" role="dialog" aria-modal="true">
    <div class="viewer-bar"><div><b>${esc(ev.category || "Evidence")}</b><span class="muted small">${esc(ev.caption || ev.name || "")}</span></div>
      <a class="btn small" href="${url}" download="${esc(fileName)}">Download</a><button type="button" class="btn small" data-v="close">Close</button></div>
    ${ev.kind === "image" ? `<img src="${url}" alt="${esc(ev.caption || "Evidence")}">` : `<p class="muted">PDF files open in a new tab.</p><a class="btn primary" href="${url}" target="_blank" rel="noopener">Open PDF</a>`}</div>`;
  const close = () => { document.removeEventListener("keydown", onKey); back.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  const onKey = e => { if (e.key === "Escape") close(); };
  back.addEventListener("click", e => { if (e.target === back || e.target.dataset.v === "close") close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
}

/* ---------- Nominal roll page (#/roll) ---------- */
let rollView = { inst: "", q: "" };

async function showRollPage() {
  await saveNow();
  state = null; docId = null; readOnly = false;
  main.innerHTML = '<p class="muted pad">Loading…</p>';
  try { allRolls = await loadAllRolls(); }
  catch (err) { console.error(err); allRolls = []; toast("Could not load the roll: " + (err.code || err.message)); }
  renderRollPage();
}

const fmtDay = t => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function renderRollPage() {
  const rolls = allRolls || [];
  const byKey = new Map(rolls.map(r => [r.key || r.id, r]));
  const names = sortList([...new Set([...institutions, ...rolls.map(r => r.institution).filter(Boolean)])]);
  const total = rolls.reduce((n, r) => n + (r.count || 0), 0);
  const leave = rolls.reduce((n, r) => n + (r.onLeave || 0), 0);
  const stamp = rolls.reduce((m, r) => Math.max(m, r.importedAt || 0), 0);
  const lede = total
    ? `${total} staff on ${rolls.length} institution rolls (${total - leave} at post, ${leave} on leave). Last updated ${fmtDay(stamp)}.`
    : isHr() ? "No nominal roll has been uploaded yet. Import the HR workbook to get started." : "HR has not uploaded the nominal roll yet.";
  const tr = names.map(n => {
    const r = byKey.get(rollKey(n));
    return `<tr><td><button type="button" class="link" data-roll-inst="${esc(n)}">${esc(n)}</button></td>
      <td>${canEditCodeList() ? `<input class="code-input" type="text" data-code-inst="${esc(n)}" value="${esc(codeFor(n))}" placeholder="Code" aria-label="Institute code for ${esc(n)}" autocomplete="off">` : esc(codeFor(n)) || '<span class="muted">—</span>'}</td>
      <td class="val">${r ? r.count : "—"}</td><td class="val">${r ? r.count - (r.onLeave || 0) : "—"}</td><td class="val">${r ? (r.onLeave || 0) : "—"}</td>
      <td>${r ? esc(fmtDay(r.importedAt || 0)) : '<span class="muted">No roll uploaded</span>'}</td>
      ${isHr() ? `<td>${r ? `<button type="button" class="btn small danger" data-roll-del="${esc(r.key || r.id)}">Delete</button>` : ""}</td>` : ""}</tr>`;
  }).join("");
  main.innerHTML = `
    <div class="page-head">
      <div><h2>Nominal roll</h2><p class="muted">${esc(lede)}</p></div>
      <div class="head-actions">
        <a class="btn" href="#/">← All checks</a>
        ${isHr() ? '<button type="button" class="btn primary" data-roll="import">Import nominal roll (.xlsx)</button><input id="roll-file" type="file" accept=".xlsx,.xls" hidden>' : ""}
      </div>
    </div>
    <div class="panel">
      <h3>Cross-check a staff member</h3>
      <div class="grid">
        <label>Institution<select id="roll-inst"><option value="">All institutions</option>${names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("")}</select></label>
        <label>Name, employee number or job<input id="roll-q" type="search" placeholder="e.g. Mensah, or 1557315" autocomplete="off"></label>
      </div>
      <div id="roll-results"></div>
    </div>
    <div class="panel" style="margin-top:18px">
      <h3>Staff on the roll and institute codes, by institution</h3>
      <div class="scroll"><table class="grid-table"><thead><tr><th>Institution</th><th>Institute code</th><th>On the roll</th><th>At post</th><th>On leave</th><th>Roll updated</th>${isHr() ? "<th></th>" : ""}</tr></thead>
      <tbody>${tr}</tbody>${total ? `<tfoot><tr class="total"><td>All institutions</td><td></td><td class="val">${total}</td><td class="val">${total - leave}</td><td class="val">${leave}</td><td></td>${isHr() ? "<td></td>" : ""}</tr></tfoot>` : ""}</table></div>
    </div>`;
  $("roll-inst").value = rollView.inst; $("roll-q").value = rollView.q;
  renderRollResults();
}

function renderRollResults() {
  const box = $("roll-results");
  if (!box) return;
  const q = rollView.q.trim().toLowerCase();
  const inst = rollView.inst ? rollKey(rollView.inst) : "";
  if (!q && !inst) { box.innerHTML = '<p class="muted small">Pick an institution, or type a name, to see the staff on the roll.</p>'; return; }
  const rolls = (allRolls || []).filter(r => !inst || (r.key || r.id) === inst);
  if (inst && !rolls.length) { box.innerHTML = `<p class="muted small">No roll has been uploaded for ${esc(rollView.inst)} yet.</p>`; return; }
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const r of rolls) for (const x of r.staff || []) {
    const hay = `${x.name} ${x.no} ${x.job}`.toLowerCase();
    if (terms.every(t => hay.includes(t))) hits.push({ ...x, institution: r.institution });
  }
  const shown = hits.slice(0, 100);
  box.innerHTML = `<p class="muted small">${hits.length} ${hits.length === 1 ? "match" : "matches"}${hits.length > shown.length ? `, showing the first ${shown.length}. Type more to narrow it down` : ""}.</p>
    ${shown.length ? `<div class="scroll"><table class="grid-table"><thead><tr><th>Employee no.</th><th>Name</th><th>Job</th>${inst ? "" : "<th>Institution</th>"}<th>Status</th></tr></thead><tbody>
      ${shown.map(x => `<tr><td>${esc(x.no)}</td><td>${esc(x.name)}</td><td>${esc(x.job)}</td>${inst ? "" : `<td>${esc(x.institution)}</td>`}
        <td><span class="roll-badge ${x.post === "On leave" ? "warn" : "info"}">${esc(x.post)}</span></td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

// Asks which institution each sheet belongs to. A sheet whose name matches the institution list is pre-selected;
// anything else (for example a workbook whose only sheet is called "Sheet1") must be assigned by the person importing.
function chooseInstitutions(sheets, intro) {
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "modal-back";
    const rows = sheets.map((sh, i) => `<label>${esc(sh.sheet)} <span class="muted small">${sh.count} staff</span>
      <select data-i="${i}"><option value="">Choose the institution…</option>
        ${institutions.map(n => `<option value="${esc(n)}"${sh.inList && n === sh.institution ? " selected" : ""}>${esc(n)}</option>`).join("")}
        ${sh.inList ? "" : `<option value="__keep">Keep “${esc(sh.sheet)}” as a new institution name</option>`}</select></label>`).join("");
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-height:88vh;overflow:auto">
      <h3>Which institution is each sheet for?</h3>
      <p class="muted">${esc(intro)}</p>
      ${rows}
      <p class="error hidden" id="m-err"></p>
      <div class="modal-actions"><button type="button" class="btn" data-m="cancel">Cancel</button><button type="button" class="btn primary" data-m="ok">Import</button></div></div>`;
    const done = v => { document.removeEventListener("keydown", onKey); back.remove(); resolve(v); };
    const onKey = e => { if (e.key === "Escape") done(null); };
    back.addEventListener("click", e => {
      if (e.target === back || e.target.dataset.m === "cancel") return done(null);
      if (e.target.dataset.m !== "ok") return;
      const err = back.querySelector("#m-err");
      const picks = [...back.querySelectorAll("select")].map(x => x.value);
      if (picks.some(v => !v)) { err.textContent = "Choose an institution for every sheet."; return err.classList.remove("hidden"); }
      const chosen = picks.map((v, i) => (v === "__keep" ? sheets[i].institution : v));
      if (new Set(chosen.map(rollKey)).size !== chosen.length) { err.textContent = "Two sheets are set to the same institution. Each institution can have one roll."; return err.classList.remove("hidden"); }
      done(sheets.map((sh, i) => ({ ...sh, institution: chosen[i], key: rollKey(chosen[i]) })));
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    back.querySelector("select")?.focus();
  });
}

async function removeRoll(key) {
  if (!isHr()) return toast("Only HR can delete a nominal roll.");
  const r = (allRolls || []).find(x => (x.key || x.id) === key);
  if (!(await askConfirm(`Delete the roll for ${r?.institution || "this institution"}?`, `${r?.count ?? ""} staff will be removed from the nominal roll. Checks already recorded are not affected. You can import the roll again at any time.`, "Delete roll"))) return;
  try {
    await deleteRoll(key);
    allRolls = await loadAllRolls();
    toast("Roll deleted");
  } catch (err) {
    console.error(err);
    toast(err.code === "permission-denied" ? "Not allowed: your account needs the hr role (see README)." : "Could not delete: " + (err.code || err.message));
  }
  renderRollPage();
}

async function importRoll(file) {
  if (!isHr()) return toast("Only HR can upload the nominal roll.");
  if (typeof XLSX === "undefined") return toast("Excel library failed to load.");
  let parsed;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    parsed = parseRollWorkbook(XLSX, wb, institutions);
  } catch (err) { console.error(err); return toast("Could not read that file: " + err.message); }
  if (!parsed.sheets.length) return toast("No staff were found. Each sheet needs a FULL NAME column.");
  const message = [
    `${parsed.total} staff on ${parsed.sheets.length} ${parsed.sheets.length === 1 ? "sheet" : "sheets"}.`,
    parsed.duplicates.length ? `${parsed.duplicates.length} employee numbers appear more than once (on one sheet twice, or on two sheets). Worth a look in the workbook.` : "",
    "Only name, employee number, job and at-post/on-leave are saved. Bank, SSNIT, Ghana Card, date of birth and phone numbers are not.",
    "This replaces any roll already saved for these institutions."
  ].filter(Boolean).join("\n\n");
  const sheets = await chooseInstitutions(parsed.sheets, message);
  if (!sheets) return;
  try {
    await saveRolls(sheets, user, file.name);
    allRolls = await loadAllRolls();
    toast(`Imported ${parsed.total} staff`);
  } catch (err) {
    console.error(err);
    toast(err.code === "permission-denied" ? "Not allowed: your account needs the hr role (see README)." : "Import failed: " + (err.code || err.message));
  }
  renderRollPage();
}

/* ---------- file pickers and autofill (change events) ---------- */
main.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.codeInst !== undefined) {   // HR / team lead editing an institute code on the Nominal roll page
    const nm = el.dataset.codeInst, val = el.value.trim().replace(/\s+/g, " ");
    el.value = val;
    saveSchoolCode(nm, val).then(ok => { if (ok) toast(val ? `Code saved for ${nm}` : `Code cleared for ${nm}`); else el.value = codeFor(nm); });
    return;
  }
  if (el.id === "photo-file") { const f = el.files?.[0]; el.value = ""; if (f) uploadPhoto(f); return; }
  if (el.id === "roll-file") { const f = el.files?.[0]; el.value = ""; if (f) importRoll(f); return; }
  if (el.id === "ev-file" || el.id === "ev-cam") { const files = [...(el.files || [])]; el.value = ""; uploadEvidence(files); return; }
  // Picking a name from the roll fills the grade with their job, if it is still empty
  const m = (el.dataset.path || "").match(/^attendance\.(\d+)\.name$/);
  if (m && rollStaff && state && !readOnly) {
    const hit = matchStaff(el.value, rollStaff), row = state.attendance[m[1]];
    if (hit?.job && row && !filled(row.grade)) {
      row.grade = hit.job;
      const g = main.querySelector(`[data-path="attendance.${m[1]}.grade"]`); if (g) g.value = row.grade;
      scheduleSave();
    }
  }
});

/* ---------- events ---------- */
main.addEventListener("input", e => {
  if (e.target.id === "filter") {
    const term = e.target.value.trim().toLowerCase();
    document.querySelectorAll("#cards .card").forEach(c => c.classList.toggle("hidden", !c.dataset.search.includes(term)));
    return;
  }
  if (e.target.id === "roll-filter") {
    const term = e.target.value.trim().toLowerCase();
    document.querySelectorAll("#roll-rows tr").forEach(tr => tr.classList.toggle("hidden", !tr.dataset.search.includes(term)));
    return;
  }
  if (e.target.id === "roll-q") { rollView.q = e.target.value; return renderRollResults(); }
  if (e.target.id === "roll-inst") { rollView.inst = e.target.value; return renderRollResults(); }
  const el = e.target, path = el.dataset.path;
  if (el.dataset.multi && state) {
    const vals = [...main.querySelectorAll(`input[data-multi="${el.dataset.multi}"]:checked`)].map(x => x.value);
    setByPath(state, el.dataset.multi, vals);
    $("cats-summary").textContent = vals.length ? vals.join(", ") : "Select categories…";
    return scheduleSave();
  }
  if (!path || !state) return;
  setByPath(state, path, el.value);
  if (el.tagName === "SELECT") el.dataset.val = el.value;

  if (path === "institution.name") { $("title").textContent = el.value || "Untitled check"; syncSchoolCode(); refreshRoll(); }
  if (path === "institution.code") {
    const pill = $("code-pill"); if (pill) { pill.textContent = "Institute code " + el.value.trim(); pill.classList.toggle("hidden", !el.value.trim()); }
    if (canEditCodeList() && filled(state.institution.name)) {   // HR and team leads keep the shared list up to date from here
      clearTimeout(codeTimer); const nm = state.institution.name, cd = el.value;
      codeTimer = setTimeout(() => saveSchoolCode(nm, cd), 1000);
    }
  }

  // "On roll?" badge next to the name
  const nm = path.match(/^attendance\.(\d+)\.name$|^allocation\.(\d+)\.staff$|^leave\.(\d+)\.name$/);
  if (nm) { const cell = main.querySelector(`[data-rb="${nm[1] ?? nm[2] ?? nm[3]}"]`); if (cell) cell.innerHTML = rollBadge(el.value); }

  // Leave: live duration and status for the row, plus the totals under the table
  const lm = path.match(/^leave\.(\d+)\./);
  if (lm) {
    const c = leaveCells(state.leave[lm[1]]);
    const d1 = main.querySelector(`[data-ld="${lm[1]}"]`), d2 = main.querySelector(`[data-ls="${lm[1]}"]`);
    if (d1) d1.innerHTML = c.dur; if (d2) d2.innerHTML = c.status;
    if ($("leave-flags")) $("leave-flags").innerHTML = leaveFlags();
    if ($("leave-hint")) $("leave-hint").innerHTML = leaveRollHint();
  }

  // EdTech staff allocation: the "name the item" box shows only when the type is Others
  const tpm = path.match(/^allocation\.(\d+)\.type$/);
  if (tpm) {
    const nameBox = main.querySelector(`[data-path="allocation.${tpm[1]}.other"]`), isOthers = el.value === "Others";
    if (nameBox) { nameBox.classList.toggle("hidden", !isOthers); if (!isOthers) { nameBox.value = ""; state.allocation[tpm[1]].other = ""; } else nameBox.focus(); }
  }

  // EdTech: live "adds up" check on each tools row, and the running totals under the tables
  const tm = path.match(/^tools\.(\d+)\./);
  if (tm) { const c = main.querySelector(`[data-tc="${tm[1]}"]`); if (c) c.innerHTML = toolCheck(state.tools[tm[1]]); }
  if (path.startsWith("tools.") && $("tools-flags")) $("tools-flags").innerHTML = toolsFlags();
  if ((path.startsWith("allocation.") || path.startsWith("tools.")) && $("alloc-footer")) $("alloc-footer").innerHTML = allocFooter();

  // Auto-suggest On time / Late from arrival time vs official start time
  const m = path.match(/^attendance\.(\d+)\.arrival$/);
  if (m && el.value && state.institution.startTime) {
    const row = state.attendance[m[1]];
    if (!row.status || row.status === "On time" || row.status === "Late") {
      row.status = el.value > state.institution.startTime ? "Late" : "On time";
      const s = main.querySelector(`[data-path="attendance.${m[1]}.status"]`);
      if (s) { s.value = row.status; s.dataset.val = row.status; }
    }
    if (!row.present) {
      row.present = "Yes";
      const p = main.querySelector(`[data-path="attendance.${m[1]}.present"]`);
      if (p) { p.value = "Yes"; p.dataset.val = "Yes"; }
    }
  }
  if (path.startsWith("records.")) $("records-footer").innerHTML = recordsFooter();
  updateTabDots();
  scheduleSave();
});

main.addEventListener("click", async e => {
  const t = e.target.closest("button");
  if (!t) return;

  if (t.dataset.tab) { tab = t.dataset.tab; return renderTab(); }
  if (t.dataset.inst === "add") return addInstitution();
  if (t.dataset.inst === "del") return deleteInstitution();
  if (t.dataset.view) { dashView = t.dataset.view; return showDashboard(); }
  if (t.dataset.dtab) {   // Human Resource / EdTech switch on the dashboard
    if (!deptsFor().some(([k]) => k === t.dataset.dtab)) return;
    const target = homeHash(t.dataset.dtab);
    if (location.hash === target || (target === "#/" && !location.hash)) { dashDept = t.dataset.dtab; return showDashboard(); }
    location.hash = target; return;
  }

  if (t.dataset.roll === "use" && rollStaff) {
    state.institution.roll = String(rollStaff.length);
    const box = main.querySelector('[data-path="institution.roll"]'); if (box) box.value = state.institution.roll;
    scheduleSave(); return toast("Roll total copied");
  }
  if (t.dataset.roll === "addall") return addAllUnchecked();
  if (t.dataset.rollAdd !== undefined) return addStaffToAttendance([Number(t.dataset.rollAdd)]);
  if (t.dataset.roll === "import") return $("roll-file")?.click();
  if (t.dataset.rollInst !== undefined) { rollView.inst = t.dataset.rollInst; const sel = $("roll-inst"); if (sel) sel.value = rollView.inst; renderRollResults(); return $("roll-results")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  if (t.dataset.rollDel !== undefined) return removeRoll(t.dataset.rollDel);
  if (t.dataset.evView) return viewEvidence(t.dataset.evView);
  if (t.dataset.evDel) return deleteEvidence(t.dataset.evDel);

  if (t.dataset.action === "photo-pick") return $("photo-file")?.click();
  if (t.dataset.action === "photo-remove") return removePhoto();
  if (t.dataset.action === "new") return createInspection(t.dataset.dept || dashDept);
  if (t.dataset.action === "leave-from-roll") {
    const listed = new Set(state.leave.filter(r => filled(r.name)).map(r => r.name.trim().toLowerCase()));
    const names = (rollStaff || []).filter(x => x.post === "On leave" && !listed.has(String(x.name).trim().toLowerCase())).map(x => x.name);
    const free = state.leave.filter(r => !filled(r.name) && !filled(r.type) && !filled(r.start) && !filled(r.end) && !filled(r.remarks));
    names.forEach(nm2 => { const slot = free.shift(); if (slot) slot.name = nm2; else if (state.leave.length < LIMITS.leave) state.leave.push(blankLeave(nm2)); });
    scheduleSave(); renderTab(); return updateTabDots();
  }
  if (t.dataset.action === "delete") return deleteInspection(t.dataset.id);
  if (t.dataset.action === "print") return window.print();
  if (t.dataset.action === "export") return exportXlsx();

  if (t.dataset.add) {
    const k = t.dataset.add;
    if (state[k].length >= LIMITS[k]) return toast(`Maximum of ${LIMITS[k]} rows reached.`);
    state[k].push({ attendance: blankAtt, movement: blankMov, findings: isEt() ? blankFindEt : blankFind, tools: blankTool, allocation: blankAlloc, leave: blankLeave }[k]());
    scheduleSave(); updateTabDots(); return renderTab();
  }
  if (t.dataset.del) {
    const [k, n] = t.dataset.del.split(".");
    if (state[k].length <= 1) return toast("At least one row must remain.");
    const row = state[k][n];
    const hasData = Object.entries(row).some(([key, v]) => key !== "type" && String(v).trim() !== "");   // a pre-selected item type alone is not data
    if (hasData && !(await askConfirm("Remove this row?", "The row and everything entered in it will be removed.", "Remove"))) return;
    state[k].splice(Number(n), 1);
    scheduleSave(); updateTabDots(); renderTab();
  }
});

/* ---------- Excel export ---------- */
function exportEdtechXlsx() {
  const d = state, i = d.institution, e = computeEdtech(d);
  const wb = XLSX.utils.book_new();
  const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const f = e.flags;

  add("Institution Details", [["Field", "Entry"],
    ["Name of institution", i.name], ["Institute code", i.code], ["Location / district", i.location], ["Head of institution", i.head],
    ["Date of check", i.date], ["Type of check", i.type], ["Monitoring team members", i.team],
    ["Time team arrived / departed", `${i.arrived} / ${i.departed}`]]);

  add("Institute Technology Tools", [["NAME OF INSTITUTE:", i.name], ["Items to Verify", "Quantities", "Distributed", "Stores", "Condition", "Remarks"],
    ...d.tools.filter((r, n) => n < FIXED_TOOLS.length || [r.item, r.quantity, r.distributed, r.stores, r.condition, r.remarks].some(filled))
      .map(r => [r.item, r.quantity, r.distributed, r.stores, r.condition, r.remarks])]);

  add("Staff Allocation", [["Type of Item", "Name of Other Item", "Staff Name", "Department", "Quantities", "Condition", "Remarks"],
    ...d.allocation.filter(r => [r.staff, r.quantity, r.condition, r.remarks, r.other].some(filled))
      .map(r => [r.type, r.type === "Others" ? r.other : "", r.staff, r.dept, r.quantity, r.condition, r.remarks])]);

  add("Findings", [["NO", "FINDING", "EVIDENCE", "RECOMMENDED ACTION", "RESPONSIBLE OFFICER", "DEADLINE"],
    ...d.findings.filter(r => filled(r.finding)).map((r, n) => [n + 1, r.finding, r.evidence, r.action, r.officer, r.deadline]),
    [], ["Overall assessment"], ["Area", "Rating", "Comment"],
    ...EDTECH_AREAS.map(([k, l]) => [l, d.assessment[k].rating, d.assessment[k].comment]),
    [], ["Sign-off"], ["Role", "Name", "Signature", "Date"],
    ...ROLES.map(([k, l]) => [l, d.signoff[k].name, d.signoff[k].signature, d.signoff[k].date])]);

  add("Summary", [
    ["NAME OF INSTITUTE", i.name],
    ["TOTAL NUMBER OF DESKTOP COMPUTERS", e.desktop.quantity],
    ["TOTAL NUMBER OF LAPTOP COMPUTERS", e.laptop.quantity],
    ["TOTAL NUMBER OF SM1 TABLETS", e.tablet.quantity],
    ["TOTAL NUMBER OF DESKTOP COMPUTERS ALLOCATED", e.desktop.allocated],
    ["TOTAL NUMBER OF LAPTOP COMPUTERS ALLOCATED", e.laptop.allocated],
    ["TOTAL NUMBER OF SM1 TABLETS ALLOCATED", e.tablet.allocated],
    ["OTHERS", e.others], ["OTHERS ALLOCATED", e.othersAllocated], [],
    ["Institute code", i.code], ["Date of check", i.date], ["Type of check", i.type], [],
    ["Items accounted for (distributed or in stores)", pct(e.accountedRate)],
    ["Desktops, laptops and tablets allocated to staff", pct(e.allocationRate)],
    ["Items in good condition", pct(e.goodRate)], [],
    ["Needs attention"],
    ["Lines where Distributed + Stores do not add up", f.notReconciled],
    ["Item types allocated beyond the quantity recorded", f.overAllocated],
    ["Item types where Distributed differs from the staff list", f.allocMismatch],
    ["Tool lines in poor, faulty or missing condition", f.badTools],
    ["Allocated items in poor, faulty or missing condition", f.badAlloc],
    ["Allocation rows with no staff name", f.noName],
    ["Allocation rows with no item type", f.noType],
    ["Others rows with no item name", f.noOtherName], [],
    ["Item", "Recorded", "Distributed", "Stores", "Allocated", "Not yet allocated", "Allocation rate"],
    ...e.byType.flatMap(x => [[x.type, x.qEntered ? x.quantity : "", x.dEntered ? x.distributed : "", x.stores, x.allocated, x.qEntered ? x.unallocated : "", pct(x.allocationRate)],
      ...(x.type === "Others" ? e.othersItems.map(it => [`   ${it.name || "Item not named"}`, it.qEntered ? it.quantity : "", it.dEntered ? it.distributed : "", it.stores, it.allocated, it.qEntered ? Math.max(it.quantity - it.allocated, 0) : "", pct(it.allocationRate)]) : [])])]);

  const safe = (i.name || "check").replace(/[^\w-]+/g, "_");
  return saveFile(wb, `EdTech_Check_${safe}_${i.date || "undated"}.xlsx`);
}

function exportXlsx() {
  if (typeof XLSX === "undefined") return toast("Excel library failed to load.");
  if (isEt()) return exportEdtechXlsx();
  const d = state, i = d.institution, s = computeSummary(d);
  const wb = XLSX.utils.book_new();
  const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const used = (arr, k = "name") => arr.filter(r => String(r[k]).trim() !== "");

  add("Institution Details", [["Field", "Entry"],
    ["Name of institution", i.name], ["Institute code", i.code], ["Location / district", i.location], ["Head of institution", i.head],
    ["Date of check", i.date], ["Type of check", i.type], ["Monitoring team members", i.team],
    ["Time team arrived / departed", `${i.arrived} / ${i.departed}`], ["Total staff in the institute", i.roll],
    ["Official start time of work", i.startTime], ["Staff categories covered", (i.categories || []).join(", ")]]);

  add("Attendance Sheet", [["No.", "Name of staff", "Level", "Grade", "Unit / Dept", "Signed register?", "Arrival time", "Physically present?", "Status", "Remarks"],
    ...used(d.attendance).map((r, n) => [n + 1, r.name, r.level, r.grade, r.dept, r.signed, r.arrival, r.present, r.status, r.remarks])]);

  add("Movement Log", [["No.", "Name of staff", "Level", "Department", "Time left office", "Reason given", "Destination", "Authorised by", "Entered in movement book?", "Expected return", "Remarks"],
    ...used(d.movement).map((r, n) => [n + 1, r.name, r.level, r.dept, r.left, r.reason, r.destination, r.authorisedBy, r.entered, r.expectedReturn, r.remarks])]);

  const asOf = i.date || todayIso(), lv = computeLeave(d, asOf);
  const statusLabel = { ongoing: "On leave on the day of the check", upcoming: "Starts later", ended: "Back at work" };
  add("Leave", [["No.", "Name of staff", "Type of leave", "Leave starts", "Leave ends (last day)", "Duration (days)", "Due back", "Status on the day of the check", "Remarks"],
    ...used(d.leave).map((r, n) => [n + 1, r.name, r.type, r.start, r.end, leaveDays(r.start, r.end) ?? "", leaveResumes(r.end), statusLabel[leaveStatus(r, asOf)] || "", r.remarks]),
    [], ["", "Staff on leave recorded", lv.count], ["", "On leave on the day of the check", lv.ongoing], ["", "Total leave days", lv.totalDays],
    ["", "Average length of leave (days)", lv.avgDays === null ? "" : Math.round(lv.avgDays * 10) / 10], ["", "Longest leave (days)", lv.longest || ""]]);

  add("Records Checklist", [["No.", "Item to verify", "Response", "Remarks"],
    ...CHECKLIST.map((c, n) => [n + 1, c, d.records[n].response, d.records[n].remarks]),
    [], ["", "Items answered Yes", s.recordsYes], ["", "Items answered No", s.recordsNo], ["", "Compliance rate", pct(s.complianceRate)]]);

  add("Findings", [["No.", "Finding", "Staff level affected", "Evidence", "Recommended action", "Responsible officer", "Deadline"],
    ...used(d.findings, "finding").map((r, n) => [n + 1, r.finding, r.level, r.evidence, r.action, r.officer, r.deadline]),
    [], ["Overall assessment"], ["Area", "Rating", "Comment"],
    ...AREAS.map(([k, l]) => [l, d.assessment[k].rating, d.assessment[k].comment]),
    [], ["Sign-off"], ["Role", "Name", "Signature", "Date"],
    ...ROLES.map(([k, l]) => [l, d.signoff[k].name, d.signoff[k].signature, d.signoff[k].date])]);

  add("Summary", [["Summary for this Institution"],
    ["Institution", i.name], ["Institute code", i.code], ["Date of check", i.date], ["Type of check", i.type], ["Total staff in the institute", i.roll], ["Staff on HR nominal roll", rollStaff ? rollStaff.length : ""], [],
    ["Staff listed on attendance sheet", s.listed], ["Present on time", s.onTime], ["Present but late", s.late],
    ["Absent with approval", s.approved], ["Absent without approval", s.absent], ["Signed register but not physically present", s.signedNotPresent],
    ["Attendance rate", pct(s.attendanceRate)], ["Punctuality rate", pct(s.punctualityRate)], [],
    ["Staff found out of office", s.movementListed], ["Not entered in movement book", s.notInBook], [],
    ["Staff on leave recorded", lv.count], ["On leave on the day of the check", lv.ongoing], ["Total leave days", lv.totalDays],
    ["On leave but signed or present on the attendance sheet", lv.signedWhileOnLeave], [],
    ["Records compliance rate", pct(s.complianceRate)], [],
    ["Level", "Listed", "Present", "Late", "Absent (no approval)", "Attendance rate"],
    ...s.byLevel.map(x => [x.level, x.listed, x.present, x.late, x.absent, pct(x.rate)])]);

  if (rollStaff) {
    const cc = crossCheck(d.attendance, rollStaff);
    add("Nominal Roll Check", [
      ["Staff on HR nominal roll", cc.total], ["Checked during this visit", cc.matched], ["Not yet checked", cc.notChecked],
      ["Listed but not on the roll", cc.notOnRoll.join("; ")], [],
      ["No.", "Employee no.", "Name", "Job", "Roll status", "This check"],
      ...rollStaff.map((st, n) => { const row = cc.byStaff.get(n); return [n + 1, st.no, st.name, st.job, st.post, row ? (row.status || "Listed") : "Not checked"]; })]);
  }
  const safe = (i.name || "check").replace(/[^\w-]+/g, "_");
  return saveFile(wb, `Attendance_Check_${safe}_${i.date || "undated"}.xlsx`);
}

// Downloads from web apps are unreliable on iPhone (and often silent in Home Screen apps),
// so there we hand the file to the share sheet (Save to Files, Mail, WhatsApp...). Elsewhere it's a normal download.
async function saveFile(wb, filename) {
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const blob = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type });
  if (isIOS && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
    } catch (err) {
      if (err && err.name === "AbortError") return;   // the person closed the share sheet
      console.warn("Share failed, downloading instead", err);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/* ---------- install as an app ---------- */
let installEvent = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; $("install-btn").classList.remove("hidden"); });
window.addEventListener("appinstalled", () => { installEvent = null; $("install-btn").classList.add("hidden"); });
$("install-btn").addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null; $("install-btn").classList.add("hidden");
});

// iPhone has no install button, so explain Add to Home Screen once.
function showIosHint() {
  let dismissed = false;
  try { dismissed = localStorage.getItem("iosHintDismissed") === "1"; } catch { /* storage blocked */ }
  $("ios-hint").classList.toggle("hidden", !(isIOS && !isStandalone && !isEmbeddedWebView && !dismissed));
}
$("ios-hint-close").addEventListener("click", () => {
  $("ios-hint").classList.add("hidden");
  try { localStorage.setItem("iosHintDismissed", "1"); } catch { /* storage blocked */ }
});

// Close the category dropdown when tapping elsewhere (iOS only reports taps on elements it considers clickable, so listen to touches too)
const closeMulti = e => document.querySelectorAll("details.multi[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; });
document.addEventListener("click", closeMulti);
document.addEventListener("touchstart", closeMulti, { passive: true });
