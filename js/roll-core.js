// Pure logic for the HR nominal roll: reading the workbook, matching names, cross-checking an attendance list.
// No browser or Firebase code in here, so it can be unit-tested in Node (see tests/roll-core.test.mjs).

// "BIRIWATECHNICAL" and "Biriwa Technical" must be the same institution, so keys ignore case, spaces and punctuation.
export const rollKey = name => String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const clean = s => String(s ?? "").replace(/\s+/g, " ").trim();
const isBlankNo = s => s === "" || /^n\/?a$/i.test(s);

/* ---------- reading the HR workbook ---------- */
// One sheet per institution. Column headings vary between sheets (EMPLOYEE NO / EMPLOYEENO / EMPLOYEE NO.),
// and some sheets have shifted or missing columns, so columns are found by heading and "on leave" is found by scanning the row.
// Only what the cross-check needs is kept. Bank accounts, SSNIT and Ghana Card numbers, dates of birth and phone numbers are NOT stored.
export function parseRollWorkbook(XLSX, wb, knownInstitutions = []) {
  const known = new Map(knownInstitutions.map(n => [rollKey(n), n]));
  const sheets = [];
  const seen = new Map();   // employee number -> sheets it appears on

  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "", raw: true });
    if (rows.length < 2) continue;
    const head = rows[0].map(h => String(h).toUpperCase().replace(/[^A-Z]/g, ""));
    const find = (...names) => head.findIndex(h => names.includes(h));
    const iName = find("FULLNAME", "NAME", "STAFFNAME");
    const iNo = find("EMPLOYEENO", "EMPLOYEENUMBER", "STAFFID");
    const iJob = find("JOB", "RANK", "POSITION", "DESIGNATION");
    if (iName < 0) continue;

    const staff = [];
    for (const r of rows.slice(1)) {
      const name = clean(r[iName]);
      if (!name) continue;
      const no = iNo >= 0 ? clean(r[iNo]) : "";
      const job = clean(iJob >= 0 ? r[iJob] : "").replace(/^[.\s]+/, "").slice(0, 90);
      const onLeave = r.some((c, i) => i !== iName && /^\s*on\s+leave\s*$/i.test(String(c)));
      staff.push({ no, name, job, post: onLeave ? "On leave" : "At post" });
      if (!isBlankNo(no)) seen.set(no, [...(seen.get(no) || []), sheet]);
    }
    if (!staff.length) continue;

    const key = rollKey(sheet);
    const listName = known.get(key);
    sheets.push({
      sheet, key, institution: listName || clean(sheet).toUpperCase(), inList: !!listName,
      staff, count: staff.length, onLeave: staff.filter(s => s.post === "On leave").length
    });
  }

  const duplicates = [...seen.entries()].filter(([, where]) => where.length > 1).map(([no, where]) => ({ no, where }));
  return { sheets, total: sheets.reduce((n, s) => n + s.count, 0), duplicates };
}

/* ---------- matching names ---------- */
// Names are written in different orders and cases ("ASAMOAH HANNAH" / "Hannah Asamoah"), so compare the set of words.
const words = s => clean(s).toLowerCase().replace(/[^a-z]+/g, " ").split(" ").filter(Boolean);

export function prepareRoll(staff) {
  return (staff || []).map(s => {
    const w = words(s.name);
    return { ...s, _w: new Set(w), _k: [...w].sort().join(" ") };
  });
}

// Returns the roll entry a typed name refers to, or null. Needs at least two words so "Mensah" alone never matches.
// Exact (any order) wins; otherwise every word of the shorter name must appear in the longer one (e.g. a missing middle name).
export function matchStaff(name, prepared) {
  const w = words(name);
  if (w.length < 2 || !prepared?.length) return null;
  const key = [...w].sort().join(" ");
  const exact = prepared.find(s => s._k === key);
  if (exact) return exact;
  const mine = new Set(w);
  let best = null, bestScore = 0;
  for (const s of prepared) {
    let common = 0;
    for (const x of mine) if (s._w.has(x)) common++;
    if (common >= 2 && (common === mine.size || common === s._w.size)) {
      const score = common * 10 - Math.abs(mine.size - s._w.size);
      if (score > bestScore) { best = s; bestScore = score; }
    }
  }
  return best;
}

/* ---------- cross-check ---------- */
// attendance: the monitor's rows. prepared: prepareRoll(staff).
export function crossCheck(attendance, prepared) {
  const byStaff = new Map();    // index in the roll -> the attendance row that covers them
  const notOnRoll = [];         // names typed in the attendance list that are not on the roll
  const duplicates = [];        // a roll member entered on two rows
  (attendance || []).forEach(row => {
    const name = clean(row.name);
    if (!name) return;
    const hit = matchStaff(name, prepared);
    if (!hit) { notOnRoll.push(name); return; }
    const idx = prepared.indexOf(hit);
    if (byStaff.has(idx)) duplicates.push(name); else byStaff.set(idx, row);
  });
  const total = prepared.length;
  return {
    total,
    matched: byStaff.size,
    notChecked: total - byStaff.size,
    coverage: total === 0 ? null : byStaff.size / total,
    byStaff, notOnRoll, duplicates
  };
}
