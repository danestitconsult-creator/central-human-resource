# Staff Attendance & Movement Checks (Firebase + GitHub Pages)

A web version of the *Staff Attendance and Movement Checks* workbook. Monitors log in, record each institution check
(Institution details, Attendance, Movement log, Records checklist, Findings, Summary), and the Summary is calculated live,
exactly like the Excel sheet. Data is saved automatically to Firestore, and each check can be exported back to Excel.

- **Hosting:** GitHub Pages (static files, no build step)
- **Login / account creation:** Firebase Authentication (email + password, Google, password reset)
- **Database:** Cloud Firestore; each user can only see their own checks

## 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> > **Add project**.
2. **Build > Authentication > Get started > Sign-in method**: enable **Email/Password** (and **Google** if you want that button to work).
3. **Build > Firestore Database > Create database** (production mode, pick a region close to you).
4. In Firestore open the **Rules** tab, paste the contents of `firestore.rules`, and **Publish**.
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
| `firestore.rules` | Security rules: owner-only access |
| `.github/workflows/pages.yml` | Auto-deploy to GitHub Pages |

## Data model
One Firestore document per check in the `inspections` collection:
`ownerId`, `institution{}`, `attendance[]` (max 150 rows), `movement[]` (max 60), `records[13]`, `findings[]` (max 15), `assessment{}`, `signoff{}`, `createdAt`, `updatedAt`.

## Ideas for next steps
- Let a team lead see all checks from their monitors (add a `role` field in a `users` collection and extend the rules).
- Add Firebase Hosting or a custom domain.
- Add offline support (Firestore persistence) for visits with poor connectivity.
