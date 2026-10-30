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
4. In Firestore open the **Rules** tab, paste the contents of `firestore.rules`, and **Publish** (this version includes the team lead role).
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
| `js/firebase-config.js` | **Your** Firebase config (edit this) |
| `js/firebase.js` | Initialises Firebase Auth and Firestore |
| `js/auth.js` | Log in, create account, Google sign-in, reset password, log out |
| `js/app.js` | Dashboard, check editor, autosave, Excel export |
| `js/calc.js` | Summary formulas (same logic as the workbook) |
| `firestore.rules` | Security rules: owners full access, leads read-only on all checks |
| `firebase.json` | Firebase Hosting + rules deployment config |
| `.github/workflows/pages.yml` | Auto-deploy to GitHub Pages |

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
Firestore's local cache is enabled, so after one online visit the app opens offline, and you can create and edit checks
without a connection. A banner shows when you're offline, and changes upload automatically when the connection returns.
Notes: log in while online at least once first; keep the tab open until the sync finishes if you can; the cache is per browser.

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

## Data model
`inspections/{id}`: `ownerId`, `ownerName`, `institution{}`, `attendance[]` (max 150 rows), `movement[]` (max 60), `records[13]`, `findings[]` (max 15), `assessment{}`, `signoff{}`, `createdAt`, `updatedAt`.
`users/{uid}`: `name`, `email`, `role` (`monitor` | `lead`), `createdAt`.
