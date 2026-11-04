// EdTech department: pure calculation logic (no browser code, tested in Node).
// Mirrors the "Institute Technology Tools", "Staff Allocation" and "Summary" sheets of the EdTech workbook.

// The first three rows of the tools sheet are fixed; every row after them is an "Others" item typed by the monitor.
export const FIXED_TOOLS = ["Desktop Computers", "Laptop Computers", "SM1 Tablets"];
export const ITEM_TYPES = [...FIXED_TOOLS, "Others"];
export const CONDITIONS = ["Good", "Fair", "Poor", "Faulty", "Missing"];
export const BAD_CONDITIONS = ["Poor", "Faulty", "Missing"];

export const EDTECH_AREAS = [
  ["records", "Inventory records"],
  ["condition", "Condition of equipment"],
  ["distribution", "Distribution to staff"],
  ["storage", "Storage and security"]
];

const text = v => String(v ?? "").trim();
const has = v => text(v) !== "";
const num = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const ratio = (a, b) => (b === 0 ? null : a / b);

// Which of the four buckets a tools row belongs to (rows 0 to 2 are fixed, the rest are "Others")
const toolType = (_, n) => (n < FIXED_TOOLS.length ? FIXED_TOOLS[n] : "Others");
const allocType = r => (ITEM_TYPES.includes(r.type) ? r.type : "");

export function computeEdtech(d) {
  const tools = d.tools || [];
  // An allocation row counts once the monitor has filled in anything beyond the pre-selected item type
  const alloc = (d.allocation || []).filter(r => has(r.staff) || has(r.quantity) || has(r.condition) || has(r.remarks));

  const byType = ITEM_TYPES.map(type => {
    const rows = tools.filter((r, n) => toolType(r, n) === type);
    const aRows = alloc.filter(r => allocType(r) === type);
    const quantity = rows.reduce((s, r) => s + num(r.quantity), 0);
    const distributed = rows.reduce((s, r) => s + num(r.distributed), 0);
    const stores = rows.reduce((s, r) => s + num(r.stores), 0);
    const allocated = aRows.reduce((s, r) => s + num(r.quantity), 0);
    const qEntered = rows.some(r => has(r.quantity));
    const dEntered = rows.some(r => has(r.distributed));
    return {
      type, quantity, distributed, stores, allocated, qEntered, dEntered,
      unallocated: qEntered ? Math.max(quantity - allocated, 0) : 0,
      allocationRate: ratio(allocated, quantity),
      overAllocated: qEntered && allocated > quantity,
      allocMismatch: dEntered && allocated !== distributed
    };
  });
  const get = t => byType.find(x => x.type === t);

  // Tool lines (a line is one row of the tools sheet that has a quantity)
  const lines = tools.map((r, n) => ({ r, n })).filter(({ r }) => num(r.quantity) > 0 || has(r.quantity));
  const reconciled = lines.filter(({ r }) => has(r.distributed) || has(r.stores));
  const notReconciled = reconciled.filter(({ r }) => num(r.distributed) + num(r.stores) !== num(r.quantity)).length;
  const qtyTotal = lines.reduce((s, { r }) => s + num(r.quantity), 0);
  const accountedQty = lines.reduce((s, { r }) => s + Math.min(num(r.distributed) + num(r.stores), num(r.quantity)), 0);

  const rated = tools.filter(r => CONDITIONS.includes(r.condition) && num(r.quantity) > 0);
  const ratedQty = rated.reduce((s, r) => s + num(r.quantity), 0);
  const goodQty = rated.filter(r => r.condition === "Good").reduce((s, r) => s + num(r.quantity), 0);

  const conditionQty = Object.fromEntries(CONDITIONS.map(c => [c, rated.filter(r => r.condition === c).reduce((t, r) => t + num(r.quantity), 0)]));

  const othersRows = tools.filter((r, n) => n >= FIXED_TOOLS.length && has(r.item) && num(r.quantity) > 0);
  const others = othersRows.map(r => `${text(r.item)} (${num(r.quantity)})`).join(", ");

  const totalRecorded = FIXED_TOOLS.reduce((s, t) => s + get(t).quantity, 0);
  const totalAllocated = FIXED_TOOLS.reduce((s, t) => s + get(t).allocated, 0);

  const allocRows = alloc.length;
  const noName = alloc.filter(r => num(r.quantity) > 0 && !has(r.staff)).length;
  const noType = alloc.filter(r => num(r.quantity) > 0 && !allocType(r)).length;

  return {
    byType, desktop: get("Desktop Computers"), laptop: get("Laptop Computers"), tablet: get("SM1 Tablets"), other: get("Others"),
    others, othersTotal: get("Others").quantity,
    totalRecorded, totalAllocated,
    qtyTotal, accountedQty, ratedQty, goodQty, conditionQty,
    accountedRate: ratio(accountedQty, qtyTotal),
    allocationRate: ratio(totalAllocated, totalRecorded),
    goodRate: ratio(goodQty, ratedQty),
    allocRows,
    flags: {
      notReconciled,                                                       // distributed + stores do not add up to the quantity
      overAllocated: byType.filter(x => x.overAllocated).length,           // staff hold more than the records show
      allocMismatch: byType.filter(x => x.allocMismatch).length,           // distributed does not match the staff allocation list
      badTools: tools.filter(r => BAD_CONDITIONS.includes(r.condition) && num(r.quantity) > 0).length,
      badAlloc: alloc.filter(r => BAD_CONDITIONS.includes(r.condition)).length,
      noName, noType
    }
  };
}
