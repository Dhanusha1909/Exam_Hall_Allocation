const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./server');

test('implements the locked OpenAPI routes and response contracts', async t => {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };

  const health = await call('/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'ok');
  const preflight = await fetch(`${base}/allocate`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://swagger.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');

  const itemResponse = await call('/items', 'POST', { title: 'Found keys', question: 'blue' });
  assert.equal(itemResponse.status, 201);
  assert.ok(itemResponse.data.id);
  assert.equal((await call('/items?q=keys')).data.total, 1);
  assert.equal((await call(`/items/${itemResponse.data.id}/claim`, 'POST', { claimant: 'Alex', proof: 'wrong' })).status, 403);
  assert.deepEqual((await call(`/items/${itemResponse.data.id}/claim`, 'POST', { claimant: 'Alex', proof: 'blue' })).data, {
    id: itemResponse.data.id, status: 'claimed'
  });

  const eventResponse = await call('/events', 'POST', { title: 'Exam orientation', date: '2026-11-01', venue: 'Main Hall' });
  assert.equal(eventResponse.status, 201);
  assert.equal((await call('/events')).data.length, 1);
  const registration = await call(`/events/${eventResponse.data.id}/register`, 'POST', { name: 'Sam', email: 'sam@example.com' });
  assert.equal(registration.status, 201);
  assert.equal((await call(`/events/${eventResponse.data.id}/register`, 'POST', { name: 'Sam', email: 'sam@example.com' })).status, 409);
  assert.equal((await call(`/certificates/${registration.data.certificate_id}`)).data.valid, true);

  const equipmentResponse = await call('/equipment', 'POST', { name: 'Microscope', quantity: 1 });
  assert.equal(equipmentResponse.status, 201);
  assert.equal((await call('/equipment')).data.length, 1);
  const booking = await call('/bookings', 'POST', {
    equipment_id: equipmentResponse.data.id, user: 'Sam',
    from: '2026-11-01T09:00:00Z', to: '2026-11-01T10:00:00Z'
  });
  assert.equal(booking.status, 201);
  assert.equal((await call('/bookings', 'POST', {
    equipment_id: equipmentResponse.data.id, user: 'Lee',
    from: '2026-11-01T09:30:00Z', to: '2026-11-01T10:30:00Z'
  })).status, 409);
  assert.equal((await call(`/bookings/${booking.data.id}/approve`, 'POST')).data.status, 'approved');
  const multiEquipment = await call('/equipment', 'POST', { name: 'Projector', quantity: 2 });
  for (const [from, to] of [
    ['2026-11-02T09:00:00Z', '2026-11-02T10:00:00Z'],
    ['2026-11-02T10:00:00Z', '2026-11-02T11:00:00Z']
  ]) {
    assert.equal((await call('/bookings', 'POST', {
      equipment_id: multiEquipment.data.id, user: 'Sam', from, to
    })).status, 201);
  }
  assert.equal((await call('/bookings', 'POST', {
    equipment_id: multiEquipment.data.id, user: 'Lee',
    from: '2026-11-02T09:00:00Z', to: '2026-11-02T11:00:00Z'
  })).status, 201);

  const complaint = await call('/complaints', 'POST', {
    student: 'Sam', hostel: 'North', room: '12', category: 'electrical', text: 'Light not working', priority: 'high'
  });
  assert.equal(complaint.status, 201);
  assert.equal((await call('/complaints?status=open&hostel=North')).data.length, 1);
  assert.equal((await call(`/complaints/${complaint.data.id}/status`, 'PATCH', { status: 'in_progress' })).data.status, 'in_progress');

  const configuration = await call('/api/config', 'POST', {
    cohorts: [
      { dept: 'A', year: 1, subject: 'S1', startReg: 'A001', endReg: 'A001' },
      { dept: 'B', year: 2, subject: 'S2', startReg: 'B001', endReg: 'B001' }
    ],
    halls: [{ floor: 1, hallNo: '101', rows: 2, cols: 2, maxDepartments: 2, maxStudents: 2 }],
    invigilators: ['Invigilator']
  });
  assert.equal(configuration.status, 200);
  const hallList = await call('/halls');
  assert.equal(hallList.data[0].id, '101');
  assert.equal(hallList.data[0].maxStudents, 2);
  const studentList = await call('/students?dept=A&year=1');
  assert.equal(studentList.data.length, 1);
  assert.equal(studentList.data[0].studentType, 'normal');
  const allocation = await call('/allocate', 'POST', { exam_id: 'exam-1', rules: { max_per_row: 1 } });
  assert.equal(allocation.status, 200);
  assert.equal(allocation.data.exam_id, 'exam-1');
  assert.equal(allocation.data.allocations.length, 2);
  assert.deepEqual(allocation.data.unseated, []);

  const savedPlan = await call('/api/allocate', 'POST', {});
  assert.equal(savedPlan.status, 200);
  assert.equal((await call('/api/allocation')).data.seated, 2);
  assert.equal((await call('/api/search/A001')).data.hallNo, '101');
  await call('/api/config', 'POST', {
    cohorts: [{ dept: 'A', year: 1, subject: 'S1', startReg: 'A201', endReg: 'A202' }],
    halls: [
      { floor: 1, hallNo: '201', rows: 2, cols: 1, maxDepartments: 1, maxStudents: 2 },
      { floor: 1, hallNo: '202', rows: 2, cols: 1, maxDepartments: 1, maxStudents: 2 }
    ],
    invigilators: ['First', 'Second']
  });
  await call('/api/allocate', 'POST', {});
  const reallocated = await call('/api/reallocate', 'POST', { hallNo: '201' });
  assert.equal(reallocated.data.halls.length, 1);
  assert.equal(reallocated.data.halls[0].hallNo, '202');
  assert.equal((await call('/api/search/A201')).data.hallNo, '202');
  const partialConfig = {
    cohorts: [
      { dept: 'A', year: 1, subject: 'S1', startReg: 'A101', endReg: 'A101' },
      { dept: 'B', year: 1, subject: 'S2', startReg: 'B101', endReg: 'B101' }
    ],
    halls: [{ floor: 1, hallNo: '201', rows: 2, cols: 2, maxDepartments: 2, maxStudents: 1 }],
    invigilators: ['Invigilator']
  };
  await call('/api/config', 'POST', partialConfig);
  const partial = await call('/allocate', 'POST', { exam_id: 'exam-capacity' });
  assert.equal(partial.data.allocations.length, 1);
  assert.equal(partial.data.unseated.length, 1);

  const requesterBook = await call('/books', 'POST', { owner: 'Sam', title: 'Algorithms', author: 'A. Writer' });
  const wantedBook = await call('/books', 'POST', { owner: 'Lee', title: 'Algorithms', author: 'A. Writer' });
  assert.equal((await call('/books?q=algorithm&status=available')).data.length, 2);
  const match = await call(`/books/${wantedBook.data.id}/match`, 'POST', { requester: 'Sam', offered_book_id: requesterBook.data.id });
  assert.equal(match.status, 200);
  assert.equal(match.data.score, 100);
  assert.equal((await call(`/matches/${match.data.match_id}/state`, 'POST', { state: 'accepted' })).data.state, 'accepted');
  assert.equal((await call(`/matches/${match.data.match_id}/state`, 'POST', { state: 'done' })).data.state, 'done');
  const invalidTransition = await call(`/matches/${match.data.match_id}/state`, 'POST', { state: 'accepted' });
  assert.equal(invalidTransition.status, 409);
  assert.ok(invalidTransition.data.error);
});
