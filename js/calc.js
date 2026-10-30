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

  const signedNotPresent = attAll.filter(r => r.signed === "Y" && r.present === "N").length;

  const mov = (d.movement || []).filter(named);
  const notInBook = (d.movement || []).filter(r => r.entered === "N").length;

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

export const pct = n => (n === null || n === undefined ? "—" : (n * 100).toFixed(1) + "%");
