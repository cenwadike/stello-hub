/**
 * Stello Hub requests backend (Google Apps Script)
 * One web app receives every website form and does four things:
 *   1. adds a row to the "Requests" sheet
 *   2. books visits (and marks desk requests) on Google Calendar
 *   3. emails the customer a confirmation
 *   4. emails you a notification
 */

// ---------- generated from site.config.json (edit the config, not this file) ----------
const OWNER_EMAIL   = 'technologies.stello@gmail.com';   // who gets notified
const HUB_NAME      = 'Stello ICT Hub';
const TZ            = 'Africa/Lagos';         // your timezone, e.g. 'Asia/Kolkata'
const VISIT_MINUTES = 30;
const OPEN_HOUR     = 9;                      // 7am
const CLOSE_HOUR    = 21;                     // 10pm
const CLOSED_DAYS   = [0];                    // 0 = Sunday
const VISITS_CAL    = 'Stello ICT Hub visits';    // calendar name (falls back to your main one)
const DESKS_CAL     = 'Stello ICT Hub desks';     // calendar name (falls back to your main one)
const SHEET_NAME    = 'Requests';
// --------------------------------

const HEADERS = ['Created', 'ID', 'Type', 'Name', 'Phone', 'Email', 'Details',
                 'Source', 'Status', 'Owner', 'Next step date', 'Notes', 'Calendar link'];
const TYPES = ['desk', 'visit', 'course', 'quote'];

/** Run this ONCE from the editor to prepare the sheet. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);

  const status = HEADERS.indexOf('Status') + 1;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['New', 'Contacted', 'Booked', 'Paid', 'Done', 'Lost'], true)
    .build();
  sh.getRange(2, status, 1000, 1).setDataValidation(rule);

  const col = sh.getRange(2, status, 1000, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('New').setBackground('#FFC21A').setRanges([col]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Lost').setBackground('#CCCCCC').setRanges([col]).build()
  ]);
  sh.getRange(1, 1, 1, HEADERS.length).createFilter();
  sh.autoResizeColumns(1, HEADERS.length);
}

function doGet() {
  return out({ ok: true, message: HUB_NAME + ' requests endpoint is running' });
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);

    if (d.website) return out({ ok: true });                       // honeypot: bots fill this, humans cannot see it
    const type = String(d.type || '').trim();
    if (TYPES.indexOf(type) === -1) return out({ ok: false, error: 'Unknown request type.' });
    if (!clean(d.name) || !clean(d.phone)) return out({ ok: false, error: 'Please enter your name and phone number.' });

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);                                           // stops two people taking the same slot
    try {
      let calendarLink = '';
      let details = '';

      if (type === 'visit') {
        const r = bookVisit(d);
        if (!r.ok) return out(r);
        calendarLink = r.link;
        details = 'Visit on ' + d.visitDate + ' at ' + d.visitTime;
      } else if (type === 'desk') {
        details = 'Plan: ' + clean(d.deskPlan) + ' | Start: ' + clean(d.deskStart) + ' | Days: ' + clean(d.deskDays);
        calendarLink = markDesk(d);
      } else if (type === 'course') {
        details = 'Course: ' + clean(d.course) + ' | Start: ' + clean(d.courseStart);
      } else {
        details = clean(d.brief) + ' | Budget: ' + clean(d.budget) + ' | Deadline: ' + clean(d.deadline);
      }

      const id = type.charAt(0).toUpperCase() + Utilities.formatDate(new Date(), TZ, 'yyMMdd-HHmmss');
      appendRow([new Date(), id, type, clean(d.name), clean(d.phone), clean(d.email),
                 details, clean(d.source), 'New', '', '', '', calendarLink]);

      notifyOwner(id, type, d, details);
      confirmCustomer(id, type, d);
      return out({ ok: true, id: id });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return out({ ok: false, error: 'Something went wrong. Please message us on WhatsApp.' });
  }
}

// ---------- calendar ----------
function bookVisit(d) {
  const start = Utilities.parseDate(d.visitDate + ' ' + d.visitTime, TZ, 'yyyy-MM-dd HH:mm');
  const end = new Date(start.getTime() + VISIT_MINUTES * 60000);

  if (start < new Date()) return { ok: false, error: 'Please choose a time in the future.' };
  const day = Number(Utilities.formatDate(start, TZ, 'u')) % 7;      // 'u' gives 1 (Mon) to 7 (Sun); %7 makes Sunday 0
  const hour = Number(Utilities.formatDate(start, TZ, 'H'));
  if (CLOSED_DAYS.indexOf(day) !== -1 || hour < OPEN_HOUR || hour >= CLOSE_HOUR) {
    return { ok: false, error: 'We are closed at that time. Please pick a time within opening hours.' };
  }

  const cal = getCal(VISITS_CAL);
  if (cal.getEvents(start, end).length > 0) {
    return { ok: false, error: 'That slot is already taken. Please choose another time.' };
  }

  const opts = { description: 'Phone: ' + clean(d.phone) + '\nBooked from the website.' };
  if (clean(d.email)) { opts.guests = clean(d.email); opts.sendInvites = true; }
  const ev = cal.createEvent('Visit: ' + clean(d.name), start, end, opts);
  return { ok: true, link: eventLink(ev, cal) };
}

function markDesk(d) {
  if (!clean(d.deskStart)) return '';
  const start = Utilities.parseDate(d.deskStart, TZ, 'yyyy-MM-dd');
  const days = Math.max(1, Math.min(Number(d.deskDays) || 1, 31));
  const end = new Date(start.getTime() + days * 86400000);
  const cal = getCal(DESKS_CAL);
  const ev = cal.createAllDayEvent('REQUEST (unconfirmed): ' + clean(d.name), start, end,
    { description: 'Phone: ' + clean(d.phone) + '\nPlan: ' + clean(d.deskPlan) });
  return eventLink(ev, cal);
}

function getCal(name) {
  return CalendarApp.getCalendarsByName(name)[0] || CalendarApp.getDefaultCalendar();
}
function eventLink(ev, cal) {
  const raw = ev.getId().split('@')[0] + ' ' + cal.getId();
  return 'https://calendar.google.com/calendar/u/0/r/eventedit/' +
         Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

// ---------- sheet + email ----------
function appendRow(row) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  sh.appendRow(row.map(function (v) {
    // text starting with = + - @ would be read as a formula; the apostrophe keeps it as plain text
    return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
  }));
}

function notifyOwner(id, type, d, details) {
  MailApp.sendEmail(OWNER_EMAIL, '[' + HUB_NAME + '] New ' + type + ' request ' + id,
    'Name: ' + clean(d.name) + '\nPhone: ' + clean(d.phone) + '\nEmail: ' + clean(d.email) +
    '\n\n' + details + '\n\nSource: ' + clean(d.source) + '\nOpen your Requests sheet to follow up.');
}

function confirmCustomer(id, type, d) {
  if (!clean(d.email)) return;
  const what = { desk: 'desk request', visit: 'visit booking', course: 'course enquiry', quote: 'quote request' }[type];
  MailApp.sendEmail(clean(d.email), HUB_NAME + ': we received your ' + what,
    'Hi ' + clean(d.name) + ',\n\nThanks. We received your ' + what + ' (reference ' + id + ').' +
    '\nWe will contact you on ' + clean(d.phone) + ' within one working day.\n\n' + HUB_NAME);
}

// ---------- helpers ----------
function clean(v) {
  return String(v == null ? '' : v).trim().slice(0, 1000);
}
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
