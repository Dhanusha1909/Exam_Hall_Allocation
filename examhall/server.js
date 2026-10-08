require('dotenv').config();
const express = require('express'), mongoose = require('mongoose'), path = require('path');
const { allocate } = require('./allocator');
const app = express(); app.use(express.json({ limit: '5mb' })); app.use(express.static(path.join(__dirname, 'public')));

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
    activeHalls.map(({ index }) => cfg.invigilators?.[index] ?? '')
  );
};

// NOTE: align paths/payloads with the locked openapi.yaml if they differ.
app.post('/api/config', async (req, res) => {
  await put('config', req.body);
  await put('unavailableHalls', []);
  res.json({ ok: true });
});
app.get('/api/config', async (req, res) => res.json((await get('config')) || { cohorts: [], halls: [] }));

app.post('/api/allocate', async (req, res) => {
  try {
    const cfg = (await get('config')) || req.body;
    const result = makeAllocation(cfg, (await get('unavailableHalls')) || []);
    await put('allocation', result); res.json(result);
  } catch (e) { res.status(422).json({ error: e.message }); }
});
app.post('/api/reallocate', async (req, res) => {
  try {
    const cfg = await get('config');
    if (!cfg) return res.status(404).json({ error: 'Configuration not found' });
    const hallNo = req.body?.hallNo;
    if (hallNo === undefined || hallNo === null || String(hallNo).trim() === '') {
      return res.status(400).json({ error: 'Choose a hall to mark unavailable.' });
    }
    const hallId = String(hallNo);
    if (!cfg.halls.some(hall => String(hall.hallNo) === hallId)) {
      return res.status(404).json({ error: 'Hall not found in the saved configuration.' });
    }
    const unavailableHalls = (await get('unavailableHalls')) || [];
    if (unavailableHalls.some(unavailable => String(unavailable) === hallId)) {
      return res.status(409).json({ error: `Hall ${hallId} is already unavailable.` });
    }
    const nextUnavailableHalls = [...unavailableHalls, hallId];
    const result = makeAllocation(cfg, nextUnavailableHalls);
    await put('allocation', result);
    await put('unavailableHalls', nextUnavailableHalls);
    res.json(result);
  } catch (e) { res.status(422).json({ error: e.message }); }
});
app.get('/api/allocation', async (req, res) => { const a = await get('allocation'); a ? res.json(a) : res.status(404).json({ error: 'Not generated yet' }); });

app.get('/api/search/:reg', async (req, res) => {
  const a = await get('allocation'); if (!a) return res.status(404).json({ error: 'Not generated yet' });
  const reg = req.params.reg.trim().toUpperCase();
  for (const h of a.halls) { const s = h.seats.find(x => x.reg.toUpperCase() === reg);
    if (s) return res.json({ reg: s.reg, studentType: s.studentType, hallNo: h.hallNo, floor: h.floor, row: s.row, col: s.col, seatNo: s.seatNo, dept: s.dept, year: s.year, subject: s.subject }); }
  res.status(404).json({ error: 'Register number not found' });
});

const csvHalls = halls => halls.map(h => [
  `Floor ${h.floor} - Hall ${h.hallNo} - Invigilator: ${h.invigilator}`, 'Seat No,Row,Column,Register No,Student Type,Department,Year,Subject',
  ...h.seats.map(s => [s.seatNo, s.row, s.col, s.reg, s.studentType, s.dept, s.year, s.subject].join(',')),
  '', 'Subjects in this hall:', ...h.subjects.map(s => `${s.subject} (${s.dept} - Year ${s.year})`), ''].join('\n')).join('\n');
app.get('/api/export/:type/:id', async (req, res) => {
  const a = await get('allocation'); if (!a) return res.status(404).json({ error: 'Not generated yet' });
  const { type, id } = req.params;
  const sel = a.halls.filter(h => type === 'floor' ? String(h.floor) === id : String(h.hallNo) === id);
  if (!sel.length) return res.status(404).json({ error: 'Not found' });
  res.attachment(`${type}-${id}-seating.csv`).type('text/csv').send(csvHalls(sel));
});

(async () => {
  if (process.env.MONGODB_URI) { await mongoose.connect(process.env.MONGODB_URI); useDb = true; console.log('MongoDB Atlas connected'); }
  else console.log('No MONGODB_URI: using in-memory storage');
  app.listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
})();
