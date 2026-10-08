const { randomUUID } = require('crypto');
const { expand, allocate } = require('./allocator');

const today = () => new Date().toISOString().slice(0, 10);
const id = () => randomUUID();
const fail = (res, status, error, message) => res.status(status).json({ error, message });
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;

function registerContractRoutes(app, { get, put }) {
  const list = async key => (await get(key)) || [];
  const save = async (key, values) => put(key, values);
  const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  app.get('/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0' }));

  app.get('/items', route(async (req, res) => {
    const page = Number(req.query.page || 1), limit = Number(req.query.limit || 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
      return fail(res, 400, 'BAD_REQUEST', 'page and limit must be positive integers.');
    }
    if (req.query.status && !['open', 'claimed', 'closed'].includes(req.query.status)) {
      return fail(res, 400, 'BAD_REQUEST', 'Invalid item status.');
    }
    const q = String(req.query.q || '').trim().toLocaleLowerCase();
    let items = await list('f1:items');
    if (req.query.status) items = items.filter(item => item.status === req.query.status);
    if (q) items = items.filter(item => `${item.title} ${item.found_at || ''}`.toLocaleLowerCase().includes(q));
    const total = items.length;
    res.json({ items: items.slice((page - 1) * limit, page * limit).map(({ answer, claimant, ...item }) => item), total });
  }));

  app.post('/items', route(async (req, res) => {
    const { title, found_at, found_on, question, answer, proof } = req.body || {};
    if (!nonEmpty(title) || (found_on !== undefined && !validDate(found_on))) {
      return fail(res, 400, 'BAD_REQUEST', 'A title and a valid found_on date are required.');
    }
    const item = { id: id(), title: title.trim(), status: 'open' };
    if (typeof found_at === 'string') item.found_at = found_at;
    if (found_on) item.found_on = found_on;
    if (typeof question === 'string') item.question = question;
    item.answer = typeof answer === 'string' ? answer : typeof proof === 'string' ? proof : '';
    const items = await list('f1:items');
    items.push(item);
    await save('f1:items', items);
    const { answer: _answer, ...response } = item;
    res.status(201).json(response);
  }));

  app.post('/items/:id/claim', route(async (req, res) => {
    const { claimant, proof } = req.body || {};
    if (!nonEmpty(claimant) || !nonEmpty(proof)) return fail(res, 400, 'BAD_REQUEST', 'claimant and proof are required.');
    const items = await list('f1:items'), item = items.find(value => value.id === req.params.id);
    if (!item) return fail(res, 404, 'NOT_FOUND', 'No such item.');
    if (item.status !== 'open') return fail(res, 409, 'CONFLICT', 'This item is no longer open.');
    const expected = item.answer || item.question;
    if (!expected || expected.trim().toLocaleLowerCase() !== proof.trim().toLocaleLowerCase()) {
      return fail(res, 403, 'PROOF_MISMATCH', 'The provided proof did not match.');
    }
    item.status = 'claimed';
    item.claimant = claimant.trim();
    await save('f1:items', items);
    res.json({ id: item.id, status: 'claimed' });
  }));

  app.get('/events', route(async (_req, res) => res.json(await list('f3:events'))));

  app.post('/events', route(async (req, res) => {
    const { title, date, venue } = req.body || {};
    if (!nonEmpty(title) || !validDate(date)) return fail(res, 400, 'BAD_REQUEST', 'title and a valid date are required.');
    const event = { id: id(), title: title.trim(), date };
    if (typeof venue === 'string') event.venue = venue;
    const events = await list('f3:events');
    events.push(event);
    await save('f3:events', events);
    res.status(201).json(event);
  }));

  app.post('/events/:id/register', route(async (req, res) => {
    const { name, email, dept } = req.body || {};
    if (!nonEmpty(name) || !nonEmpty(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(res, 400, 'BAD_REQUEST', 'A name and valid email address are required.');
    }
    const events = await list('f3:events'), event = events.find(value => value.id === req.params.id);
    if (!event) return fail(res, 404, 'NOT_FOUND', 'No such event.');
    const registrations = await list('f3:registrations');
    if (registrations.some(value => value.event_id === event.id && value.email.toLocaleLowerCase() === email.trim().toLocaleLowerCase())) {
      return fail(res, 409, 'ALREADY_REGISTERED', 'This email is already registered for the event.');
    }
    const reg_id = id(), certificate_id = id();
    registrations.push({ reg_id, certificate_id, event_id: event.id, name: name.trim(), email: email.trim(), dept, issued_on: today() });
    await save('f3:registrations', registrations);
    res.status(201).json({ reg_id, certificate_id });
  }));

  app.get('/certificates/:certificate_id', route(async (req, res) => {
    const registration = (await list('f3:registrations')).find(value => value.certificate_id === req.params.certificate_id);
    if (!registration) return fail(res, 404, 'NOT_FOUND', 'No such certificate.');
    const event = (await list('f3:events')).find(value => value.id === registration.event_id);
    if (!event) return fail(res, 404, 'NOT_FOUND', 'The certificate event no longer exists.');
    res.json({ certificate_id: registration.certificate_id, valid: true, name: registration.name, event: event.title, issued_on: registration.issued_on });
  }));

  app.get('/equipment', route(async (_req, res) => res.json(await list('f4:equipment'))));

  app.post('/equipment', route(async (req, res) => {
    const { name, quantity } = req.body || {};
    if (!nonEmpty(name) || !Number.isInteger(quantity) || quantity < 1) {
      return fail(res, 400, 'BAD_REQUEST', 'name and a positive integer quantity are required.');
    }
    const equipment = { id: id(), name: name.trim(), quantity };
    const items = await list('f4:equipment');
    items.push(equipment);
    await save('f4:equipment', items);
    res.status(201).json(equipment);
  }));

  app.post('/bookings', route(async (req, res) => {
    const { equipment_id, user, from, to } = req.body || {};
    const start = Date.parse(from), end = Date.parse(to);
    if (!nonEmpty(equipment_id) || !nonEmpty(user) || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      return fail(res, 400, 'BAD_REQUEST', 'equipment_id, user, and a valid increasing date-time range are required.');
    }
    const equipment = (await list('f4:equipment')).find(value => value.id === equipment_id);
    if (!equipment) return fail(res, 404, 'NOT_FOUND', 'No such equipment.');
    const bookings = await list('f4:bookings');
    const overlaps = bookings.filter(value => value.equipment_id === equipment_id &&
      ['pending', 'approved'].includes(value.status) && Date.parse(value.from) < end && Date.parse(value.to) > start);
    const events = overlaps.flatMap(value => [
      { time: Math.max(start, Date.parse(value.from)), change: 1 },
      { time: Math.min(end, Date.parse(value.to)), change: -1 }
    ]).sort((a, b) => a.time - b.time || a.change - b.change);
    let concurrent = 0, full = false;
    for (const event of events) {
      concurrent += event.change;
      if (concurrent >= equipment.quantity) full = true;
    }
    if (full) return fail(res, 409, 'SLOT_CONFLICT', 'The requested time slot is fully booked.');
    const booking = { id: id(), equipment_id, user: user.trim(), from: new Date(start).toISOString(), to: new Date(end).toISOString(), status: 'pending' };
    bookings.push(booking);
    await save('f4:bookings', bookings);
    res.status(201).json(booking);
  }));

  app.post('/bookings/:id/approve', route(async (req, res) => {
    const bookings = await list('f4:bookings'), booking = bookings.find(value => value.id === req.params.id);
    if (!booking) return fail(res, 404, 'NOT_FOUND', 'No such booking.');
    if (booking.status !== 'pending') return fail(res, 409, 'INVALID_TRANSITION', 'Only pending bookings can be approved.');
    booking.status = 'approved';
    await save('f4:bookings', bookings);
    res.json({ id: booking.id, status: booking.status });
  }));

  app.get('/complaints', route(async (req, res) => {
    const validStatuses = ['open', 'in_progress', 'escalated', 'closed'];
    if (req.query.status && !validStatuses.includes(req.query.status)) return fail(res, 400, 'BAD_REQUEST', 'Invalid complaint status.');
    let complaints = await list('f5:complaints');
    if (req.query.status) complaints = complaints.filter(value => value.status === req.query.status);
    if (req.query.hostel) complaints = complaints.filter(value => value.hostel === req.query.hostel);
    res.json(complaints);
  }));

  app.post('/complaints', route(async (req, res) => {
    const { student, hostel, room, category, text, priority = 'normal' } = req.body || {};
    if (![student, hostel, room, category, text].every(nonEmpty) ||
      !['electrical', 'plumbing', 'cleaning', 'other'].includes(category) ||
      !['low', 'normal', 'high'].includes(priority)) {
      return fail(res, 400, 'BAD_REQUEST', 'Provide student, hostel, room, category, text, and a valid priority.');
    }
    const raised = new Date(), slaHours = { high: 4, normal: 24, low: 72 }[priority];
    const complaint = {
      id: id(), student: student.trim(), hostel: hostel.trim(), room: room.trim(), category, text: text.trim(),
      priority, status: 'open', raised_on: raised.toISOString(), sla_due_at: new Date(raised.getTime() + slaHours * 3600000).toISOString(), breached: false
    };
    const complaints = await list('f5:complaints');
    complaints.push(complaint);
    await save('f5:complaints', complaints);
    res.status(201).json(complaint);
  }));

  app.patch('/complaints/:id/status', route(async (req, res) => {
    const { status, note } = req.body || {};
    if (!['open', 'in_progress', 'escalated', 'closed'].includes(status)) return fail(res, 400, 'BAD_REQUEST', 'Invalid complaint status.');
    const complaints = await list('f5:complaints'), complaint = complaints.find(value => value.id === req.params.id);
    if (!complaint) return fail(res, 404, 'NOT_FOUND', 'No such complaint.');
    complaint.status = status;
    complaint.breached = status !== 'closed' && Date.now() > Date.parse(complaint.sla_due_at);
    if (typeof note === 'string' && note.trim()) complaint.note = note.trim();
    await save('f5:complaints', complaints);
    res.json(complaint);
  }));

  app.get('/halls', route(async (_req, res) => {
    const cfg = await get('config');
    res.json((cfg?.halls || []).map(hall => ({
      id: String(hall.hallNo), name: `Floor ${hall.floor} - Hall ${hall.hallNo}`,
      floor: hall.floor, hallNo: String(hall.hallNo), rows: hall.rows, cols: hall.cols,
      maxDepartments: hall.maxDepartments ?? 2, maxStudents: hall.maxStudents ?? hall.rows * hall.cols,
      blocked: hall.blocked || []
    })));
  }));

  app.get('/students', route(async (req, res) => {
    if (req.query.year !== undefined && !/^-?\d+$/.test(String(req.query.year))) return fail(res, 400, 'BAD_REQUEST', 'year must be an integer.');
    const cfg = await get('config');
    const students = [];
    for (const cohort of cfg?.cohorts || []) {
      const normal = expand(cohort.startReg, cohort.endReg);
      const categorized = [
        ['normal', normal],
        ['lateral', cohort.lateralRegs || cohort.extraRegs || []],
        ['transfer', cohort.transferRegs || []]
      ];
      const uniqueStudents = new Map();
      for (const [studentType, registers] of categorized) for (const reg of registers) {
        if (!uniqueStudents.has(reg)) uniqueStudents.set(reg, studentType);
      }
      for (const [reg, studentType] of uniqueStudents) {
        students.push({
          id: String(reg), name: String(reg), dept: String(cohort.dept), year: Number(cohort.year),
          subject: String(cohort.subject), studentType
        });
      }
    }
    const filtered = students.filter(student =>
      (!req.query.dept || student.dept === req.query.dept) &&
      (req.query.year === undefined || student.year === Number(req.query.year)));
    res.json(filtered);
  }));

  app.post('/allocate', route(async (req, res) => {
    const { exam_id, rules = {} } = req.body || {};
    if (!nonEmpty(exam_id) || !rules || typeof rules !== 'object' || Array.isArray(rules)) {
      return fail(res, 400, 'BAD_REQUEST', 'exam_id and a valid rules object are required.');
    }
    if (rules.same_dept_adjacent !== undefined && typeof rules.same_dept_adjacent !== 'boolean') {
      return fail(res, 400, 'BAD_REQUEST', 'same_dept_adjacent must be a boolean.');
    }
    const maxPerRow = rules.max_per_row === undefined ? 2 : rules.max_per_row;
    if (!Number.isInteger(maxPerRow) || maxPerRow < 1) return fail(res, 400, 'BAD_REQUEST', 'max_per_row must be a positive integer.');
    const cfg = await get('config');
    const sourceHalls = cfg?.halls || [], sourceCohorts = cfg?.cohorts || [];
    const unavailable = new Set(((await get('unavailableHalls')) || []).map(String));
    const active = sourceHalls.filter(hall => !unavailable.has(String(hall.hallNo)));
    const students = [];
    for (const cohort of sourceCohorts) {
      for (const reg of [...new Set([...expand(cohort.startReg, cohort.endReg), ...(cohort.lateralRegs || cohort.extraRegs || []), ...(cohort.transferRegs || [])])]) {
        students.push({ id: String(reg), name: String(reg), dept: String(cohort.dept), year: Number(cohort.year), subject: cohort.subject });
      }
    }
    if (!active.length || !students.length) {
      const result = { exam_id, allocations: [], unseated: students.map(student => student.id) };
      await put(`f7:allocation:${exam_id}`, result);
      return res.json(result);
    }
    const totalCapacity = active.reduce((sum, hall) => {
      const blocked = new Set((hall.blocked || []).map(String).filter(value => {
        const match = /^(\d+)-(\d+)$/.exec(value);
        return match && Number(match[1]) >= 1 && Number(match[1]) <= hall.rows &&
          Number(match[2]) >= 1 && Number(match[2]) <= hall.cols;
      }));
      let usable = Math.max(0, hall.rows * hall.cols - blocked.size);
      if (hall.maxStudents !== undefined && hall.maxStudents !== '') usable = Math.min(usable, Number(hall.maxStudents));
      return sum + usable;
    }, 0);
    const selected = students.slice(0, totalCapacity);
    const cohorts = selected.map(student => ({
      dept: student.dept, year: student.year, subject: student.subject,
      startReg: student.id, endReg: student.id
    }));
    let result;
    try {
      const allocation = allocate(cohorts, active, rules.same_dept_adjacent === true,
        active.map(hall => cfg.invigilators?.[sourceHalls.indexOf(hall)] || `Invigilator ${hall.hallNo}`),
        { maxPerRow, sameDeptAdjacent: rules.same_dept_adjacent === true });
      const allocations = allocation.halls.flatMap(hall => hall.seats.map(seat => ({
        hall: String(hall.hallNo), seat: String(seat.seatNo), student: String(seat.reg)
      })));
      const seated = new Set(allocations.map(value => value.student));
      result = { exam_id, allocations, unseated: students.filter(student => !seated.has(student.id)).map(student => student.id) };
    } catch (error) {
      if (!/No arrangement satisfies|Not enough seats/.test(error.message)) throw error;
      result = { exam_id, allocations: [], unseated: students.map(student => student.id) };
    }
    await put(`f7:allocation:${exam_id}`, result);
    res.json(result);
  }));

  app.get('/books', route(async (req, res) => {
    if (req.query.status && !['available', 'matched', 'exchanged'].includes(req.query.status)) {
      return fail(res, 400, 'BAD_REQUEST', 'Invalid book status.');
    }
    const q = String(req.query.q || '').trim().toLocaleLowerCase();
    let books = await list('f8:books');
    if (req.query.owner) books = books.filter(book => book.owner === req.query.owner);
    if (req.query.status) books = books.filter(book => book.status === req.query.status);
    if (q) books = books.filter(book => `${book.title} ${book.author || ''} ${book.isbn || ''}`.toLocaleLowerCase().includes(q));
    res.json(books);
  }));

  app.post('/books', route(async (req, res) => {
    const { owner, title, author, isbn, condition } = req.body || {};
    if (![owner, title, author].every(nonEmpty) || (condition !== undefined && !['new', 'good', 'worn'].includes(condition))) {
      return fail(res, 400, 'BAD_REQUEST', 'owner, title, author, and a valid optional condition are required.');
    }
    const book = { id: id(), owner: owner.trim(), title: title.trim(), author: author.trim(), status: 'available' };
    if (typeof isbn === 'string') book.isbn = isbn;
    if (condition) book.condition = condition;
    const books = await list('f8:books');
    books.push(book);
    await save('f8:books', books);
    res.status(201).json(book);
  }));

  app.post('/books/:id/match', route(async (req, res) => {
    const { requester, offered_book_id } = req.body || {};
    if (!nonEmpty(requester) || !nonEmpty(offered_book_id)) return fail(res, 400, 'BAD_REQUEST', 'requester and offered_book_id are required.');
    const books = await list('f8:books');
    const wanted = books.find(book => book.id === req.params.id);
    const offered = books.find(book => book.id === offered_book_id);
    if (!wanted || !offered) return fail(res, 404, 'NOT_FOUND', 'One or both books could not be found.');
    if (wanted.status !== 'available' || offered.status !== 'available' || wanted.owner === requester || offered.owner !== requester) {
      return fail(res, 409, 'CONFLICT', 'The requested book must be available and the offered book must belong to the requester.');
    }
    const normalize = value => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const score = (normalize(wanted.title) === normalize(offered.title) ? 50 : 0) +
      (normalize(wanted.author) === normalize(offered.author) ? 50 : 0);
    const match = { match_id: id(), score, state: 'proposed', book_ids: [wanted.id, offered.id] };
    const matches = await list('f8:matches');
    matches.push(match);
    wanted.status = 'matched';
    offered.status = 'matched';
    await Promise.all([save('f8:matches', matches), save('f8:books', books)]);
    res.json({ match_id: match.match_id, score: match.score, state: match.state });
  }));

  app.post('/matches/:id/state', route(async (req, res) => {
    const { state } = req.body || {};
    if (!['proposed', 'accepted', 'declined', 'done'].includes(state)) return fail(res, 400, 'BAD_REQUEST', 'Invalid match state.');
    const matches = await list('f8:matches'), match = matches.find(value => value.match_id === req.params.id);
    if (!match) return fail(res, 404, 'NOT_FOUND', 'No such match.');
    const allowed = { proposed: ['accepted', 'declined'], accepted: ['done'], declined: [], done: [] };
    if (!allowed[match.state].includes(state)) return fail(res, 409, 'INVALID_TRANSITION', `Cannot move a ${match.state} match to ${state}.`);
    match.state = state;
    await save('f8:matches', matches);
    const books = await list('f8:books');
    for (const book of books) if (match.book_ids.includes(book.id)) book.status = state === 'declined' ? 'available' : state === 'done' ? 'exchanged' : 'matched';
    await save('f8:books', books);
    res.json({ match_id: match.match_id, state: match.state });
  }));
}

module.exports = { registerContractRoutes };
