// Run with: node tests/roll-core.test.mjs [path/to/rows.json]
// With a JSON dump of the real workbook it prints the import summary; without one it runs the built-in checks only.
import { parseRollWorkbook, prepareRoll, matchStaff, crossCheck, rollKey } from "../js/roll-core.js";
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";

// --- matching ---
const roll = prepareRoll([
  { no: "1", name: "ASAMOAH HANNAH ", job: "Principal", post: "At post" },
  { no: "2", name: "Armah-Sam Jean Pierre", job: "Manager", post: "At post" },
  { no: "3", name: "Mensah Yvonne", job: "Admin", post: "On leave" },
  { no: "4", name: "Mensah Yvonne Abena", job: "Tutor", post: "At post" }
]);
assert.equal(matchStaff("hannah asamoah", roll)?.no, "1", "order and case do not matter");
assert.equal(matchStaff("Armah Sam Jean-Pierre", roll)?.no, "2", "hyphens do not matter");
assert.equal(matchStaff("Mensah Yvonne", roll)?.no, "3", "exact beats partial");
assert.equal(matchStaff("Mensah", roll), null, "one word never matches");
assert.equal(matchStaff("Kofi Boateng", roll), null, "unknown name");
const cc = crossCheck([{ name: "Hannah Asamoah" }, { name: "Hannah Asamoah" }, { name: "Nobody Here" }, { name: "" }], roll);
assert.equal(cc.total, 4); assert.equal(cc.matched, 1); assert.equal(cc.notChecked, 3);
assert.deepEqual(cc.notOnRoll, ["Nobody Here"]); assert.deepEqual(cc.duplicates, ["Hannah Asamoah"]);
assert.equal(rollKey("BIRIWATECHNICAL"), rollKey("Biriwa Technical"));
console.log("matching checks passed");

// --- real workbook ---
const file = process.argv[2] || "/tmp/roll_rows.json";
if (existsSync(file)) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const XLSX = { utils: { sheet_to_json: ws => ws.rows } };
  const wb = { SheetNames: Object.keys(data), Sheets: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { rows: v }])) };
  const known = ["CENTRAL REGIONAL DIRECTORATE", "BIRIWA TECHNICAL", "ASUANSI TECHNICAL", "GOMOA MAMPONG TECHNICAL"];
  const res = parseRollWorkbook(XLSX, wb, known);
  console.log("sheets:", res.sheets.length, "staff:", res.total, "duplicate employee nos:", res.duplicates.length);
  for (const s of res.sheets) console.log(String(s.count).padStart(4), String(s.onLeave).padStart(2), s.inList ? "listed" : "      ", s.institution);
  const biriwa = res.sheets.find(s => s.key === "BIRIWATECHNICAL");
  assert.equal(biriwa.institution, "BIRIWA TECHNICAL");
  assert.ok(res.sheets.every(s => s.staff.every(p => Object.keys(p).sort().join() === "job,name,no,post")), "only 4 fields kept");
}
