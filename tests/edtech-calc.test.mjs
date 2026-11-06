import assert from "node:assert/strict";
import { computeEdtech } from "../js/edtech-calc.js";

const ITEMS3 = ["Desktop Computers", "Laptop Computers", "SM1 Tablets"];
const tool = (item, quantity, distributed = "", stores = "", condition = "", remarks = "") => ({ item, quantity, distributed, stores, condition, remarks });
const al = (type, staff, quantity, condition = "", other = "") => ({ type, other, staff, dept: "", quantity, condition, remarks: "" });
let n = 0; const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++; };

// empty / raw documents must not crash and give no rates
let s = computeEdtech({});
eq(s.totalRecorded, 0); eq(s.accountedRate, null); eq(s.allocationRate, null); eq(s.goodRate, null); eq(s.others, "");

// a realistic check
const d = {
  tools: [
    tool("Desktop Computers", "20", "12", "8", "Good"),
    tool("Laptop Computers", "10", "6", "3", "Fair"),     // 9 of 10 accounted for -> not reconciled
    tool("SM1 Tablets", "30", "30", "0", "Poor"),
    tool("Projector", "2", "", "", "Good"),
    tool("Printer", "1", "1", "0", "Faulty"),
    tool("", "", "", "", "")
  ],
  allocation: [
    al("Desktop Computers", "Ama Mensah", "5", "Good"),
    al("Desktop Computers", "Kofi Boateng", "7", "Good"),
    al("Laptop Computers", "Esi Quaye", "8"),             // 8 allocated vs 6 distributed -> mismatch
    al("SM1 Tablets", "Yaw Owusu", "30", "Faulty"),
    al("Others", "Abena Asare", "1", "", "printer "),   // the item name matches "Printer" ignoring case and spacing
    al("Desktop Computers", "", "")                       // untouched preset row: ignored
  ]
};
s = computeEdtech(d);
eq([s.desktop.quantity, s.laptop.quantity, s.tablet.quantity], [20, 10, 30]);
eq([s.desktop.allocated, s.laptop.allocated, s.tablet.allocated], [12, 8, 30]);
eq(s.others, "Projector (2), Printer (1)"); eq(s.othersTotal, 3); eq(s.other.allocated, 1); eq(s.othersAllocated, "Printer (1)");
eq(s.othersItems.map(x => [x.name, x.quantity, x.allocated]), [["Projector", 2, 0], ["Printer", 1, 1]], "others are matched by name");
eq(s.totalRecorded, 60); eq(s.totalAllocated, 50);
ok(Math.abs(s.allocationRate - 50 / 60) < 1e-9, "allocation rate");
eq(s.allocRows, 5, "preset blank row ignored");
eq(s.desktop.unallocated, 8); eq(s.laptop.unallocated, 2);
eq(s.flags.notReconciled, 1, "only the laptop line does not add up");
eq(s.flags.overAllocated, 0);
eq(s.flags.allocMismatch, 1, "laptops: 8 allocated vs 6 distributed");   // desktop 12=12, tablet 30=30, printer: distributed 1 = allocated 1
eq(s.flags.badTools, 2, "tablets Poor and printer Faulty");
eq(s.flags.badAlloc, 1, "the allocated tablet is Faulty");
eq([s.flags.noName, s.flags.noType], [0, 0]);
ok(Math.abs(s.goodRate - 22 / 63) < 1e-9, "good-condition rate is weighted by quantity");
ok(Math.abs(s.accountedRate - 60 / 63) < 1e-9, "accounted-for rate: laptops 9/10, projectors 0/2");

// over-allocation, missing names / types, and "not entered" is not the same as zero
s = computeEdtech({
  tools: [tool("Desktop Computers", "5", "5", "0"), tool("Laptop Computers", "", "", ""), tool("SM1 Tablets", "0", "", "")],
  allocation: [al("Desktop Computers", "A B", "4"), al("Desktop Computers", "C D", "3"), al("Desktop Computers", "", "2"), al("", "E F", "1"), al("Laptop Computers", "G H", "2")]
});
eq(s.desktop.allocated, 9); ok(s.desktop.overAllocated, "9 allocated of 5 recorded");
eq(s.laptop.overAllocated, false, "laptops were never entered, so no flag yet");
eq(s.tablet.overAllocated, false); eq(s.tablet.qEntered, true);
eq(s.flags.overAllocated, 1); eq(s.flags.noName, 1); eq(s.flags.noType, 1);
eq(s.laptop.allocationRate, null);

// weird input: negatives, text, blanks
s = computeEdtech({ tools: [tool("Desktop Computers", "-3", "abc", " ")], allocation: [al("Desktop Computers", "X Y", "-1")] });
eq([s.desktop.quantity, s.desktop.distributed, s.desktop.allocated], [0, 0, 0]);

// rows beyond the three fixed ones are always "Others", whatever the item name says
s = computeEdtech({ tools: [tool("Desktop Computers", "1"), tool("Laptop Computers", "1"), tool("SM1 Tablets", "1"), tool("Desktop Computers", "9")] });
eq(s.desktop.quantity, 1); eq(s.other.quantity, 9);

s = computeEdtech(d);
eq(s.conditionQty, { Good: 22, Fair: 10, Poor: 30, Faulty: 1, Missing: 0 });
eq([s.qtyTotal, s.accountedQty, s.ratedQty, s.goodQty], [63, 60, 63, 22]);


// Others, item by item: allocating a projector cannot cover a missing printer
s = computeEdtech({
  tools: [tool("Desktop Computers", ""), tool("Laptop Computers", ""), tool("SM1 Tablets", ""), tool("Projector", "2", "2", "0"), tool("Printer", "5", "5", "0")],
  allocation: [al("Others", "A", "3", "", "Projector"), al("Others", "B", "1", "", "Printer"), al("Others", "C", "1", "", "Scanner"), al("Others", "D", "1")]
});
eq(s.othersItems.filter(x => x.overAllocated).map(x => x.name).sort(), ["Projector", "Scanner"], "projector 3 of 2, scanner is not in the tools list");
eq(s.other.overAllocated, true); eq(s.flags.overAllocated, 2); eq(s.flags.noOtherName, 1, "one Others allocation has no item name");
eq(s.flags.allocMismatch, 2, "projector 3 vs 2 distributed, printer 1 vs 5 distributed");
eq(s.other.allocated, 6, "aggregate Others allocated still adds every row");
eq(s.totalRecorded, 0, "Others never count in the desktop, laptop and tablet totals");
s = computeEdtech({ tools: [tool("Desktop Computers", "1"), tool("Laptop Computers", ""), tool("SM1 Tablets", ""), tool("", "4")] });
eq(s.flags.noOtherName, 1, "an Others tools row with a quantity but no name"); eq(s.othersItems.length, 1);
s = computeEdtech({ tools: [tool("Desktop Computers", ""), tool("Laptop Computers", ""), tool("SM1 Tablets", ""), tool("Projector", "")], allocation: [al("Others", "A", "2", "", "Projector")] });
eq(s.flags.overAllocated, 0, "nothing is flagged before the tools sheet has any quantity");

/* ---- independent re-computation on random data: every total must add up ---- */
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];
const maybe = f => (rnd() < 0.25 ? "" : f());
for (let round = 0; round < 300; round++) {
  const toolsR = [...ITEMS3.map(i => tool(i, maybe(() => String(Math.floor(rnd() * 40))), maybe(() => String(Math.floor(rnd() * 40))), maybe(() => String(Math.floor(rnd() * 40))), pick(["", "Good", "Fair", "Poor", "Faulty", "Missing"]))),
    ...Array.from({ length: Math.floor(rnd() * 4) }, (_, k) => tool(maybe(() => pick(["Projector", "Printer", "Router"])), maybe(() => String(Math.floor(rnd() * 9))), maybe(() => String(Math.floor(rnd() * 9))), maybe(() => String(Math.floor(rnd() * 9))), pick(["", "Good", "Poor"])))];
  const allocR = Array.from({ length: Math.floor(rnd() * 12) }, () => al(pick(["Desktop Computers", "Laptop Computers", "SM1 Tablets", "Others", ""]), maybe(() => "S" + Math.floor(rnd() * 5)), maybe(() => String(Math.floor(rnd() * 20))), pick(["", "Good", "Faulty"]), maybe(() => pick(["Projector", "printer", "Router", "Scanner"]))));
  const r = computeEdtech({ tools: toolsR, allocation: allocR });
  const N = v => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  // reference sums, written the long way
  const ref = { q: [0, 0, 0, 0], d: [0, 0, 0, 0], s: [0, 0, 0, 0], a: [0, 0, 0, 0] };
  toolsR.forEach((row, i) => { const b = Math.min(i, 3); ref.q[b] += N(row.quantity); ref.d[b] += N(row.distributed); ref.s[b] += N(row.stores); });
  allocR.forEach(row => { const b = ["Desktop Computers", "Laptop Computers", "SM1 Tablets", "Others"].indexOf(row.type); if (b >= 0) ref.a[b] += N(row.quantity); });
  r.byType.forEach((x, b) => { eq([x.quantity, x.distributed, x.stores, x.allocated], [ref.q[b], ref.d[b], ref.s[b], ref.a[b]], `round ${round} type ${b}`); });
  eq(r.totalRecorded, ref.q[0] + ref.q[1] + ref.q[2]); eq(r.totalAllocated, ref.a[0] + ref.a[1] + ref.a[2]);
  // the item-by-item Others breakdown must add up to the Others totals
  eq([r.othersItems.reduce((t, x) => t + x.quantity, 0), r.othersItems.reduce((t, x) => t + x.allocated, 0)], [ref.q[3], ref.a[3]], `round ${round}: others items add up to the Others totals`);
  // rates are proper fractions (the allocation rate may exceed 1 only when over-allocated)
  for (const rate of [r.accountedRate, r.goodRate]) ok(rate === null || (rate >= 0 && rate <= 1), `round ${round}: rate in range`);
  ok(r.allocationRate === null || r.allocationRate >= 0, "allocation rate not negative");
  ok(r.conditionQty.Good + r.conditionQty.Fair + r.conditionQty.Poor + r.conditionQty.Faulty + r.conditionQty.Missing === r.ratedQty, `round ${round}: condition counts add up to the items rated`);
  ok(r.accountedQty <= r.qtyTotal, "accounted never exceeds recorded");
  ok(r.byType.every(x => x.unallocated === Math.max(x.qEntered ? x.quantity - x.allocated : 0, 0)), "unallocated = recorded - allocated");
}
console.log(`${n} edtech checks passed`);
