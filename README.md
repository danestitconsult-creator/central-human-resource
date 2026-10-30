# Staff Attendance & Movement Checks (Firebase + GitHub Pages)

A web version of the *Staff Attendance and Movement Checks* workbook. Monitors log in, record each institution check
(Institution details, Attendance, Movement log, Records checklist, Findings, Summary), and the Summary is calculated live,
exactly like the Excel sheet. Data is saved automatically to Firestore, and each check can be exported back to Excel.

- **Hosting:** GitHub Pages (static files, no build step)
- **Login / account creation:** Firebase Authentication (email + password, Google, password reset)
- **Database:** Cloud Firestore; monitors see only their own checks, team leads can view everyone's (read-only)
- **Offline support:** works with poor connectivity; edits sync automatically when back online
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
| `js/firebase-config.js` | **Your** Firebase config (edit this) |
| `js/firebase.js` | Initialises Firebase Auth and Firestore |
| `js/auth.js` | Log in, create account, Google sign-in, reset password, log out |
| `js/app.js` | Dashboard, check editor, autosave, Excel export |
| `js/calc.js` | Summary formulas (same logic as the workbook) |
| `firestore.rules` | Security rules: owners full access, leads read-only on all checks |
| `firebase.json` | Firebase Hosting + rules deployment config |
| `.github/workflows/pages.yml` | Auto-deploy to GitHub Pages |

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

## Offline support
Two things make this work, and both are included:
- **Firestore's local cache** stores your checks in the browser, so you can create and edit them without a connection.
  Changes upload automatically when the connection returns (a banner shows when you're offline).
- **A service worker (`sw.js`)** caches the app's own files, the Firebase libraries and the fonts so the page itself opens offline.

Notes: open and log in while online at least once on each device first; after you deploy an update, refresh once so the
new version is picked up; the cache is per browser; keep the tab open until the sync finishes if you can.

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
- **Name of institution** is a dropdown, sorted A to Z, pre-filled with the 20 Central Region institutions. **+ Add** adds a new name (saved in capitals) and **Delete** removes the selected one from the list. The list is shared by all users and stored in Firestore at `config/institutions`. Deleting a name never deletes checks already recorded for it.
- By default **any signed-in user** can add or delete institutions. To limit this to team leads, change `allow write: if signedIn();` to `allow write: if isLead();` in `firestore.rules` for `config/institutions`.
- **Location / district** is a dropdown of the 22 Central Region assemblies (change it any time by picking another). The list is in `DISTRICTS` in `js/app.js`.
- **Staff categories covered** is a dropdown where you tick one or more of: Principals, Regional Staff, Institute staff, NSS Personnels, Voluntary Staff (`STAFF_CATEGORIES` in `js/app.js`).
- All Yes/No answers (Signed register, Physically present, In movement book) use the words **Yes / No**. Older checks saved with Y/N are converted automatically.
- The Attendance tab has a **Grade** column.

## Data model
`inspections/{id}`: `ownerId`, `ownerName`, `institution{}`, `attendance[]` (max 150 rows, each with name, level, grade, dept, signed, arrival, present, status, remarks), `movement[]` (max 60), `records[13]`, `findings[]` (max 15), `assessment{}`, `signoff{}`, `createdAt`, `updatedAt`.
`config/institutions`: `list[]` (shared institution names).
`users/{uid}`: `name`, `email`, `role` (`monitor` | `lead`), `createdAt`.
