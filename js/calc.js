// Pure calculation logic: mirrors the formulas on the Excel "Summary" sheet.
export const LEVELS = ["Management", "Senior", "Junior", "Support"];

export const CHECKLIST = [
  "Attendance register is available and in use at all levels",
  "Register has arrival and departure columns, signed daily",
  "Registers are closed at the official start time and countersigned by a supervisor",
  "No signs of backdating, alterations or blank entries",
  "Movement or permission book is available and up to date",
  "Official errands and permissions are approved before departure",
  "Leave register is up to date and matches approved leave forms",
  "Staff on leave are not signing the attendance register",
  "Staff nominal roll is current and matches staff physically on site",
  "Late-coming and absenteeism are recorded and followed up by supervisors",
  "Queries or sanctions issued for repeated lateness or absence are on file",
  "Biometric or clock-in system is installed and working (where applicable)",
  "Head of institution and management follow the same attendance rules as other staff"
];

const named = r => (r.name || "").trim() !== "";
const ratio = (a, b) => (b === 0 ? null : a / b);

export function computeSummary(d) {
  const attAll = d.attendance || [];
  const att = attAll.filter(named);
  const count = s => att.filter(r => r.status === s).length;

  const onTime = count("On time");
  const late = count("Late");
  const absent = count("Absent");
  const approved = count("On leave") + count("On duty elsewhere");
  const listed = att.length;

  const signedNotPresent = attAll.filter(r => r.signed === "Yes" && r.present === "No").length;

  const mov = (d.movement || []).filter(named);
  const notInBook = (d.movement || []).filter(r => r.entered === "No").length;

  const recs = d.records || [];
  const yes = recs.filter(r => r.response === "Yes").length;
  const no = recs.filter(r => r.response === "No").length;

  const byLevel = LEVELS.map(level => {
    const rows = att.filter(r => r.level === level);
    const present = rows.filter(r => r.status === "On time" || r.status === "Late").length;
    return {
      level,
      listed: rows.length,
      present,
      late: rows.filter(r => r.status === "Late").length,
      absent: rows.filter(r => r.status === "Absent").length,
      rate: ratio(present, rows.length)
    };
  });

  return {
    listed, onTime, late, absent, approved, signedNotPresent,
    attendanceRate: ratio(onTime + late, listed),
    punctualityRate: ratio(onTime, onTime + late),
    movementListed: mov.length,
    notInBook,
    recordsYes: yes, recordsNo: no,
    complianceRate: ratio(yes, yes + no),
    byLevel
  };
}

export const pct = n => (n === null || n === undefined ? "—" : (n * 100).toFixed(1).replace(/\.0$/, "") + "%");


/* ---------- Staff on leave ---------- */
export const LEAVE_TYPES = ["Annual leave", "Sick leave", "Maternity leave", "Paternity leave", "Study leave", "Casual / compassionate leave", "Other"];

const DAY = 86400000;
const parseDay = v => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== m[0] ? null : t;   // rejects dates that roll over, like month 13
};
const nameKey = n => String(n || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");

// Calendar days from the first to the last day of leave, both included. null when a date is missing or the end is before the start.
export function leaveDays(start, end) {
  const a = parseDay(start), b = parseDay(end);
  return a === null || b === null || b < a ? null : Math.round((b - a) / DAY) + 1;
}
// The day the person is due back (the day after the last day of leave), as YYYY-MM-DD
export function leaveResumes(end) {
  const b = parseDay(end);
  return b === null ? "" : new Date(b + DAY).toISOString().slice(0, 10);
}
// "ongoing" | "upcoming" | "ended" on the given day (YYYY-MM-DD); "" when the dates cannot say
export function leaveStatus(r, asOf) {
  const a = parseDay(r.start), b = parseDay(r.end), t = parseDay(asOf);
  if (a === null || b === null || t === null || b < a) return "";
  return t < a ? "upcoming" : t > b ? "ended" : "ongoing";
}

export function computeLeave(d, asOf) {
  const rows = (d.leave || []).filter(named);
  const days = rows.map(r => leaveDays(r.start, r.end));
  const valid = days.filter(x => x !== null);
  const status = rows.map(r => leaveStatus(r, asOf));
  const signed = new Set((d.attendance || []).filter(r => named(r) && (r.signed === "Yes" || r.present === "Yes")).map(r => nameKey(r.name)));
  return {
    count: rows.length,
    totalDays: valid.reduce((a, b) => a + b, 0),
    avgDays: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    longest: valid.length ? Math.max(...valid) : 0,
    ongoing: status.filter(x => x === "ongoing").length,
    upcoming: status.filter(x => x === "upcoming").length,
    ended: status.filter(x => x === "ended").length,
    badDates: rows.filter((r, n) => days[n] === null).length,                       // a date is missing, or the end is before the start
    signedWhileOnLeave: rows.filter((r, n) => status[n] === "ongoing" && signed.has(nameKey(r.name))).length
  };
}
