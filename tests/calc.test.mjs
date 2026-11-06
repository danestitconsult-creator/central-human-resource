import assert from "node:assert/strict";
import { computeSummary, pct, LEVELS, CHECKLIST } from "../js/calc.js";

let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; }; const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); n++; };
const att = (name, level, status, signed = "", present = "") => ({ name, level, status, signed, present, arrival: "" });

// ---- worked example, every figure checked by hand
const d = {
  attendance: [
    att("A", "Management", "On time"), att("B", "Management", "Late"), att("C", "Senior", "On time"), att("D", "Senior", "Absent"),
    att("E", "Junior", "On leave"), att("F", "Junior", "On duty elsewhere"), att("G", "Support", "Late"), att("H", "Support", "On time"),
    att("I", "", "On time"),                 // no level chosen
    att("J", "Junior", ""),                  // no status chosen
    att("", "Senior", "Absent"),             // blank name: ignored everywhere
    att("K", "Junior", "On time", "Yes", "No"), att("", "", "", "Yes", "No")   // the second one has no name: must not be counted as signed-but-absent
  ],
  movement: [{ name: "M1", entered: "No" }, { name: "M2", entered: "Yes" }, { name: "", entered: "No" }],
  records: CHECKLIST.map((_, i) => ({ response: i < 6 ? "Yes" : i < 8 ? "No" : i < 10 ? "N/A" : "" }))
};
const s = computeSummary(d);
eq([s.listed, s.onTime, s.late, s.absent, s.approved, s.unmarked], [11, 5, 2, 1, 2, 1], "A..K are listed (11); one has no status");
eq(s.onTime + s.late + s.absent + s.approved + s.unmarked, s.listed, "status counts add up to everyone listed");
near(s.attendanceRate, 7 / 11, "attendance = (on time + late) / listed");
near(s.punctualityRate, 5 / 7, "punctuality = on time / (on time + late)");
eq(s.signedNotPresent, 1, "only the named row"); eq(s.movementListed, 2); eq(s.notInBook, 1, "the unnamed movement row is ignored");
eq([s.recordsYes, s.recordsNo], [6, 2]); near(s.complianceRate, 6 / 8, "N/A and blanks are left out of compliance");
// the level table adds up to everyone listed
const sum = k => [...s.byLevel, s.noLevel].reduce((t, x) => t + x[k], 0);
eq([sum("listed"), sum("present"), sum("late"), sum("absent")], [s.listed, s.onTime + s.late, s.late, s.absent], "level rows (plus 'level not selected') add up to the overall figures");
eq(s.noLevel.listed, 1); eq(s.byLevel.find(x => x.level === "Junior").listed, 4);
near(s.byLevel.find(x => x.level === "Management").rate, 1, "both management staff present");

// ---- empty and awkward input
const e = computeSummary({});
eq([e.listed, e.attendanceRate, e.punctualityRate, e.complianceRate, e.notInBook, e.unmarked], [0, null, null, null, 0, 0]);
eq(pct(null), "—"); eq(pct(0), "0%"); eq(pct(1), "100%"); eq(pct(7 / 11), "63.6%"); eq(pct(0.5), "50%");

// ---- random data: the invariants must always hold
let seed = 987; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
for (let r = 0; r < 300; r++) {
  const dd = {
    attendance: Array.from({ length: Math.floor(rnd() * 40) }, (_, i) => att(rnd() < 0.15 ? "" : "S" + i, pick([...LEVELS, ""]), pick(["On time", "Late", "Absent", "On leave", "On duty elsewhere", ""]), pick(["Yes", "No", ""]), pick(["Yes", "No", ""]))),
    movement: Array.from({ length: Math.floor(rnd() * 8) }, (_, i) => ({ name: rnd() < 0.2 ? "" : "M" + i, entered: pick(["Yes", "No", ""]) })),
    records: CHECKLIST.map(() => ({ response: pick(["Yes", "No", "N/A", ""]) }))
  };
  const x = computeSummary(dd), named = dd.attendance.filter(a => a.name.trim());
  eq(x.listed, named.length); eq(x.onTime + x.late + x.absent + x.approved + x.unmarked, x.listed, `round ${r}`);
  ok(x.unmarked >= 0, "unmarked never negative");
  const tot = k => [...x.byLevel, x.noLevel].reduce((t, y) => t + y[k], 0);
  eq([tot("listed"), tot("present"), tot("late"), tot("absent")], [x.listed, x.onTime + x.late, x.late, x.absent], `round ${r}: level table adds up`);
  for (const rate of [x.attendanceRate, x.punctualityRate, x.complianceRate, ...x.byLevel.map(y => y.rate)]) ok(rate === null || (rate >= 0 && rate <= 1), "rate in 0..1");
  eq(x.signedNotPresent, named.filter(a => a.signed === "Yes" && a.present === "No").length);
  eq(x.notInBook, dd.movement.filter(m => m.name.trim() && m.entered === "No").length);
  eq([x.recordsYes, x.recordsNo], [dd.records.filter(y => y.response === "Yes").length, dd.records.filter(y => y.response === "No").length]);
}
console.log(`${n} summary checks passed`);
