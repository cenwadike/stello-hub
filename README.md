# Kernel Hub website

A one-page website for a co-working space, ICT training centre and software studio, with a request form that writes to Google Sheets and Google Calendar. All free tools. No server to run. For how it fits together, see [Design and architecture](#design-and-architecture) at the end.

```
site.config.json      <- the ONLY file you edit for details (name, city, prices, courses, hours...)
src/                  website templates (index.html, privacy.html, 404.html, robots.txt, sitemap.xml)
apps-script/          Google script template (Code.template.gs)
build.js  dev.js      build and local server
tests/                automated tests
dist/  build/         generated. dist/ = the website, build/Code.gs = the Google script
```

## 1. Setup (5 minutes)

You need Node.js 20 or newer (nodejs.org).

```
npm install
```

Open `site.config.json` and fill in your details. Leave `endpoint` and `gaId` empty for now.
Optional: put a 1200x630 photo of your space at `src/og-image.jpg` (used for link previews).

## 2. Run it locally

```
npm run dev
```

Open http://localhost:8080. The form posts to a fake local endpoint, so you can click through every button and see the data in your terminal. Edits to `src/` or the config rebuild automatically.

## 3. Test it

```
npm test               # 25 checks: SEO, links, structured data, consent, and the Google script's logic
npm run test:e2e       # drives the real page in a browser (see note below)
npm run check:launch   # lists everything still unfinished before you go live
```

For `test:e2e` you need a browser once: `npx playwright-core install chromium`
(or point `CHROMIUM_PATH` at an existing Chrome or Chromium).

## 4. Connect Google (20 minutes)

1. Create a new Google Sheet. Open **Extensions > Apps Script**.
2. Run `npm run build`. Copy the whole of `build/Code.gs` into the Apps Script editor, replacing what is there. Save.
3. Choose the function `setup` in the dropdown and click **Run**. Approve the permissions. This creates the Requests tab, the Status dropdown and the highlighting.
4. In Google Calendar, create two calendars named `<Your name> visits` and `<Your name> desks` (for example "Kernel Hub visits"). Skip this and everything goes on your main calendar.
5. **Deploy > New deployment > Web app.** Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the URL that ends in `/exec`.
6. Paste that URL into `endpoint` in `site.config.json`.
7. Open the URL in your browser. You should see a short "endpoint is running" message.

**Important:** every time you change the script, you must publish a new version: Deploy > Manage deployments > pencil icon > Version: New version > Deploy. Without this the old code keeps running. The URL stays the same.

## 5. Analytics (optional, 10 minutes)

1. Create a Google Analytics 4 property and a web data stream. Copy the ID (looks like `G-ABC123XYZ`) into `gaId`.
2. In GA4, mark the `generate_lead` event as a key event. Other events recorded: `cta_click`, `whatsapp_click`.
3. Analytics only loads after a visitor clicks Accept on the cookie banner.

## 6. Finish the legal page

Edit `src/privacy.html`: replace the bracketed rights line for your country and delete the template note. Have a local lawyer review it. `npm run check:launch` will not pass until you do.

## 7. Check, build, deploy

```
npm run check:launch   # fix anything it lists, repeat until it says "Ready to launch"
npm run build
```

### Cloudflare Pages (recommended: every push redeploys)

1. Push the project to GitHub. `node_modules/`, `dist/` and `build/` are git-ignored on purpose, because Cloudflare builds them.
2. In the project root create a file named `.node-version` containing `22`, and commit it. This makes Cloudflare use a Node version this project supports.
3. In the Cloudflare dashboard go to **Workers & Pages > Create application > Pages > Import an existing Git repository**, and pick the repo.
4. Set **Framework preset: None**, **Build command: `npm run build`**, **Build output directory: `dist`**. Save and Deploy.
5. Open the `<project>.pages.dev` address and make a real booking from your phone.
6. **Custom domain:** in the Pages project open **Custom domains**, add your domain (and `www`), and follow the DNS step it shows. This is automatic if the domain's DNS is already on Cloudflare.
7. From now on: edit `site.config.json`, commit, push. The site rebuilds and goes live.

Notes:
- The build uses your production config, so `endpoint` must already be set when you deploy.
- `src/_headers` becomes Cloudflare's security headers file, and `src/404.html` is served for unknown addresses. Neither needs setup.
- Direct upload also works: run `npm run build`, then `npx wrangler pages deploy dist` (or drag the `dist` folder into the dashboard). A project created that way cannot be switched to Git later.
- Cloudflare's documentation now calls Workers its main platform and keeps Pages supported. Pages suits this static site. If Cloudflare retires it, they publish a migration guide. Dashboard labels change from time to time, so follow the names on screen if they differ from the above.

### Other hosts

- **Netlify:** drag the `dist` folder onto app.netlify.com/drop, or connect the repo (`netlify.toml` already sets the build command and folder).

Then add your domain in the host's settings. HTTPS is automatic.

## 8. After launch

1. **Test for real:** from your phone, make one booking of each type. Confirm the row, the calendar event and both emails.
2. **Google Search Console:** verify your domain and submit `https://yourdomain/sitemap.xml`. This is where you see which searches bring people to you.
3. **Google Business Profile:** create it with the same address and phone as your footer. For a physical space, this matters as much as the site.
4. **Daily routine:** open the Sheet, filter Status = New, reply, update Status. Use the Next step date column for quotes.
5. **Tag links you share** like `https://yourdomain/?utm_source=facebook&utm_medium=post`. The source lands in the Sheet with each enquiry.

## Troubleshooting

| Problem | Cause |
|---|---|
| Form says "We could not send that" | `endpoint` empty or wrong, or the web app is not set to "Anyone" |
| Changes to the script do nothing | You did not deploy a new version (step 4 note) |
| No emails arrive | Check Spam; free Google accounts have a daily email limit |
| Visit rejected as "closed" | Times are checked against `openHour`, `closeHour`, `closedDays` and `timezone` in the config |
| "Build failed: cannot find ... meta" or the build crashes after saving | A code formatter (Prettier, format on save) rewrote `src/index.html`. The build now tolerates this, but turn format-on-save off for `src/` (a `.prettierignore` is included) |
| Banner appears every visit | The browser blocks localStorage (private mode) |

## Known limits

- Requests only; no online payment and no live desk availability. You confirm by WhatsApp and collect payment by hand.
- One page. To rank for separate searches (for example "web development course in your city"), add a page per service.
- No CAPTCHA, only a hidden trap field. Add one if spam appears.
- GA4 only counts visitors who accept cookies, so it undercounts. The Sheet is your complete enquiry count.

---

## Design and architecture

### Goals and constraints

- Free to run, no server to look after, and ready in a day.
- One person can change prices, courses and hours without touching code.
- Good for local search, and measurable, without tracking visitors who decline.
- Hard to break silently: a mistake should fail the build or a test, not reach customers.

### The big picture

```
   VISITOR'S BROWSER                          YOUR GOOGLE ACCOUNT
 +------------------------+  POST (JSON)  +------------------------------------+
 | Static website (dist/) | ------------> | Apps Script web app (Code.gs)      |
 |  index.html, CSS, JS   | <------------ |  1. validate                       |
 |  request form          |  JSON reply   |  2. lock                           |
 +-----------+------------+               |  3. act:                           |
             |                            |     - Calendar: book visit / mark  |
             | only if the visitor        |       desk request                 |
             | clicks Accept              |     - Sheet: add one row           |
             v                            |     - Gmail: alert you, confirm    |
     Google Analytics 4                   |       the customer                 |
                                          +------------------------------------+
```

There is no server of your own. The website is plain files on a static host. Everything that needs to "do something" runs in one small Google script under your account.

### Build pipeline

```
 site.config.json  ----+
 src/*  (templates) ---+--> build.js --> dist/        the website (what you upload)
 apps-script/          |                build/Code.gs  the Google script (what you paste into Google)
   Code.template.gs ---+
```

1. `build.js` reads the config and fills every `{{TOKEN}}` in the templates. An unknown token stops the build with its name and file.
2. Values are HTML-escaped. Course rows, price cards, product items, proof points and select options are generated from the config.
3. Structured data (LocalBusiness and FAQ) is generated from the finished page, so the FAQ in the search results can never differ from the FAQ on the page.
4. The same config fills `Code.template.gs`, so opening hours, timezone and owner email are set once and used by both the website and the script.
5. `npm run dev` does the same build in dev mode: the form posts to a local fake endpoint (`/api/mock`) and rebuilds when files change.

### Why it is built this way

| Decision | Why | What it costs |
|---|---|---|
| Static site, no framework | Free hosting, fast, nothing to patch or secure | Changes need a rebuild and re-upload |
| Google Apps Script as the backend | Free, and you already use Sheets, Calendar and Gmail | Daily quotas, a few seconds of delay, one Google account is a single point of failure |
| A Google Sheet as the database | Staff already know it, and you can filter it today | Not suited to payments, accounts or heavy reporting. Move to a real database if you need those |
| One config file plus templates | One place to edit details | Some copy (service descriptions, FAQ) still lives in `src/index.html` |
| Form posts as `text/plain` | Avoids the browser pre-check request that Apps Script cannot answer | The script must parse the JSON itself |
| Visits book automatically, desks only "request" | A visit is one slot and low risk. A desk needs a person to check capacity and payment | Desk requests need manual confirmation |
| Analytics loads only after Accept | Respects visitors who decline | GA4 undercounts. The Sheet is the complete record |
| One page | Simplest to build and keep consistent | Limits how many different searches you can rank for |

### What happens when someone submits the form

1. The browser checks the required fields for the chosen tab, then sends one JSON object to the Apps Script URL. The "source" records which button was clicked and where the visitor came from (UTM tag or referrer).
2. The script rejects spam (hidden field filled in), unknown request types, and missing name or phone. Text is trimmed and capped at 1000 characters.
3. It takes a script-wide lock, so two people cannot take the same slot at the same moment.
4. **Visit:** checks the date is in the future and inside opening hours, checks the calendar for a clash, then creates the event and invites the customer if they gave an email.
5. **Desk:** creates an all-day event labelled "REQUEST (unconfirmed)" on the desks calendar.
6. **Course or quote:** no calendar action.
7. It adds one row to the Requests sheet with Status "New", then emails you and, if there is an email address, the customer.
8. It replies `{ ok: true, id }` or `{ ok: false, error }`. The page shows the reference number and a WhatsApp button, and records a `generate_lead` event if analytics is allowed.

### The request contract

Anyone replacing the backend only has to keep this contract.

| Field | Used by | Notes |
|---|---|---|
| `type` | all | `desk`, `visit`, `course` or `quote` |
| `name`, `phone` | all | Required. Email is optional |
| `source` | all | Button and traffic source, stored with the row |
| `website` | all | Hidden spam trap. Must be empty |
| `deskPlan`, `deskStart`, `deskDays` | desk | `deskStart` is `YYYY-MM-DD` |
| `visitDate`, `visitTime` | visit | `YYYY-MM-DD` and `HH:mm` in the configured timezone |
| `course`, `courseStart` | course | |
| `brief`, `budget`, `deadline` | quote | |

Reply: `{ "ok": true, "id": "V261124-101500" }` or `{ "ok": false, "error": "message for the visitor" }`.

### Data model (the Requests sheet)

| Column | Filled by | Notes |
|---|---|---|
| Created, ID, Type, Name, Phone, Email, Details, Source | Script | ID is the type's first letter plus date and time. Details is a one-line summary of the type-specific fields |
| Status | Script, then you | New, Contacted, Booked, Paid, Done, Lost (dropdown) |
| Owner, Next step date, Notes | You | Use Next step date for quotes so they are not forgotten |
| Calendar link | Script | Only for visits and desk requests |

### Security and privacy design

- **The endpoint is public.** Anyone with the URL can send it data. Defences: the hidden trap field, an allowed list of request types, required fields, a length cap, the lock, and a guard that stops text beginning with `=`, `+`, `-` or `@` being run as a spreadsheet formula.
- **Not defended:** rate limiting, CAPTCHA and login. A determined spammer could fill the Sheet and use up your daily email allowance. Add a CAPTCHA if that happens.
- **No secrets in the browser.** The only values in the page are the script URL, the WhatsApp number and the analytics ID, all of which are public by nature.
- **Where the data lives:** only in your Google account (Sheets, Calendar, Gmail). The retention period on the privacy page is text only. Nothing deletes old rows for you.
- **Consent:** the choice is stored in the browser under `kh_consent`. No analytics script is requested until the visitor accepts. "Cookie settings" in the footer reopens the choice.

### How it is tested

| Layer | Command | What it proves | What it cannot prove |
|---|---|---|---|
| Static checks | `npm test` | Title and description length, one H1, heading order, working anchors, structured data matches the visible FAQ, CSS variables defined, no references to pages that do not exist, no analytics before consent | That the page looks right |
| Script logic | `npm test` | The Google script, run against fake Google services: validation, double bookings, opening hours, spam trap, formula guard | Real timezones (the fake uses UTC), real quotas, real permissions |
| Browser | `npm run test:e2e` | Banner, consent, every button opens the right tab, a full submission, no sideways scrolling on a phone | The live Google connection |
| Launch gate | `npm run check:launch` | No placeholders, endpoint set, real contact details | That your claims are true |

The first real booking from your phone after deploying is the only test of the live Google connection.

### Changing things

| To change | Edit |
|---|---|
| Prices, courses, products, proof points, hours, contact details | `site.config.json`. If you change opening hours, change `hoursText` and `hoursShort` as well |
| Wording of a service, the FAQ, headings | `src/index.html` |
| Add a form field | The `fieldset` in `src/index.html`, then the matching branch in `apps-script/Code.template.gs` so it is saved. Redeploy the script as a new version |
| Add another page, for example one per service | Put it in `src/` (subfolders work). Add it to `src/sitemap.xml` and the navigation |
| Use a different backend | Keep the request contract above. Point `endpoint` at it |

### Known weaknesses

- Request IDs are based on the second, so two requests in the same second could share an ID.
- Time handling is tested only against fakes. Check one real visit booking at a known local time.
- One Google account is the whole backend. If it is locked or its quota runs out, requests fail with a message that points people to WhatsApp.
- No payments, no live desk availability and no automatic data deletion.
- The page makes claims (equipment, certificates, past results) that no test can check. Keep them true.