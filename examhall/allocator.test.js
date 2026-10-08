const test = require('node:test');
const assert = require('node:assert/strict');
const { allocate } = require('./allocator');

const group = (dept, subject, startReg, endReg, extra = {}) => ({
  dept, year: 1, subject, startReg, endReg, ...extra
});

test('seats normal students before lateral students and transfer students', () => {
  const result = allocate([
    group('A', 'S1', 'A001', 'A002', { lateralRegs: ['A901'], transferRegs: ['A951'] }),
    group('B', 'S2', 'B001', 'B002', { lateralRegs: ['B901'], transferRegs: ['B951'] })
  ], [{ floor: 1, hallNo: 1, rows: 4, cols: 2, maxDepartments: 2 }], true, ['Invigilator']);

  for (const dept of ['A', 'B']) {
    const ranks = result.halls[0].seats.filter(seat => seat.dept === dept)
      .map(seat => ({ normal: 0, lateral: 1, transfer: 2 })[seat.studentType]);
    assert.deepEqual(ranks, [...ranks].sort());
  }
});

test('keeps a department in one vertical column and allows vertical neighbors', () => {
  const result = allocate([
    group('A', 'S1', 'A001', 'A002')
  ], [{ floor: 1, hallNo: 1, rows: 2, cols: 1, maxDepartments: 1 }], true, ['Invigilator']);
  assert.equal(result.conflicts, 0);
  assert.deepEqual(result.halls[0].seats.map(seat => seat.dept), ['A', 'A']);
});

test('rejects same-department horizontal and diagonal neighbors', () => {
  const adjacentSameDepartment = [
    group('A', 'S1', 'A001', 'A001'),
    group('A', 'S2', 'A002', 'A002')
  ];
  assert.throws(
    () => allocate(adjacentSameDepartment, [{ floor: 1, hallNo: 1, rows: 1, cols: 2, maxDepartments: 1 }], true, ['Invigilator']),
    /No arrangement satisfies/
  );
  assert.throws(
    () => allocate(adjacentSameDepartment, [{ floor: 1, hallNo: 1, rows: 2, cols: 2, blocked: ['1-2', '2-1'], maxDepartments: 1 }], true, ['Invigilator']),
    /No arrangement satisfies/
  );
});

test('enforces the maximum departments allowed in each hall', () => {
  const cohorts = [
    group('A', 'S1', 'A001', 'A001'),
    group('B', 'S2', 'B001', 'B001')
  ];
  const result = allocate(cohorts, [
    { floor: 1, hallNo: 1, rows: 1, cols: 1, maxDepartments: 1 },
    { floor: 1, hallNo: 2, rows: 1, cols: 1, maxDepartments: 1 }
  ], true, ['Invigilator 1', 'Invigilator 2']);

  assert.deepEqual(result.halls.map(h => new Set(h.seats.map(s => s.dept)).size), [1, 1]);
  assert.throws(() => allocate(cohorts, [
    { floor: 1, hallNo: 1, rows: 1, cols: 2, maxDepartments: 1 }
  ], true, ['Invigilator']), /No arrangement satisfies/);
});

test('assigns one distinct invigilator to each hall', () => {
  const halls = [
    { floor: 1, hallNo: 1, rows: 1, cols: 1, maxDepartments: 1 },
    { floor: 1, hallNo: 2, rows: 1, cols: 1, maxDepartments: 1 }
  ];
  const result = allocate([
    group('A', 'S1', 'A001', 'A001'),
    group('B', 'S2', 'B001', 'B001')
  ], halls, true, ['First', 'Second']);
  assert.deepEqual(result.halls.map(h => h.invigilator), ['First', 'Second']);
  assert.throws(() => allocate([], halls, true, ['Only one']), /Assign an invigilator to each hall/);
  assert.throws(() => allocate([], halls, true, ['Same', 'same']), /only one hall/);
  assert.throws(() => allocate([], [{ ...halls[0], maxDepartments: '' }], true, ['First']), /positive integer/);
});
