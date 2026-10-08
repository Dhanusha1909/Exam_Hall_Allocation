require('dotenv').config();
const express = require('express'), mongoose = require('mongoose'), path = require('path');
const { allocate } = require('./allocator');
const { registerContractRoutes } = require('./contract');
const app = express(); app.use(express.json({ limit: '5mb' })); app.use(express.static(path.join(__dirname, 'public')));
const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Storage: MongoDB Atlas if MONGODB_URI set, else in-memory
const Doc = mongoose.model('Doc', new mongoose.Schema({ key: { type: String, unique: true }, data: mongoose.Schema.Types.Mixed }));
const mem = {}; let useDb = false;
const put = async (key, data) => useDb ? Doc.findOneAndUpdate({ key }, { data }, { upsert: true }) : (mem[key] = data);
const get = async key => useDb ? (await Doc.findOne({ key }))?.data : mem[key];
const makeAllocation = (cfg, unavailableHalls = []) => {
  const unavailable = new Set(unavailableHalls.map(String));
  const activeHalls = cfg.halls
    .map((hall, index) => ({ hall, index }))
    .filter(({ hall }) => !unavailable.has(String(hall.hallNo)));
  return allocate(
    cfg.cohorts,
    activeHalls.map(({ hall }) => hall),
    cfg.strict !== false,
    activeHalls.map(({ index }) => cfg.invigilators?.[index] ?? ''),
    { maxPerRow: cfg.maxPerRow }
  );
};
registerContractRoutes(app, { get, put });

app.post('/api/config', route(async (req, res) => {
  await put('config', req.body);
  await put('unavailableHalls', []);
  res.json({ ok: true });
}));
app.get('/api/config', route(async (req, res) => res.json((await get('config')) || { cohorts: [], halls: [] })));

app.post('/api/allocate', route(async (req, res) => {
  try {
    const cfg = (await get('config')) || req.body;
    const result = makeAllocation(cfg, (await get('unavailableHalls')) || []);
    await put('allocation', result); res.json(result);
  } catch (e) { res.status(422).json({ error: 'ALLOCATION_FAILED', message: e.message }); }
}));
app.post('/api/reallocate', route(async (req, res) => {
  try {
    const cfg = await get('config');
    if (!cfg)     return res.status(404).json({ error: 'NOT_FOUND', message: 'Configuration not found' });
    const hallNo = req.body?.hallNo;
    if (hallNo === undefined || hallNo === null || String(hallNo).trim() === '') {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Choose a hall to mark unavailable.' });
    }
    const hallId = String(hallNo);
    if (!cfg.halls.some(hall => String(hall.hallNo) === hallId)) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Hall not found in the saved configuration.' });
    }
    const unavailableHalls = (await get('unavailableHalls')) || [];
    if (unavailableHalls.some(unavailable => String(unavailable) === hallId)) {
      return res.status(409).json({ error: 'CONFLICT', message: `Hall ${hallId} is already unavailable.` });
    }
    const nextUnavailableHalls = [...unavailableHalls, hallId];
    const result = makeAllocation(cfg, nextUnavailableHalls);
    await put('allocation', result);
    await put('unavailableHalls', nextUnavailableHalls);
    res.json(result);
  } catch (e) { res.status(422).json({ error: 'ALLOCATION_FAILED', message: e.message }); }
}));
app.get('/api/allocation', route(async (req, res) => { const a = await get('allocation'); a ? res.json(a) : res.status(404).json({ error: 'NOT_FOUND', message: 'Not generated yet' }); }));

app.get('/api/search/:reg', route(async (req, res) => {
  const a = await get('allocation'); if (!a) return res.status(404).json({ error: 'NOT_FOUND', message: 'Not generated yet' });
  const reg = req.params.reg.trim().toUpperCase();
  for (const h of a.halls) { const s = h.seats.find(x => x.reg.toUpperCase() === reg);
    if (s) return res.json({ reg: s.reg, studentType: s.studentType, hallNo: h.hallNo, floor: h.floor, row: s.row, col: s.col, seatNo: s.seatNo, dept: s.dept, year: s.year, subject: s.subject }); }
  res.status(404).json({ error: 'NOT_FOUND', message: 'Register number not found' });
}));

const csvHalls = halls => halls.map(h => [
  `Floor ${h.floor} - Hall ${h.hallNo} - Invigilator: ${h.invigilator}`, 'Seat No,Row,Column,Register No,Student Type,Department,Year,Subject',
  ...h.seats.map(s => [s.seatNo, s.row, s.col, s.reg, s.studentType, s.dept, s.year, s.subject].join(',')),
  '', 'Subjects in this hall:', ...h.subjects.map(s => `${s.subject} (${s.dept} - Year ${s.year})`), ''].join('\n')).join('\n');
app.get('/api/export/:type/:id', route(async (req, res) => {
  const a = await get('allocation'); if (!a) return res.status(404).json({ error: 'NOT_FOUND', message: 'Not generated yet' });
  const { type, id } = req.params;
  const sel = a.halls.filter(h => type === 'floor' ? String(h.floor) === id : String(h.hallNo) === id);
  if (!sel.length) return res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
  res.attachment(`${type}-${id}-seating.csv`).type('text/csv').send(csvHalls(sel));
}));

app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'No such endpoint.' }));
app.use((error, _req, res, _next) => {
  const status = error.status === 400 ? 400 : 500;
  const code = status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR';
  if (status === 500) console.error('Request failed:', error);
  res.status(status).json({ error: code, message: status === 400 ? 'Malformed JSON request.' : 'The request could not be completed.' });
});

async function start() {
  if (process.env.MONGODB_URI) { await mongoose.connect(process.env.MONGODB_URI); useDb = true; console.log('MongoDB Atlas connected'); }
  else console.log('No MONGODB_URI: using in-memory storage');
  const port = process.env.PORT || 8080;
  return app.listen(port, () => console.log('http://localhost:' + port));
}

if (require.main === module) {
  start().catch(error => {
    console.error('Failed to start server:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, start };
