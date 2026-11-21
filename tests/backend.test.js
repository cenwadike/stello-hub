// Runs the generated Google script (build/Code.gs) against fake Google services to test its logic.
// Limits: the fake treats all times as UTC, so this checks logic, not real timezone handling.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { build } = require('../build');

function sandbox() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-be-')), codeOut = path.join(out, 'Code.gs');
  build({ dev: true, outDir: out, codeOut });
  const rows = [], mails = [], events = [];
  const cal = { getId: () => 'cal@x', getEvents: (s, e) => events.filter(v => v.start < e && v.end > s),
    createEvent(title, start, end, opts) { const ev = { title, start, end, opts, getId: () => 'evt' + events.length + '@google.com' }; events.push(ev); return ev; },
    createAllDayEvent(title, start, end, opts) { const ev = { title, start, end, opts, allDay: true, getId: () => 'day' + events.length + '@google.com' }; events.push(ev); return ev; } };
  const ctx = vm.createContext({
    Utilities: {
      parseDate: (s) => new Date(s.length > 10 ? s.replace(' ', 'T') + ':00Z' : s + 'T00:00:00Z'),
      formatDate: (d, tz, f) => f === 'u' ? String(d.getUTCDay() || 7) : f === 'H' ? String(d.getUTCHours()) : 'T0000',
      base64EncodeWebSafe: s => Buffer.from(s).toString('base64url') },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({ appendRow: r => rows.push(r) }) }) },
    CalendarApp: { getCalendarsByName: () => [cal], getDefaultCalendar: () => cal },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) }, JSON, String, Number, Math, Date });
  vm.runInContext(fs.readFileSync(codeOut, 'utf8'), ctx);
  const post = o => JSON.parse(vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(o) } }).s);
  return { post, rows, mails, events };
}
const base = { name: 'Ada Obi', phone: '+234 801 234 5678', email: 'ada@example.com' };
const visit = (date, time, extra = {}) => ({ ...base, type: 'visit', visitDate: date, visitTime: time, source: 'nav > visit', ...extra });
const MON = '2030-01-07', SUN = '2030-01-06';

test('a valid visit is booked, logged, and both emails go out', () => {
  const t = sandbox(); const r = t.post(visit(MON, '10:00'));
  assert.equal(r.ok, true); assert.equal(t.events.length, 1); assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0][2], 'visit'); assert.equal(t.rows[0][8], 'New'); assert.match(t.rows[0][12], /^https:\/\/calendar\.google\.com/);
  assert.deepEqual(t.mails.map(m => m.to).sort(), ['ada@example.com', 'you@example.com']);
  assert.equal(t.events[0].opts.guests, 'ada@example.com');
});
test('a double booking is rejected and nothing is written', () => {
  const t = sandbox(); t.post(visit(MON, '10:00')); const r = t.post(visit(MON, '10:15', { name: 'Bayo' }));
  assert.equal(r.ok, false); assert.match(r.error, /taken/); assert.equal(t.rows.length, 1);
});
test('visits outside opening hours or on a closed day are rejected', () => {
  const t = sandbox();
  assert.match(t.post(visit(MON, '06:00')).error, /closed/); assert.match(t.post(visit(MON, '22:00')).error, /closed/); assert.match(t.post(visit(SUN, '10:00')).error, /closed/);
  assert.equal(t.rows.length, 0);
});
test('visits in the past are rejected', () => assert.match(sandbox().post(visit('2020-01-06', '10:00')).error, /future/));
test('missing name or phone is rejected', () => {
  const t = sandbox(); assert.equal(t.post({ type: 'quote', name: 'x' }).ok, false); assert.equal(t.post({ type: 'quote', phone: '1' }).ok, false); assert.equal(t.rows.length, 0);
});
test('unknown request type is rejected', () => assert.equal(sandbox().post({ ...base, type: 'hack' }).ok, false));
test('honeypot submissions look successful but are dropped', () => {
  const t = sandbox(); assert.equal(t.post({ ...base, type: 'quote', brief: 'x', website: 'http://spam' }).ok, true); assert.equal(t.rows.length, 0); assert.equal(t.mails.length, 0);
});
test('desk request is logged and marked as an unconfirmed all-day event', () => {
  const t = sandbox(); const r = t.post({ ...base, type: 'desk', deskPlan: 'Weekly', deskStart: MON, deskDays: '5' });
  assert.equal(r.ok, true); assert.equal(t.events[0].allDay, true); assert.match(t.events[0].title, /unconfirmed/);
});
test('course and quote requests log a row without touching the calendar', () => {
  const t = sandbox(); t.post({ ...base, type: 'course', course: 'Python programming' }); t.post({ ...base, type: 'quote', brief: 'Need a website' });
  assert.equal(t.rows.length, 2); assert.equal(t.events.length, 0);
});
test('spreadsheet formula injection is neutralised', () => {
  const t = sandbox(); t.post({ ...base, name: '=HYPERLINK("http://evil","x")', type: 'quote', brief: 'x' });
  assert.ok(t.rows[0][3].startsWith("'="));
});
