import assert from "node:assert/strict";
import { leaveDays, leaveResumes, leaveStatus, computeLeave } from "../js/calc.js";

let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

// duration counts both the first and the last day
eq(leaveDays("2026-11-02", "2026-11-02"), 1);
eq(leaveDays("2026-11-02", "2026-11-08"), 7);
eq(leaveDays("2026-12-28", "2027-01-03"), 7, "across a year end");
eq(leaveDays("2028-02-27", "2028-03-01"), 4, "leap year");
eq(leaveDays("2026-11-08", "2026-11-02"), null, "end before start");
eq(leaveDays("2026-11-02", ""), null); eq(leaveDays("", ""), null); eq(leaveDays("2026-13-45", "2026-14-01"), null, "impossible dates are rejected"); eq(leaveDays("2026-02-30", "2026-03-05"), null);
eq(leaveResumes("2026-11-08"), "2026-11-09"); eq(leaveResumes("2026-12-31"), "2027-01-01"); eq(leaveResumes(""), "");

const r = { start: "2026-11-02", end: "2026-11-08" };
eq(leaveStatus(r, "2026-11-01"), "upcoming"); eq(leaveStatus(r, "2026-11-02"), "ongoing"); eq(leaveStatus(r, "2026-11-08"), "ongoing");
eq(leaveStatus(r, "2026-11-09"), "ended"); eq(leaveStatus({ start: "2026-11-02" }, "2026-11-05"), ""); eq(leaveStatus(r, ""), "");

const d = {
  leave: [
    { name: "Ama Mensah", type: "Annual leave", start: "2026-11-02", end: "2026-11-15" },     // 14 days, ongoing on 5 Nov
    { name: "Kofi Boateng", type: "Sick leave", start: "2026-10-01", end: "2026-10-10" },     // 10 days, ended
    { name: "Esi Quaye", type: "Study leave", start: "2026-12-01", end: "2026-12-31" },       // 31 days, upcoming
    { name: "Yaw Owusu", type: "Sick leave", start: "2026-11-05", end: "" },                  // missing date
    { name: "", type: "", start: "", end: "" }                                                 // blank row ignored
  ],
  attendance: [
    { name: "MENSAH AMA", signed: "Yes", present: "No" },      // name order differs: still the same person
    { name: "Kofi Boateng", signed: "Yes", present: "Yes" }    // leave already ended: not flagged
  ]
};
const l = computeLeave(d, "2026-11-05");
eq([l.count, l.ongoing, l.upcoming, l.ended], [4, 1, 1, 1]);
eq(l.totalDays, 14 + 10 + 31); eq(l.longest, 31); assert.ok(Math.abs(l.avgDays - 55 / 3) < 1e-9); n++;
eq(l.badDates, 1); eq(l.signedWhileOnLeave, 1, "Ama is on leave on the day but signed the register");

const empty = computeLeave({}, "2026-11-05");
eq([empty.count, empty.totalDays, empty.avgDays, empty.longest, empty.badDates, empty.signedWhileOnLeave], [0, 0, null, 0, 0, 0]);
console.log(`${n} leave checks passed`);
