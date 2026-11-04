import assert from "node:assert/strict";
import { computeEdtech } from "../js/edtech-calc.js";

const tool = (item, quantity, distributed = "", stores = "", condition = "", remarks = "") => ({ item, quantity, distributed, stores, condition, remarks });
const al = (type, staff, quantity, condition = "") => ({ type, staff, dept: "", quantity, condition, remarks: "" });
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
    al("Others", "Abena Asare", "1"),
    al("Desktop Computers", "", "")                       // untouched preset row: ignored
  ]
};
s = computeEdtech(d);
eq([s.desktop.quantity, s.laptop.quantity, s.tablet.quantity], [20, 10, 30]);
eq([s.desktop.allocated, s.laptop.allocated, s.tablet.allocated], [12, 8, 30]);
eq(s.others, "Projector (2), Printer (1)"); eq(s.othersTotal, 3); eq(s.other.allocated, 1);
eq(s.totalRecorded, 60); eq(s.totalAllocated, 50);
ok(Math.abs(s.allocationRate - 50 / 60) < 1e-9, "allocation rate");
eq(s.allocRows, 5, "preset blank row ignored");
eq(s.desktop.unallocated, 8); eq(s.laptop.unallocated, 2);
eq(s.flags.notReconciled, 1, "only the laptop line does not add up");
eq(s.flags.overAllocated, 0);
eq(s.flags.allocMismatch, 1, "laptops: 8 allocated vs 6 distributed");   // desktop 12=12, tablet 30=30, others: distributed 1 vs alloc 1
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

console.log(`${n} edtech checks passed`);
