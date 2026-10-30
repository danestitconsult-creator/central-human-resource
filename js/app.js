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
const STATUSES = ["On time", "Late", "Absent", "On leave", "On duty elsewhere"];
const RATINGS = ["Good", "Fair", "Poor"];
const AREAS = [["attendance", "Attendance"], ["punctuality", "Punctuality"], ["movement", "Staff movement control"], ["records", "Quality of records"]];
const ROLES = [["lead", "Lead monitor"], ["member", "Monitoring team member"], ["head", "Head of institution (acknowledgement)"]];

let user = null, state = null, docId = null, tab = "institution";
let profile = { role: "monitor" }, readOnly = false, dashView = "mine";
let saveTimer = null, dirty = false;

/* ---------- blank data ---------- */
const blankAtt = () => ({ name: "", level: "", dept: "", signed: "", arrival: "", present: "", status: "", remarks: "" });
const blankMov = () => ({ name: "", level: "", dept: "", left: "", reason: "", destination: "", authorisedBy: "", entered: "", expectedReturn: "", remarks: "" });
const blankFind = () => ({ finding: "", level: "", evidence: "", action: "", officer: "", deadline: "" });
const rep = (n, f) => Array.from({ length: n }, f);

function newInspection() {
  return {
    ownerId: user.uid,
    ownerName: user.displayName || user.email || "",
    createdAt: Date.now(), updatedAt: Date.now(),
    institution: { name: "", location: "", head: "", date: "", type: "", team: "", arrived: "", departed: "", roll: "", startTime: "", categories: "" },
    attendance: rep(10, blankAtt),
    movement: rep(5, blankMov),
    records: CHECKLIST.map(() => ({ response: "", remarks: "" })),
    findings: rep(3, blankFind),
    assessment: Object.fromEntries(AREAS.map(([k]) => [k, { rating: "", comment: "" }])),
    signoff: Object.fromEntries(ROLES.map(([k]) => [k, { name: "", signature: "", date: "" }]))
  };
}

// Make sure documents loaded from Firestore always have every field
function normalise(d) {
  const base = newInspection();
  return {
    ...base, ...d,
    institution: { ...base.institution, ...(d.institution || {}) },
    attendance: d.attendance?.length ? d.attendance : base.attendance,
    movement: d.movement?.length ? d.movement : base.movement,
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
const sel = (path, list, val) => `<select data-path="${path}">${opts(list, val)}</select>`;
const YN = ["Y", "N"];

function setByPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}
const getByPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

/* ---------- saving ---------- */
function setStatus(text) { const s = $("save-status"); if (s) s.textContent = text; }

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
  $("user-label").textContent = user.displayName || user.email;
  $("role-badge").classList.toggle("hidden", !isLead());
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
  if (u) { await loadProfile(); route(); }
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

    const card = i => {
      const own = i.ownerId === user.uid;
      const search = [i.institution?.name, i.institution?.location, i.ownerName].join(" ").toLowerCase();
      return `<article class="card" data-search="${esc(search)}">
        <h3>${esc(i.institution?.name || "Untitled check")}</h3>
        <p class="muted">${esc(i.institution?.location || "No location")}</p>
        <p class="meta"><span>${esc(i.institution?.date || "No date")}</span>
          ${i.institution?.type ? `<span class="pill">${esc(i.institution.type)}</span>` : ""}</p>
        ${all ? `<p class="small">Monitor: <b>${esc(own ? "You" : (i.ownerName || "Unknown"))}</b></p>` : ""}
        <p class="muted small">Updated ${new Date(i.updatedAt || 0).toLocaleString()}</p>
        <div class="row-actions">
          <a class="btn small primary" href="#/i/${i.id}">${own ? "Open" : "View"}</a>
          ${own ? `<button class="btn small danger" data-action="delete" data-id="${i.id}">Delete</button>` : ""}
        </div></article>`;
    };

    main.innerHTML = `
      <div class="page-head">
        <h2>${all ? "All institution checks" : "My institution checks"}</h2>
        <div class="head-actions">${toggle}<button class="btn primary" data-action="new">+ New check</button></div>
      </div>
      ${all ? `<input id="filter" class="filter" type="search" placeholder="Filter by institution, location or monitor…">` : ""}
      ${items.length ? `<div class="cards" id="cards">${items.map(card).join("")}</div>`
        : '<div class="empty"><p>No checks yet.</p><p class="muted">Click <b>New check</b> to record your first institution visit.</p></div>'}`;
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

function renderEditor() {
  main.innerHTML = `
    <div class="editor-head">
      <a href="#/" class="btn small">← All checks</a>
      <h2 id="title">${esc(state.institution.name || "Untitled check")}</h2>
      <span id="save-status" class="muted small">${readOnly ? "" : "All changes saved"}</span>
      <button class="btn small" data-action="export">Export Excel</button>
    </div>
    ${readOnly ? `<p class="banner-ro">Read-only view of a check recorded by <b>${esc(state.ownerName || "another monitor")}</b>.</p>` : ""}
    <nav class="tabs" id="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}">${l}</button>`).join("")}</nav>
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
  return `<h3>Institution details</h3><div class="grid">
    ${f("Name of institution", "name")}
    ${f("Location / district", "location")}
    ${f("Head of institution", "head")}
    ${f("Date of check", "date", "date")}
    <label>Type of check<select data-path="institution.type">${opts(CHECK_TYPES, i.type)}</select></label>
    ${f("Monitoring team members", "team")}
    ${f("Time team arrived", "arrived", "time")}
    ${f("Time team departed", "departed", "time")}
    ${f("Total staff on nominal roll", "roll", "number")}
    ${f("Official start time", "startTime", "time")}
    <label class="wide">Staff categories covered<textarea data-path="institution.categories" rows="2">${esc(i.categories)}</textarea></label>
  </div>`;
}

function tAttendance() {
  const rows = state.attendance.map((r, n) => `<tr data-row="${n}">
    <td class="num">${n + 1}</td>
    <td>${inp(`attendance.${n}.name`, r.name)}</td>
    <td>${sel(`attendance.${n}.level`, LEVELS, r.level)}</td>
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
      <th>No.</th><th>Name of staff</th><th>Level</th><th>Unit / Dept</th><th>Signed register?</th>
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
  const r = (l, v) => `<tr><td>${l}</td><td class="val">${esc(v)}</td></tr>`;
  const lv = s.byLevel.map(x => `<tr><td>${x.level}</td><td>${x.listed}</td><td>${x.present}</td><td>${x.late}</td><td>${x.absent}</td><td>${pct(x.rate)}</td></tr>`).join("");
  return `<div class="page-head"><h3>Summary for this institution</h3><button class="btn small" data-action="print">Print</button></div>
    <p class="muted small">Calculated automatically from the other tabs.</p>
    <div class="two-col">
      <table class="grid-table"><tbody>
        <tr class="sec"><td colspan="2">Institution</td></tr>
        ${r("Institution", i.name || "—")}${r("Date of check", i.date || "—")}${r("Type of check", i.type || "—")}${r("Staff on nominal roll (as entered)", i.roll || "—")}
        <tr class="sec"><td colspan="2">Attendance</td></tr>
        ${r("Staff listed on attendance sheet", s.listed)}${r("Present on time", s.onTime)}${r("Present but late", s.late)}
        ${r("Absent with approval (leave / on duty elsewhere)", s.approved)}${r("Absent without approval", s.absent)}
        ${r("Signed register but not physically present", s.signedNotPresent)}
        ${r("Attendance rate (present / listed)", pct(s.attendanceRate))}${r("Punctuality rate (on time / present)", pct(s.punctualityRate))}
        <tr class="sec"><td colspan="2">Staff movement</td></tr>
        ${r("Staff found out of office", s.movementListed)}${r("Not entered in movement book", s.notInBook)}
        <tr class="sec"><td colspan="2">Records</td></tr>
        ${r("Records compliance rate", pct(s.complianceRate))}
      </tbody></table>
      <div><h4>By staff level</h4>
      <table class="grid-table"><thead><tr><th>Level</th><th>Listed</th><th>Present</th><th>Late</th><th>Absent (no approval)</th><th>Attendance rate</th></tr></thead><tbody>${lv}</tbody></table>
      <p class="muted small">"Present" = status On time or Late. "Absent with approval" = On leave or On duty elsewhere. Staff without a Level selected are not in the level table.</p></div>
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
  if (!path || !state) return;
  setByPath(state, path, el.value);

  if (path === "institution.name") $("title").textContent = el.value || "Untitled check";

  // Auto-suggest On time / Late from arrival time vs official start time
  const m = path.match(/^attendance\.(\d+)\.arrival$/);
  if (m && el.value && state.institution.startTime) {
    const row = state.attendance[m[1]];
    if (!row.status || row.status === "On time" || row.status === "Late") {
      row.status = el.value > state.institution.startTime ? "Late" : "On time";
      const s = main.querySelector(`[data-path="attendance.${m[1]}.status"]`);
      if (s) s.value = row.status;
    }
    if (!row.present) {
      row.present = "Y";
      const p = main.querySelector(`[data-path="attendance.${m[1]}.present"]`);
      if (p) p.value = "Y";
    }
  }
  if (path.startsWith("records.")) $("records-footer").innerHTML = recordsFooter();
  scheduleSave();
});

main.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t) return;

  if (t.dataset.tab) { tab = t.dataset.tab; return renderTab(); }
  if (t.dataset.view) { dashView = t.dataset.view; return showDashboard(); }

  if (t.dataset.action === "new") return createInspection();
  if (t.dataset.action === "delete") return deleteInspection(t.dataset.id);
  if (t.dataset.action === "print") return window.print();
  if (t.dataset.action === "export") return exportXlsx();

  if (t.dataset.add) {
    const k = t.dataset.add;
    if (state[k].length >= LIMITS[k]) return toast(`Maximum of ${LIMITS[k]} rows reached.`);
    state[k].push({ attendance: blankAtt, movement: blankMov, findings: blankFind }[k]());
    scheduleSave(); return renderTab();
  }
  if (t.dataset.del) {
    const [k, n] = t.dataset.del.split(".");
    if (state[k].length <= 1) return toast("At least one row must remain.");
    const row = state[k][n];
    const hasData = Object.values(row).some(v => String(v).trim() !== "");
    if (hasData && !confirm("Remove this row and its data?")) return;
    state[k].splice(Number(n), 1);
    scheduleSave(); renderTab();
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
    ["Official start time", i.startTime], ["Staff categories covered", i.categories]]);

  add("Attendance Sheet", [["No.", "Name of staff", "Level", "Unit / Dept", "Signed register? (Y/N)", "Arrival time", "Physically present? (Y/N)", "Status", "Remarks"],
    ...used(d.attendance).map((r, n) => [n + 1, r.name, r.level, r.dept, r.signed, r.arrival, r.present, r.status, r.remarks])]);

  add("Movement Log", [["No.", "Name of staff", "Level", "Department", "Time left office", "Reason given", "Destination", "Authorised by", "Entered in movement book? (Y/N)", "Expected return", "Remarks"],
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
