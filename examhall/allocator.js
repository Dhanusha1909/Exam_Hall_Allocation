// Handwritten constraint-satisfaction allocator (backtracking + pruning). No OR-tools / no AI.
const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });

function expand(s, e) {
  const a = /^(.*?)(\d+)$/.exec(s), b = /^(.*?)(\d+)$/.exec(e);
  if (!a || !b || a[1] !== b[1]) throw new Error(`Invalid register range ${s} - ${e}`);
  const w = a[2].length, out = [];
  for (let n = +a[2]; n <= +b[2]; n++) out.push(a[1] + String(n).padStart(w, '0'));
  return out;
}

// cohort = {dept, year, subject, startReg, endReg, lateralRegs, transferRegs}
function buildCohorts(cohorts) {
  return cohorts.map(c => {
    const normal = expand(c.startReg, c.endReg);
    const lateral = c.lateralRegs || c.extraRegs || [];
    const transfer = c.transferRegs || [];
    const students = [
      ...[...new Set(normal)].sort(cmp).map(reg => ({ reg, type: 'normal' })),
      ...[...new Set(lateral)].sort(cmp).map(reg => ({ reg, type: 'lateral' })),
      ...[...new Set(transfer)].sort(cmp).map(reg => ({ reg, type: 'transfer' }))
    ];
    return { dept: c.dept, year: c.year, subject: c.subject, students };
  });
}

function allocate(cohortsIn, halls, strict = true, invigilators = [], options = {}) {
  const C = buildCohorts(cohortsIn), K = C.length;
  if (!Array.isArray(invigilators) || invigilators.some(name => typeof name !== 'string' || !name.trim())) {
    throw new Error('Enter a valid invigilator name for every hall.');
  }
  invigilators = invigilators.map(name => name.trim());
  if (invigilators.length < halls.length) throw new Error(`Assign an invigilator to each hall (${halls.length} required).`);
  if (new Set(invigilators.map(name => name.toLocaleLowerCase())).size !== invigilators.length) {
    throw new Error('Each invigilator can be assigned to only one hall; remove duplicate names.');
  }
  const maxDepartments = halls.map(h => {
    const raw = h.maxDepartments === undefined ? 2 : h.maxDepartments;
    const max = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (!Number.isInteger(max) || max < 1) throw new Error(`Hall ${h.hallNo} must have a valid positive integer maximum department count.`);
    return max;
  });
  const maxStudents = halls.map(h => {
    const raw = h.maxStudents === undefined || h.maxStudents === '' ? h.rows * h.cols : h.maxStudents;
    const max = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
    if (!Number.isInteger(max) || max < 1 || max > h.rows * h.cols) {
      throw new Error(`Hall ${h.hallNo} must have a maximum student count between 1 and its physical seat count (${h.rows * h.cols}).`);
    }
    return max;
  });
  const maxPerRow = options.maxPerRow === undefined ? Infinity : options.maxPerRow;
  if (!(maxPerRow === Infinity || Number.isInteger(maxPerRow) && maxPerRow > 0)) {
    throw new Error('The maximum students per row must be a positive integer.');
  }

  const seats = [], idx = {}, usableSeatCounts = halls.map(() => 0);
  halls.forEach((h, hi) => {
    const blocked = new Set((h.blocked || []).map(String)); // "row-col" 1-based
    for (let c = 0; c < h.cols; c++) for (let r = 0; r < h.rows; r++) {
      if (blocked.has(`${r + 1}-${c + 1}`)) continue;
      usableSeatCounts[hi]++;
      idx[`${hi}:${r}:${c}`] = seats.length;
      seats.push({ hi, r, c });
    }
  });
  const N = seats.length, ptr = Array(K).fill(0), assign = Array(N).fill(-2);
  let total = C.reduce((s, c) => s + c.students.length, 0);
  const hallSeatLimits = maxStudents.map((max, hi) => Math.min(max, usableSeatCounts[hi]));
  const capacity = hallSeatLimits.reduce((sum, count) => sum + count, 0);
  if (total > capacity) throw new Error(`Not enough seats: ${total} students, ${capacity} usable seats`);
  const hallDepartments = halls.map(() => new Map());
  const hallOccupancy = halls.map(() => 0);
  const columnDepartments = halls.map(() => new Map());
  const columnOccupancy = halls.map(() => new Map());
  const rowOccupancy = halls.map(() => new Map());
  const clash = (a, b) => a >= 0 && b >= 0 && (options.sameDeptAdjacent !== undefined
    ? options.sameDeptAdjacent && C[a].dept === C[b].dept
    : strict
      ? C[a].subject === C[b].subject || C[a].dept === C[b].dept
      : C[a].dept === C[b].dept && C[a].subject === C[b].subject);
  const rem = k => C[k].students.length - ptr[k];
  const cand = i => {
    const s = seats[i], l = [];
    const columnDept = columnDepartments[s.hi].get(s.c);
    const departmentPriority = new Map();
    for (let k = 0; k < K; k++) if (rem(k) > 0) {
      const type = C[k].students[ptr[k]].type;
      const rank = type === 'normal' ? 0 : type === 'lateral' ? 1 : 2;
      departmentPriority.set(C[k].dept, Math.min(departmentPriority.get(C[k].dept) ?? Infinity, rank));
    }
    for (let k = 0; k < K; k++) {
      if (rem(k) === 0) continue;
      const type = C[k].students[ptr[k]].type;
      const rank = type === 'normal' ? 0 : type === 'lateral' ? 1 : 2;
      if (rank !== departmentPriority.get(C[k].dept) || (columnDept !== undefined && C[k].dept !== columnDept)) continue;
      const usedDepts = hallDepartments[s.hi];
      if (hallOccupancy[s.hi] >= hallSeatLimits[s.hi]) continue;
      if (!usedDepts.has(C[k].dept) && usedDepts.size >= maxDepartments[s.hi]) continue;
      if ((rowOccupancy[s.hi].get(s.r) || 0) >= maxPerRow) continue;
      const neighbors = [
        idx[`${s.hi}:${s.r}:${s.c - 1}`],
        idx[`${s.hi}:${s.r - 1}:${s.c - 1}`],
        idx[`${s.hi}:${s.r + 1}:${s.c - 1}`]
      ];
      if (neighbors.some(neighbor => clash(k, assign[neighbor] ?? -1))) continue;
      l.push(k);
    }
    l.sort((a, b) => rem(b) - rem(a));              // most-constrained (largest) cohort first
    if (N - i > total_left()) l.push(-1);            // empty seat allowed only if spare seats exist
    return l;
  };
  const total_left = () => { let t = 0; for (let k = 0; k < K; k++) t += rem(k); return t; };
  const stack = []; let i = 0, steps = 0;
  stack[0] = { c: N ? cand(0) : [], p: 0 };
  while (i < N) {
    if (++steps > 3e6) throw new Error('No arrangement satisfies the column, adjacency, and maximum-department constraints within the search limit. Add halls/seats or relax constraints.');
    const f = stack[i], s = seats[i];
    if (f.p >= f.c.length) {
      if (i === 0) throw new Error('No arrangement satisfies the seating, column, and maximum-department constraints for this input.');
      i--;
      const k = assign[i], hall = seats[i].hi;
      if (k >= 0) {
        ptr[k]--;
        const dept = C[k].dept, count = hallDepartments[hall].get(dept) - 1;
        if (count) hallDepartments[hall].set(dept, count); else hallDepartments[hall].delete(dept);
        hallOccupancy[hall]--;
        const col = seats[i].c, occupancy = columnOccupancy[hall].get(col) - 1;
        if (occupancy) columnOccupancy[hall].set(col, occupancy);
        else {
          columnOccupancy[hall].delete(col);
          columnDepartments[hall].delete(col);
        }
        const row = seats[i].r, rowCount = rowOccupancy[hall].get(row) - 1;
        if (rowCount) rowOccupancy[hall].set(row, rowCount); else rowOccupancy[hall].delete(row);
      }
      assign[i] = -2;
      continue;
    }
    const k = f.c[f.p++]; assign[i] = k;
    if (k >= 0) {
      ptr[k]++;
      hallDepartments[s.hi].set(C[k].dept, (hallDepartments[s.hi].get(C[k].dept) || 0) + 1);
      hallOccupancy[s.hi]++;
      columnDepartments[s.hi].set(s.c, C[k].dept);
      columnOccupancy[s.hi].set(s.c, (columnOccupancy[s.hi].get(s.c) || 0) + 1);
      rowOccupancy[s.hi].set(s.r, (rowOccupancy[s.hi].get(s.r) || 0) + 1);
    }
    i++; if (i < N) stack[i] = { c: cand(i), p: 0 };
  }
  // Build output
  const out = halls.map((h, i) => ({ hallNo: h.hallNo, floor: h.floor, rows: h.rows, cols: h.cols, maxDepartments: maxDepartments[i], maxStudents: maxStudents[i], invigilator: invigilators[i], seats: [], subjects: [] }));
  const hallSeatOffsets = [];
  let nextSeatNo = 0;
  halls.forEach(h => {
    hallSeatOffsets.push(nextSeatNo);
    nextSeatNo += h.rows * h.cols;
  });
  const cur = Array(K).fill(0);
  seats.forEach((s, n) => {
    const k = assign[n]; if (k < 0) return;
    const c = C[k];
    const student = c.students[cur[k]++];
    out[s.hi].seats.push({ row: s.r + 1, col: s.c + 1, seatNo: hallSeatOffsets[s.hi] + s.c * halls[s.hi].rows + s.r + 1, reg: student.reg, studentType: student.type, dept: c.dept, year: c.year, subject: c.subject });
  });
  out.forEach(h => { const m = {}; h.seats.forEach(x => m[`${x.subject}|${x.dept}|${x.year}`] = { subject: x.subject, dept: x.dept, year: x.year }); h.subjects = Object.values(m); });
  return { halls: out, conflicts: verify(out, strict), seated: total, generatedAt: new Date() };
}

// Same departments/subjects cannot be side-by-side or diagonal; vertical department columns are allowed.
function verify(halls, strict = true) {
  let n = 0;
  halls.forEach(h => {
    const g = {}; h.seats.forEach(s => g[`${s.row}:${s.col}`] = s);
    h.seats.forEach(s => [[0, 1], [1, 1], [1, -1]].forEach(([dr, dc]) => {
      const t = g[`${s.row + dr}:${s.col + dc}`]; if (!t) return;
      const bad = strict ? s.subject === t.subject || s.dept === t.dept : s.dept === t.dept && s.subject === t.subject;
      if (bad) n++;
    }));
  });
  return n;
}
module.exports = { allocate, verify, expand };
