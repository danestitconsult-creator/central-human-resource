# Monitoring Checks (Firebase + GitHub Pages)

A web app for the monitoring the directorate does across several aspects of its institutions. Each department has its own
check: **Human Resource** (the Staff Attendance and Movement Checks workbook: Institution details, Attendance, Movement log,
Leave, Records checklist, Findings, Summary) and **EdTech** (the EdTech Monitoring workbook: technology tools, staff
allocation, findings, summary). Monitors log in and record each institution check, and the Summary is calculated live,
exactly like the Excel sheets. Data is saved automatically to Firestore, and each check can be exported back to Excel.

- **Hosting:** GitHub Pages (static files, no build step)
- **Login / account creation:** Firebase Authentication (email + password, Google, password reset)
- **Database:** Cloud Firestore; monitors see only their own checks, team leads can view everyone's (read-only)
- **Offline support:** works with poor connectivity; edits sync automatically when back online
- **Nominal roll cross-check:** HR uploads the nominal roll workbook once; every check then shows the institution's total staff and cross-checks each person
- **Evidence of visit:** photos and short PDFs attached to each check (no paid Firebase Storage plan needed)
- **Optional hosting:** Firebase Hosting as an alternative to GitHub Pages

## 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> > **Add project**.
2. **Build > Authentication > Get started > Sign-in method**: enable **Email/Password** (and **Google** if you want that button to work).
3. **Build > Firestore Database > Create database** (production mode, pick a region close to you).
4. In Firestore open the **Rules** tab, paste the contents of `firestore.rules`, and **Publish** (this version includes the team lead role and the shared institution list).
5. **Project settings (gear) > General > Your apps > Web (`</>`)**: register an app and copy the `firebaseConfig` object.
6. Paste those values into `js/firebase-config.js`.

> The web config is not a secret. Your data is protected by Authentication plus the Firestore rules in step 4.

## 2. Put it on GitHub
```bash
cd attendance-app
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## 3. Turn on GitHub Pages
In the repo: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
The included workflow (`.github/workflows/pages.yml`) deploys on every push to `main`.
Your site will be at `https://<your-username>.github.io/<your-repo>/`.

## 4. Authorise your site domain in Firebase (important)
**Authentication > Settings > Authorized domains > Add domain** > `<your-username>.github.io`.
Without this, login on the live site fails with `auth/unauthorized-domain`.

## Run locally
ES modules need a web server (not `file://`):
```bash
python3 -m http.server 8000     # then open http://localhost:8000
```
`localhost` is authorised in Firebase by default.

## Files
| File | Purpose |
|---|---|
| `index.html` | Page shell: login/sign-up screen and app container |
| `css/style.css` | All styling (light and dark mode, print layout) |
| `sw.js` | Service worker so the app opens offline |
| `manifest.json` | PWA manifest (name, icons, screenshots, shortcut) |
| `icons/`, `splash/`, `screenshots/` | App icons, iPhone launch screens, store screenshots |
| `js/env.js` | Detects iPhone, Home Screen mode and in-app browsers |
| `js/firebase-config.js` | **Your** Firebase config (edit this) |
| `js/firebase.js` | Initialises Firebase Auth and Firestore |
| `js/auth.js` | Log in, create account, Google sign-in, reset password, log out |
| `js/app.js` | Dashboard, check editor, autosave, Excel export |
| `js/calc.js` | Human Resource summary formulas (same logic as the workbook) |
| `js/edtech-calc.js` | EdTech summary formulas: totals, allocation, "adds up" checks (no browser code, tested in Node) |
| `js/roll-core.js` | Nominal roll logic: reads the HR workbook, matches names, cross-checks an attendance list (no browser code, tested in Node) |
| `js/roll.js` | Saves and loads the nominal roll in Firestore |
| `js/evidence.js` | Shrinks photos and prepares evidence files for saving |
| `tests/roll-core.test.mjs` | `node tests/roll-core.test.mjs` checks the matching logic |
| `tests/edtech-calc.test.mjs` | `node tests/edtech-calc.test.mjs` checks the EdTech totals and flags |
| `firestore.rules` | Security rules: owners full access, leads, HR and the Deputy Director read-only on all checks, the EdTech role read-only on EdTech checks, HR can add evidence and upload the roll |
| `firebase.json` | Firebase Hosting + rules deployment config |
| `.github/workflows/pages.yml` | Auto-deploy to GitHub Pages |

## iPhone, iPad and installing as an app (PWA)
The app is a Progressive Web App: it has a `manifest.json`, a service worker (`sw.js`), a full icon set and iPhone launch screens, so it can be installed from the browser or packaged with [PWABuilder](https://www.pwabuilder.com).

**Install on an iPhone:** open the site in **Safari**, tap **Share**, then **Add to Home Screen**. (The app shows a one-time reminder of this in Safari.) Installed apps keep their data longer: Safari can clear a *website's* stored data after about 7 days without use, but Home Screen apps are exempt. Sync (open the app online) before long gaps.

**What was fixed for iPhone**
| Problem on iPhone | Fix |
|---|---|
| Safari zooms into the page whenever a field is tapped | All form text is 16px |
| Content hidden under the notch / home bar | `viewport-fit=cover` and safe-area padding |
| `prompt()` / `confirm()` don't work in Home Screen and wrapped apps | In-app dialogs (placed at the top so the keyboard can't cover them) |
| Page killed the moment you switch apps, losing the last edit | Saves immediately when the app is hidden |
| `navigator.onLine` is unreliable, so saving could freeze | Saves and loads time out after a few seconds and use the copy on the phone |
| Excel download does nothing in a Home Screen app | iPhone opens the Share sheet (Save to Files, Mail, WhatsApp) |
| Google sign-in is blocked in Home Screen / in-app browsers | Google button hidden there; email + password works everywhere |
| Wide tables need sideways scrolling | Each row becomes a compact card on phones |
| Date/time fields collapse or look empty | Consistent styling, with picker icons |
| Buttons stuck highlighted after a tap | Hover effects only on devices that hover |
| Tiny tap targets | 44px minimum |
| White flash when launching from the Home Screen | Launch screens for iPhone 5s up to iPhone 17 / Air / Pro Max |
| Phone numbers auto-linked, emails auto-capitalised | `format-detection` off; email fields turn capitals and autocorrect off |
| Firestore multi-tab cache problems on Safari | Single-tab cache on iOS |

**Package with PWABuilder**
1. Deploy to GitHub Pages first (PWABuilder needs a public HTTPS address, e.g. `https://<you>.github.io/<repo>/`).
2. Go to <https://www.pwabuilder.com>, enter that address and **Start**. The manifest, service worker and icons should all score green.
3. **Package for stores** and choose a platform:
   - **Android** (Google Play): free to build, needs a one-time Google Play developer fee. Keep the signing key PWABuilder gives you.
   - **iOS** (App Store): needs a Mac with Xcode and an Apple Developer account. Apple may reject apps that are only a website wrapper, so add something native-feeling or explain the offline and field-use value in the review notes.
   - **Windows** (Microsoft Store).
4. In the packaged iOS app, Google sign-in is unavailable (Google blocks it in embedded browsers), so users log in with email and password.

**Icons** are in `icons/`: `icon-*.png` (any), `maskable-192/512.png` (Android adaptive), `apple-touch-icon*.png` (iPhone/iPad, opaque as iOS requires), `favicon-*.png`, `favicon.ico` and the source `icon.svg`. The kente strip at the bottom of the icon is a nod to Ghana. To change the artwork, edit `icons/icon.svg` and re-export the PNGs at the same sizes.

**Shortcut:** long-pressing the installed app icon offers **New check** (it opens `#/new`).

## Look and feel
- Colours come from the Central Region: Atlantic teal, a whitewashed neutral background and a thin kente-inspired strip. Change the palette in the `:root` block at the top of `css/style.css`.
- Fonts are **Bricolage Grotesque** (headings) and **Public Sans** (text), loaded from Google Fonts with system-font fallbacks.
- Light and dark mode follow the device setting. Status colours always mean the same thing: green = good / on time / Yes, amber = late, red = absent / No, blue = approved absence / N/A.
- The Summary tab has animated gauges, an attendance breakdown bar and a "Needs attention" row. It prints cleanly with the Print summary button.
- Dashboard cards show each check's attendance rate, so you can see which institutions need follow-up at a glance.

## Team lead role (see all monitors' checks)
Every new account is a **monitor** (sees and edits only their own checks). To make someone a **team lead**:
1. They create an account and log in once (this creates their profile).
2. Firebase console > **Firestore Database > Data > `users`** > open their document (find it by `email`).
3. Change the `role` field from `monitor` to `lead`.
4. They log out and back in.

Leads get a **My checks / All monitors** switch on the dashboard with a filter box (institution, location or monitor name).
Other monitors' checks open in **read-only** mode (leads can still use Export Excel and Print). The security rules
block anyone from promoting themselves; roles can only be changed in the console.

## HR role
HR sees every monitor's checks (read-only, like a team lead) and can also **add evidence to any check** and **upload the nominal roll**.
To make someone HR, follow the team lead steps above but set `role` to `hr`, then **publish the new `firestore.rules`** (it adds the `hr` role, the `roll` collection and the evidence rules).
Monitors, leads and HR can all *read* the nominal roll; only HR can change it.

## My profile and photo
Everyone has a **My profile** page: click your photo (or initials) in the top bar. You can upload, change or remove your photo, and see your name, role and how many checks you have recorded. The photo is cropped to a square, shrunk to about 20 to 40 KB and saved on your own profile, so no Firebase Storage plan is needed. It shows in the top bar on every device you sign in on. Other people cannot see your photo (the rules only let you read your own profile).

## School codes
Every institution can have a **school code**. HR and team leads keep the list: on the **Nominal roll** page the institutions table has a *School code* column that they can edit, or they can type the code in the **School code** box on a check's Institution tab, which updates the list for everyone. When anyone chooses an institution on a check, its code is filled in automatically (monitors cannot change a listed code, but can type one for the check if the institution has none yet). The code is shown in the check's header, the Institution tab, the Summary and printout, the dashboard cards (and their search), the Excel export, and to everyone who opens the check read-only, including the head of the institution's checks that are shared with them, the Deputy Director, HR and team leads. The codes are stored in `config/schoolCodes`; **publish the updated `firestore.rules`** so HR and team leads can save them.

## Deputy Director role (supervisory)
The **Deputy Director** (`role` = `deputy`) can open **every monitoring record in every department**: all Human Resource and EdTech checks, with their evidence, from every monitor. The view is read-only. The Deputy Director opens on **All monitors** and can switch between the Human Resource and EdTech tabs. Set the role the same way as the team lead, and **publish the updated `firestore.rules`**.

## Leave tab (Human Resource checks)
The **Leave** tab records staff on leave at the institution: name, type of leave (annual, sick, maternity, paternity, study, casual or compassionate, other), the first and last day, and remarks. The app works out the **duration in days** (both days counted), the day the person is **due back**, and whether the person is on leave on the day of the check. If the HR nominal roll marks staff as on leave, one click adds them to the list. The Summary shows the number on leave, total and average days and the longest leave, and flags anyone **on leave who signed or is present on the attendance sheet**. The Excel export has a **Leave** sheet.

## EdTech role
The **EdTech** role is for the EdTech department's own officers. They see only the **EdTech** tab (no Human Resource tab), can switch between **My checks** and **All monitors** to read every EdTech check (read-only), and can **add or remove evidence on any EdTech check**. They cannot open Human Resource checks. Team leads and HR still see both departments.
To make someone an EdTech officer, follow the team lead steps above but set `role` to `edtech`, then **publish the new `firestore.rules`** (it adds the `edtech` role). Their own new checks are always EdTech checks.

## Nominal roll (cross-check staff against HR records)
1. Log in as HR and open **Nominal roll** in the top bar (`#/roll`).
2. **Import nominal roll (.xlsx)** and choose the HR workbook (one sheet per institution, like `CENTRAL_REGION_OFFICE_NOMINAL_ROLL_DATA_SEPTEMBER_2026.xlsx`).
   The app reads every sheet, shows what it found (staff per sheet, institutions not yet in the list, repeated employee numbers) and asks you to confirm.
   Importing again replaces the roll for the sheets in the file, so re-import when HR sends a new version.
3. Sheets are matched to institutions by name, ignoring spaces and capitals (`BIRIWATECHNICAL` = `BIRIWA TECHNICAL`). Before saving, a window asks which institution each sheet is for. Matching sheets are pre-selected; a sheet called something else (such as `Sheet1` in a one-institution workbook) must be assigned to an institution from the list.
4. HR can **Delete** the roll of any institution from the table on the Nominal roll page (for example one imported under the wrong name), then import it again.

**Privacy:** only each person's **name, employee number, job and at-post / on-leave** are saved. Bank accounts, SSNIT and Ghana Card numbers, dates of birth and phone numbers never leave the HR workbook. Do not commit the workbook to GitHub: a GitHub Pages site is public. The roll lives in Firestore, behind login and the security rules.

**What monitors and HR see**
- **Institution tab:** *Total staff on HR nominal roll* sits beside the total the monitor enters, with a **Use this number** button. The monitor's own box is pre-filled from the roll the first time.
- **Attendance tab:** the name box suggests names from that institution's roll (the job appears beside each); picking one fills the Grade with their job. An **On roll? / Not on roll** badge shows beside each name.
- **Nominal roll tab:** every person on the roll with their status for this check (On time, Late, Absent… or *Not yet checked*), counts, a filter, **Add to attendance** per person and **Add all not yet checked**. Names are matched in any order and ignoring case and hyphens, and a name needs at least two words to match.
- **Summary / Excel export:** adds the HR roll total, how many roll staff were checked, how many were not, and staff listed who are not on the roll. The Excel file gets a **Nominal Roll Check** sheet.
- **Dashboard cards** show *staff listed / roll total*.
- **Nominal roll page:** totals per institution, and a search across all institutions (by name, employee number or job) to cross-check a specific person.

## Evidence of visit
The **Evidence** tab on every check holds photos (register, movement book, signed findings, staff on site) and short PDFs.
- **Who can add:** the monitor who owns the check, and HR (on any check). Team leads can view. Files can be removed by whoever added them, the check's owner, or HR.
- **Photos** are shrunk in the browser (longest side 1400 px, JPEG) before saving, so a phone photo becomes roughly 150 to 400 KB. **PDFs** can be up to 600 KB; for longer documents photograph the pages. Up to 25 files per check.
- Files are stored inside Firestore (`inspections/{id}/evidence`), so it works on the free Spark plan and offline (files sync when the connection returns). If you later need large files or video, switch to Firebase Storage (needs the Blaze plan).
- Deleting a check also deletes its evidence.

## Offline support
Two things make this work, and both are included:
- **Firestore's local cache** stores your checks in the browser, so you can create and edit them without a connection.
  Changes upload automatically when the connection returns (a banner shows when you're offline).
- **A service worker (`sw.js`)** caches the app's own files, the Firebase libraries and the fonts so the page itself opens offline.

Notes: open and log in while online at least once on each device first; after you deploy an update, refresh once so the
new version is picked up (or close and reopen the installed app); the cache is per browser; keep the tab open until the sync finishes if you can.

## Optional: host on Firebase Hosting instead of (or as well as) GitHub Pages
```bash
npm install -g firebase-tools
firebase login
firebase init hosting     # choose your project, public directory ".", single-page app: No, don't overwrite index.html
firebase deploy --only hosting,firestore:rules
```
`firebase.json` is already configured. Your site will be at `https://<project-id>.web.app`
(this domain is authorised for login automatically).

## Custom domain
- **GitHub Pages:** repo Settings > Pages > Custom domain, then add the DNS records GitHub shows you.
- **Firebase Hosting:** Hosting > Add custom domain, then add the DNS records shown.
- Either way, also add the domain under **Authentication > Settings > Authorized domains**.

## Institution list, districts and categories
- **Name of institution** is a dropdown, sorted A to Z, pre-filled with the 20 Central Region institutions. **+ Add** adds a new name (saved in capitals) and **Delete** removes the selected one from the list. The list is shared by all users and stored in Firestore at EdTech checks use `institution{}`, `tools[]` (first 3 rows fixed: item, quantity, distributed, stores, condition, remarks; max 20), `allocation[]` (type, staff, dept, quantity, condition, remarks; max 200), `findings[]`, `assessment{}` and `signoff{}` instead of the attendance fields.
`config/schoolCodes` (`codes`: institution name to school code), `config/institutions`. Deleting a name never deletes checks already recorded for it.
- By default **any signed-in user** can add or delete institutions. To limit this to team leads, change `allow write: if signedIn();` to `allow write: if isLead();` in `firestore.rules` for `config/institutions`.
- **Location / district** is a dropdown of the 22 Central Region assemblies (change it any time by picking another). The list is in `DISTRICTS` in `js/app.js`.
- **Staff categories covered** is a dropdown where you tick one or more of: Principals, Regional Staff, Institute staff, NSS Personnels, Voluntary Staff (`STAFF_CATEGORIES` in `js/app.js`).
- All Yes/No answers (Signed register, Physically present, In movement book) use the words **Yes / No**. Older checks saved with Y/N are converted automatically.
- The Attendance tab has a **Grade** column.

## Departments: Human Resource and EdTech
The dashboard has two tabs, **Human Resource** (the attendance and movement check, listed first) and **EdTech**. Each check belongs to one department and each tab lists only its own checks. Everything else works the same way for both: autosave, offline use, evidence photos, Excel export, printing, and leads/HR viewing every monitor's checks read-only.

The **EdTech** check follows the EdTech monitoring workbook:
- **Institution**: institution, district, head, date, type of check, team and times (the institution list is shared with Human Resource).
- **Technology tools**: desktops, laptops and SM1 tablets are fixed rows, plus any number of "Others" rows. Each row has Quantities, Distributed, Stores, Condition and Remarks, and shows live whether Distributed + Stores adds up to Quantities.
- **Staff allocation**: who holds which item, with department, quantity, condition and remarks. Names are suggested from the HR nominal roll and marked **On roll / Not on roll**.
- **Findings**, **Evidence** and **Summary**: findings, assessment and sign-off, evidence photos, and a summary that mirrors the workbook's SUMMARY sheet plus rates and a "needs attention" panel.

Checks saved before EdTech existed have no `department` field and are treated as Human Resource, so nothing needs migrating. The Firestore rules did not change. The home-screen icon has a second shortcut, "New EdTech check" (`#/new/edtech`).

## Data model
`inspections/{id}`: `department` (`hr` | `edtech`; missing means `hr`), `ownerId`, `ownerName`, `institution{}`, `attendance[]` (max 200 rows, each with name, level, grade, dept, signed, arrival, present, status, remarks), `movement[]` (max 60), `records[13]`, `findings[]` (max 15), `assessment{}`, `signoff{}`, `createdAt`, `updatedAt`.
`config/institutions`: `list[]` (shared institution names).
`inspections/{id}/evidence/{evId}`: `kind` (`image` | `pdf`), `data` (the file as a data URL), `name`, `size`, `category`, `caption`, `uploadedBy`, `uploadedByName`, `uploadedAt`.
`roll/{institutionKey}`: `institution`, `sheet`, `staff[]` (`no`, `name`, `job`, `post`), `count`, `onLeave`, `importedAt`, `importedBy`, `source`. The key is the institution name in capitals with spaces and punctuation removed.
`users/{uid}`: `name`, `email`, `role` (`monitor` | `lead` | `hr` | `edtech` | `deputy`), `createdAt`.
