import { db, configured } from "./firebase.js";
import { initAuth } from "./auth.js";
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { computeSummary, pct, LEVELS, CHECKLIST } from "./calc.js";

const $ = id => document.getElementById(id);
const main = $("main");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const LIMITS = { attendance: 150, movement: 60, findings: 15 };
const TABS = [
  ["institution", "Institution"],
  ["attendance", "Attendance"],
  ["movement", "Movement log"],
  ["records", "Records checklist"],
  ["findings", "Findings"],
  ["summary", "Summary"]
];
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

const STAFF_CATEGORIES = ["Principals", "Regional Staff", "Institute staff", "NSS Personnels", "Voluntary Staff"];

const sortList = arr => [...arr].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
let institutions = sortList(DEFAULT_INSTITUTIONS);
const STATUSES = ["On time", "Late", "Absent", "On leave", "On duty elsewhere"];
const RATINGS = ["Good", "Fair", "Poor"];
const AREAS = [["attendance", "Attendance"], ["punctuality", "Punctuality"], ["movement", "Staff movement control"], ["records", "Quality of records"]];
const ROLES = [["lead", "Lead monitor"], ["member", "Monitoring team member"], ["head", "Head of institution (acknowledgement)"]];

let user = null, state = null, docId = null, tab = "institution";
let profile = { role: "monitor" }, readOnly = false, dashView = "mine";
let saveTimer = null, dirty = false;

/* ---------- blank data ---------- */
const blankAtt = () => ({ name: "", level: "", grade: "", dept: "", signed: "", arrival: "", present: "", status: "", remarks: "" });
const blankMov = () => ({ name: "", level: "", dept: "", left: "", reason: "", destination: "", authorisedBy: "", entered: "", expectedReturn: "", remarks: "" });
const blankFind = () => ({ finding: "", level: "", evidence: "", action: "", officer: "", deadline: "" });
const rep = (n, f) => Array.from({ length: n }, f);

function newInspection() {
  return {
    ownerId: user.uid,
    ownerName: user.displayName || user.email || "",
    createdAt: Date.now(), updatedAt: Date.now(),
    institution: { name: "", location: "", head: "", date: "", type: "", team: "", arrived: "", departed: "", roll: "", startTime: "", categories: [] },
    attendance: rep(10, blankAtt),
    movement: rep(5, blankMov),
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

function normalise(d) {
  const base = newInspection();
  return {
    ...base, ...d,
    institution: { ...base.institution, ...(d.institution || {}), categories: parseCategories(d.institution?.categories) },
    attendance: (d.attendance?.length ? d.attendance : base.attendance)
      .map(r => ({ ...blankAtt(), ...r, signed: yn(r.signed), present: yn(r.present) })),
    movement: (d.movement?.length ? d.movement : base.movement)
      .map(r => ({ ...blankMov(), ...r, entered: yn(r.entered) })),
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
    if (navigator.onLine) {
      await write;
      setStatus("All changes saved");
    } else {
      // Offline: the write is stored locally and sent automatically when back online.
      setStatus("Saved on this device. Will sync when online");
      write.then(() => { if (!dirty) setStatus("All changes saved"); }).catch(console.error);
    }
  } catch (err) {
    dirty = true; setStatus("Save failed");
    console.error(err); toast("Could not save: " + (err.code || err.message));
  }
}
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- user profile, roles, network ---------- */
const isLead = () => profile.role === "lead";

async function loadProfile() {
  profile = { role: "monitor" };
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
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
  $("avatar").textContent = who.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
  $("role-badge").classList.toggle("hidden", !isLead());
}

async function loadInstitutions() {
  institutions = sortList(DEFAULT_INSTITUTIONS);
  try {
    const snap = await getDoc(doc(db, "config", "institutions"));
    if (snap.exists() && Array.isArray(snap.data().list)) institutions = sortList(snap.data().list);
  } catch (e) { console.warn("Could not load institution list (are the Firestore rules published?)", e); }
}

// Saves the shared institution list. Returns true on success, restores the old list on failure.
async function persistInstitutions(list) {
  const previous = institutions;
  institutions = sortList(list);
  try {
    const write = setDoc(doc(db, "config", "institutions"), { list: institutions, updatedAt: Date.now(), updatedBy: user.uid });
    if (navigator.onLine) await write; else write.catch(console.error);
    return true;
  } catch (err) {
    institutions = previous;
    toast("Could not update the institution list: " + (err.code || err.message));
    return false;
  }
}

async function addInstitution() {
  const raw = prompt("Name of the new institution:");
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
  if (!confirm(`Remove "${name}" from the institution list?\n\nChecks already recorded for it are not deleted.`)) return;
  if (await persistInstitutions(institutions.filter(x => x !== name))) { renderTab(); toast("Institution removed from the list"); }
}

function updateNet() { $("offline-badge").classList.toggle("hidden", navigator.onLine); }
window.addEventListener("online", () => { updateNet(); saveNow(); });
window.addEventListener("offline", updateNet);

/* ---------- routing ---------- */
function route() {
  if (!user) return;
  const m = location.hash.match(/^#\/i\/(.+)$/);
  m ? openEditor(m[1]) : showDashboard();
}
window.addEventListener("hashchange", async () => { await saveNow(); route(); });

initAuth(async u => {
  user = u;
  $("config-warning").classList.toggle("hidden", configured);
  $("auth-view").classList.toggle("hidden", !!u);
  $("app-view").classList.toggle("hidden", !u);
  updateNet();
  if (u) { await loadProfile(); await loadInstitutions(); route(); }
  else { state = null; docId = null; profile = { role: "monitor" }; dashView = "mine"; main.innerHTML = ""; }
});

/* ---------- dashboard ---------- */
async function showDashboard() {
  await saveNow();
  state = null; docId = null; readOnly = false;
  main.innerHTML = '<p class="muted pad">Loading…</p>';
  const all = isLead() && dashView === "all";
  try {
    const q = all
      ? collection(db, "inspections")
      : query(collection(db, "inspections"), where("ownerId", "==", user.uid));
    const snap = await getDocs(q);
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const toggle = isLead() ? `<div class="seg inline">
        <button class="seg-btn ${all ? "" : "active"}" data-view="mine">My checks</button>
        <button class="seg-btn ${all ? "active" : ""}" data-view="all">All monitors</button></div>` : "";

    const toneOf = r => (r === null ? "none" : r >= 0.9 ? "good" : r >= 0.75 ? "warn" : "bad");

    const card = i => {
      const own = i.ownerId === user.uid;
      const sum = computeSummary(i);
      const search = [i.institution?.name, i.institution?.location, i.ownerName].join(" ").toLowerCase();
      return `<article class="card tone-${toneOf(sum.attendanceRate)}" data-search="${esc(search)}">
        <div class="card-top">
          <div><h3>${esc(i.institution?.name || "Untitled check")}</h3>
            <p class="muted small">${esc(i.institution?.location || "No district chosen")}</p></div>
          <div class="rate"><b>${pct(sum.attendanceRate)}</b><span>attendance</span></div>
        </div>
        <div class="chips">
          <span>${esc(i.institution?.date ? new Date(i.institution.date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No date")}</span>
          ${i.institution?.type ? `<span class="pill">${esc(i.institution.type)}</span>` : ""}
          ${all ? `<span>by ${esc(own ? "you" : (i.ownerName || "unknown"))}</span>` : ""}
        </div>
        <div class="mini">
          <div><b>${sum.listed}</b>staff listed</div>
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
    const rates = items.map(i => computeSummary(i).attendanceRate).filter(r => r !== null);
    const avg = rates.length ? rates.reduce((x, y) => x + y, 0) / rates.length : null;
    const places = new Set(items.map(i => i.institution?.name).filter(Boolean)).size;
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const lede = items.length
      ? `${plural(items.length, "check")} ${all ? "from all monitors" : "recorded"} across ${plural(places, "institution")}.${avg !== null ? ` Average attendance ${pct(avg)}.` : ""}`
      : "Record your first institution check to see results here.";

    main.innerHTML = `
      <div class="page-head">
        <div><h2>${esc(greeting)}${first ? ", " + esc(first) : ""}</h2><p class="muted">${esc(lede)}</p></div>
        <div class="head-actions">${toggle}<button class="btn primary" data-action="new">+ New check</button></div>
      </div>
      ${all ? `<input id="filter" class="filter" type="search" placeholder="Filter by institution, district or monitor…">` : ""}
      ${items.length ? `<div class="cards" id="cards">${items.map(card).join("")}</div>`
        : `<div class="empty"><h3>No checks yet</h3><p class="muted">Start a check when you arrive at an institution. It saves as you type.</p>
           <button class="btn primary" data-action="new">+ Start your first check</button></div>`}`;
  } catch (err) {
    console.error(err);
    main.innerHTML = `<p class="error pad">Could not load checks: ${esc(err.code || err.message)}.<br>
      Check that Firestore is created and the security rules are published (see README).</p>`;
  }
}

async function createInspection() {
  try {
    const ref = doc(collection(db, "inspections"));   // id is generated locally, so this also works offline
    const write = setDoc(ref, newInspection());
    if (navigator.onLine) await write; else write.catch(console.error);
    location.hash = `#/i/${ref.id}`;
  } catch (err) { toast("Could not create check: " + (err.code || err.message)); }
}

async function deleteInspection(id) {
  if (!confirm("Delete this check permanently? This cannot be undone.")) return;
  try {
    const del = deleteDoc(doc(db, "inspections", id));
    if (navigator.onLine) await del; else del.catch(console.error);
    toast("Deleted"); showDashboard();
  } catch (err) { toast("Could not delete: " + (err.code || err.message)); }
}

/* ---------- editor ---------- */
async function openEditor(id) {
  await saveNow();
  main.innerHTML = '<p class="muted pad">Loading…</p>';
  try {
    const snap = await getDoc(doc(db, "inspections", id));
    const data = snap.exists() ? snap.data() : null;
    if (!data || (data.ownerId !== user.uid && !isLead())) {
      main.innerHTML = '<p class="pad">Check not found. <a href="#/">Back to list</a></p>'; return;
    }
    docId = id; state = normalise(data); dirty = false; tab = "institution";
    readOnly = data.ownerId !== user.uid;   // leads can view other monitors' checks but not edit them
    renderEditor();
  } catch (err) {
    main.innerHTML = `<p class="error pad">Could not open check: ${esc(err.code || err.message)} <a href="#/">Back</a></p>`;
  }
}

const filled = v => String(v ?? "").trim() !== "";
function tabDone(k) {
  if (!state) return false;
  return ({
    institution: () => filled(state.institution.name) && filled(state.institution.date),
    attendance: () => state.attendance.some(r => filled(r.name)),
    movement: () => state.movement.some(r => filled(r.name)),
    records: () => state.records.some(r => filled(r.response)),
    findings: () => state.findings.some(r => filled(r.finding)),
    summary: () => false
  })[k]();
}
function updateTabDots() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("done", tabDone(b.dataset.tab)));
}

function renderEditor() {
  main.innerHTML = `
    <div class="editor-head">
      <a href="#/" class="btn small">← All checks</a>
      <h2 id="title">${esc(state.institution.name || "Untitled check")}</h2>
      <span id="save-status" class="muted small">${readOnly ? "" : "All changes saved"}</span>
      <button class="btn small" data-action="export">Export Excel</button>
    </div>
    ${readOnly ? `<p class="banner-ro">Read-only view of a check recorded by <b>${esc(state.ownerName || "another monitor")}</b>.</p>` : ""}
    <nav class="tabs" id="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}${tabDone(k) ? " done" : ""}">${k === "summary" ? "" : '<i class="dot"></i>'}${l}</button>`).join("")}</nav>
    <div id="tab-body" class="panel"></div>`;
  renderTab();
}

function renderTab() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const body = $("tab-body");
  body.innerHTML = { institution: tInstitution, attendance: tAttendance, movement: tMovement, records: tRecords, findings: tFindings, summary: tSummary }[tab]();
  if (readOnly) body.querySelectorAll("input, select, textarea, button").forEach(el => {
    if (!el.dataset.action) el.disabled = true;   // keep the Print button on the Summary tab working
  });
}

function tInstitution() {
  const i = state.institution;
  const f = (label, key, type = "text") => `<label>${label}${inp("institution." + key, i[key], type)}</label>`;
  const listed = (list, val, placeholder) =>
    `<option value="">${placeholder}</option>` + list.map(o => `<option${o === val ? " selected" : ""}>${esc(o)}</option>`).join("") +
    (val && !list.includes(val) ? `<option value="${esc(val)}" selected>${esc(val)} (not in list)</option>` : "");
  const cats = i.categories || [];
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
      ${f("Official start time", "startTime", "time")}
    </div>
  </section>
  <section class="section">
    <h3>Staff <small>Who the check covers</small></h3>
    <div class="grid">
      ${f("Total staff on nominal roll", "roll", "number")}
      <div class="field">
        <span>Staff categories covered</span>
        <details class="multi">
          <summary id="cats-summary">${esc(cats.length ? cats.join(", ") : "Select categories…")}</summary>
          <div class="multi-list">${STAFF_CATEGORIES.map(c => `<label class="check">
            <input type="checkbox" data-multi="institution.categories" value="${esc(c)}"${cats.includes(c) ? " checked" : ""}> ${esc(c)}</label>`).join("")}</div>
        </details>
      </div>
    </div>
  </section>`;
}

function tAttendance() {
  const rows = state.attendance.map((r, n) => `<tr data-row="${n}">
    <td class="num">${n + 1}</td>
    <td>${inp(`attendance.${n}.name`, r.name)}</td>
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
    <div class="scroll"><table class="grid-table"><thead><tr>
      <th>No.</th><th>Name of staff</th><th>Level</th><th>Grade</th><th>Unit / Dept</th><th>Signed register?</th>
      <th>Arrival (hh:mm)</th><th>Physically present?</th><th>Status</th><th>Remarks</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <button class="btn" data-add="attendance">+ Add row (${state.attendance.length}/${LIMITS.attendance})</button>`;
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
    <div class="scroll"><table class="grid-table"><thead><tr>
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
    <div class="scroll"><table class="grid-table"><thead><tr><th>No.</th><th>Item to verify</th><th>Response</th><th>Remarks</th></tr></thead>
    <tbody>${rows}</tbody><tbody id="records-footer">${recordsFooter()}</tbody></table></div>`;
}

function tFindings() {
  const rows = state.findings.map((r, n) => `<tr>
    <td class="num">${n + 1}</td>
    <td>${inp(`findings.${n}.finding`, r.finding)}</td>
    <td><select data-path="findings.${n}.level">${opts([...LEVELS, "All levels"], r.level)}</select></td>
    <td>${inp(`findings.${n}.evidence`, r.evidence)}</td>
    <td>${inp(`findings.${n}.action`, r.action)}</td>
    <td>${inp(`findings.${n}.officer`, r.officer)}</td>
    <td>${inp(`findings.${n}.deadline`, r.deadline, "date")}</td>
    <td><button class="icon" title="Remove row" data-del="findings.${n}">✕</button></td></tr>`).join("");
  const areas = AREAS.map(([k, l]) => `<tr><td>${l}</td>
    <td>${sel(`assessment.${k}.rating`, RATINGS, state.assessment[k].rating)}</td>
    <td>${inp(`assessment.${k}.comment`, state.assessment[k].comment)}</td></tr>`).join("");
  const sign = ROLES.map(([k, l]) => `<tr><td>${l}</td>
    <td>${inp(`signoff.${k}.name`, state.signoff[k].name)}</td>
    <td>${inp(`signoff.${k}.signature`, state.signoff[k].signature)}</td>
    <td>${inp(`signoff.${k}.date`, state.signoff[k].date, "date")}</td></tr>`).join("");
  return `<h3>Findings and recommendations</h3>
    <p class="muted small">Complete at the exit meeting and share a copy with the head of institution.</p>
    <div class="scroll"><table class="grid-table"><thead><tr><th>No.</th><th>Finding</th><th>Staff level affected</th><th>Evidence</th><th>Recommended action</th><th>Responsible officer</th><th>Deadline</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <button class="btn" data-add="findings">+ Add finding (${state.findings.length}/${LIMITS.findings})</button>
    <h3>Overall assessment</h3>
    <div class="scroll"><table class="grid-table"><thead><tr><th>Area</th><th>Rating</th><th>Comment</th></tr></thead><tbody>${areas}</tbody></table></div>
    <h3>Sign-off</h3>
    <div class="scroll"><table class="grid-table"><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody>${sign}</tbody></table></div>`;
}

function tSummary() {
  const s = computeSummary(state), i = state.institution;
  const toneOf = r => (r === null ? "none" : r >= 0.9 ? "good" : r >= 0.75 ? "warn" : "bad");
  const r = (l, v) => `<tr><td>${l}</td><td class="val">${esc(v)}</td></tr>`;

  const kpi = (label, rate, sub) => `<div class="kpi tone-${toneOf(rate)}">
    <div class="ring-wrap"><div class="ring" style="--p:${rate === null ? 0 : Math.round(rate * 1000) / 10}"></div><span>${pct(rate)}</span></div>
    <div><b>${label}</b><p class="muted small">${sub}</p></div></div>`;

  const segs = [["On time", s.onTime, "good"], ["Late", s.late, "warn"], ["Absent without approval", s.absent, "bad"], ["Absent with approval", s.approved, "info"]];
  const bar = s.listed
    ? segs.filter(x => x[1]).map(([l, n, t]) => `<i class="fill-${t}" style="flex:${n}" title="${l}: ${n}"></i>`).join("")
    : '<i class="fill-none" style="flex:1"></i>';

  const flag = (n, label) => `<div class="flag${n > 0 ? " raised" : ""}"><b>${n}</b><span>${label}</span></div>`;

  const lv = s.byLevel.map(x => `<tr><td>${x.level}</td><td>${x.listed}</td><td>${x.present}</td><td>${x.late}</td><td>${x.absent}</td>
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
    </div>

    <div class="two-col">
      <table class="grid-table"><tbody>
        <tr class="sec"><td colspan="2">Institution</td></tr>
        ${r("Staff on nominal roll (as entered)", i.roll || "—")}
        ${r("Staff categories covered", (i.categories || []).join(", ") || "—")}
        <tr class="sec"><td colspan="2">Attendance</td></tr>
        ${r("Staff listed on attendance sheet", s.listed)}${r("Present on time", s.onTime)}${r("Present but late", s.late)}
        ${r("Absent with approval (leave or on duty elsewhere)", s.approved)}${r("Absent without approval", s.absent)}
        <tr class="sec"><td colspan="2">Staff movement</td></tr>
        ${r("Staff found out of office", s.movementListed)}${r("Not entered in movement book", s.notInBook)}
      </tbody></table>
      <div><h4 style="margin-bottom:10px">By staff level</h4>
      <div class="scroll" style="max-height:none;margin-top:0"><table class="grid-table"><thead><tr><th>Level</th><th>Listed</th><th>Present</th><th>Late</th><th>Absent</th><th>Attendance rate</th></tr></thead><tbody>${lv}</tbody></table></div>
      <p class="muted small">Present means On time or Late. Absent means without approval. Staff with no Level selected are not counted here.</p></div>
    </div>`;
}

/* ---------- events ---------- */
main.addEventListener("input", e => {
  if (e.target.id === "filter") {
    const term = e.target.value.trim().toLowerCase();
    document.querySelectorAll("#cards .card").forEach(c => c.classList.toggle("hidden", !c.dataset.search.includes(term)));
    return;
  }
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

  if (path === "institution.name") $("title").textContent = el.value || "Untitled check";

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

main.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t) return;

  if (t.dataset.tab) { tab = t.dataset.tab; return renderTab(); }
  if (t.dataset.inst === "add") return addInstitution();
  if (t.dataset.inst === "del") return deleteInstitution();
  if (t.dataset.view) { dashView = t.dataset.view; return showDashboard(); }

  if (t.dataset.action === "new") return createInspection();
  if (t.dataset.action === "delete") return deleteInspection(t.dataset.id);
  if (t.dataset.action === "print") return window.print();
  if (t.dataset.action === "export") return exportXlsx();

  if (t.dataset.add) {
    const k = t.dataset.add;
    if (state[k].length >= LIMITS[k]) return toast(`Maximum of ${LIMITS[k]} rows reached.`);
    state[k].push({ attendance: blankAtt, movement: blankMov, findings: blankFind }[k]());
    scheduleSave(); updateTabDots(); return renderTab();
  }
  if (t.dataset.del) {
    const [k, n] = t.dataset.del.split(".");
    if (state[k].length <= 1) return toast("At least one row must remain.");
    const row = state[k][n];
    const hasData = Object.values(row).some(v => String(v).trim() !== "");
    if (hasData && !confirm("Remove this row and its data?")) return;
    state[k].splice(Number(n), 1);
    scheduleSave(); updateTabDots(); renderTab();
  }
});

/* ---------- Excel export ---------- */
function exportXlsx() {
  if (typeof XLSX === "undefined") return toast("Excel library failed to load.");
  const d = state, i = d.institution, s = computeSummary(d);
  const wb = XLSX.utils.book_new();
  const add = (name, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  const used = (arr, k = "name") => arr.filter(r => String(r[k]).trim() !== "");

  add("Institution Details", [["Field", "Entry"],
    ["Name of institution", i.name], ["Location / district", i.location], ["Head of institution", i.head],
    ["Date of check", i.date], ["Type of check", i.type], ["Monitoring team members", i.team],
    ["Time team arrived / departed", `${i.arrived} / ${i.departed}`], ["Total staff on nominal roll", i.roll],
    ["Official start time", i.startTime], ["Staff categories covered", (i.categories || []).join(", ")]]);

  add("Attendance Sheet", [["No.", "Name of staff", "Level", "Grade", "Unit / Dept", "Signed register?", "Arrival time", "Physically present?", "Status", "Remarks"],
    ...used(d.attendance).map((r, n) => [n + 1, r.name, r.level, r.grade, r.dept, r.signed, r.arrival, r.present, r.status, r.remarks])]);

  add("Movement Log", [["No.", "Name of staff", "Level", "Department", "Time left office", "Reason given", "Destination", "Authorised by", "Entered in movement book?", "Expected return", "Remarks"],
    ...used(d.movement).map((r, n) => [n + 1, r.name, r.level, r.dept, r.left, r.reason, r.destination, r.authorisedBy, r.entered, r.expectedReturn, r.remarks])]);

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
    ["Institution", i.name], ["Date of check", i.date], ["Type of check", i.type], ["Staff on nominal roll", i.roll], [],
    ["Staff listed on attendance sheet", s.listed], ["Present on time", s.onTime], ["Present but late", s.late],
    ["Absent with approval", s.approved], ["Absent without approval", s.absent], ["Signed register but not physically present", s.signedNotPresent],
    ["Attendance rate", pct(s.attendanceRate)], ["Punctuality rate", pct(s.punctualityRate)], [],
    ["Staff found out of office", s.movementListed], ["Not entered in movement book", s.notInBook], [],
    ["Records compliance rate", pct(s.complianceRate)], [],
    ["Level", "Listed", "Present", "Late", "Absent (no approval)", "Attendance rate"],
    ...s.byLevel.map(x => [x.level, x.listed, x.present, x.late, x.absent, pct(x.rate)])]);

  const safe = (i.name || "check").replace(/[^\w-]+/g, "_");
  XLSX.writeFile(wb, `Attendance_Check_${safe}_${i.date || "undated"}.xlsx`);
}
