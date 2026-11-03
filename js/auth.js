import { auth } from "./firebase.js";
import { googleSignInSupported, isEmbeddedWebView } from "./env.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, sendPasswordResetEmail,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const $ = id => document.getElementById(id);

const MESSAGES = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-password": "Please enter your password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/user-not-found": "No account found with that email.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/email-already-in-use": "An account with that email already exists. Try logging in.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "Network error. Check your connection.",
  "auth/popup-closed-by-user": "Sign-in window was closed.",
  "auth/unauthorized-domain": "This website's domain is not authorised in Firebase (Authentication > Settings > Authorized domains).",
  "auth/operation-not-allowed": "This sign-in method is not enabled in the Firebase console.",
  "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow pop-ups for this site, or log in with email and password.",
  "auth/cancelled-popup-request": "Sign-in was cancelled. Please try again.",
  "auth/web-storage-unsupported": "This browser is blocking storage, so sign-in can't work. Open the app in Safari, and turn off Private Browsing.",
  "auth/operation-not-supported-in-this-environment": "Sign-in isn't supported in this browser. Open the app in Safari instead.",
  "auth/internal-error": "Something went wrong signing in. Please try again."
};

function showError(err) {
  const el = $("auth-error");
  el.textContent = typeof err === "string" ? err : (MESSAGES[err.code] || err.message || "Something went wrong.");
  el.classList.remove("hidden");
}
const clearError = () => $("auth-error").classList.add("hidden");

function busy(form, on) {
  form.querySelectorAll("button").forEach(b => (b.disabled = on));
}

export function initAuth(onUser) {
  // Google sign-in can't work inside Home Screen apps or in-app browsers on iPhone: hide it and say what to do instead.
  if (!googleSignInSupported) {
    $("google-btn").classList.add("hidden");
    document.querySelector(".divider").classList.add("hidden");
  }
  if (isEmbeddedWebView) {
    const note = document.createElement("p");
    note.className = "muted small";
    note.textContent = "Tip: if login fails here, open this link in Safari.";
    $("auth-error").after(note);
  }

  // Switch between log in / create account
  document.querySelectorAll("[data-auth-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      clearError();
      const isLogin = btn.dataset.authTab === "login";
      document.querySelectorAll("[data-auth-tab]").forEach(b => b.classList.toggle("active", b === btn));
      $("login-form").classList.toggle("hidden", !isLogin);
      $("signup-form").classList.toggle("hidden", isLogin);
    });
  });

  $("login-form").addEventListener("submit", async e => {
    e.preventDefault(); clearError(); busy(e.target, true);
    try {
      await signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-password").value);
    } catch (err) { showError(err); }
    busy(e.target, false);
  });

  $("signup-form").addEventListener("submit", async e => {
    e.preventDefault(); clearError();
    if ($("signup-password").value !== $("signup-confirm").value) return showError("Passwords do not match.");
    busy(e.target, true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, $("signup-email").value.trim(), $("signup-password").value);
      await updateProfile(cred.user, { displayName: $("signup-name").value.trim() });
      await cred.user.reload();
      onUser(auth.currentUser);
    } catch (err) { showError(err); }
    busy(e.target, false);
  });

  $("forgot-btn").addEventListener("click", async () => {
    clearError();
    const email = $("login-email").value.trim();
    if (!email) return showError("Enter your email above, then click 'Forgot password?'.");
    try {
      await sendPasswordResetEmail(auth, email);
      showError("Password reset email sent. Check your inbox.");
    } catch (err) { showError(err); }
  });

  $("google-btn").addEventListener("click", async () => {
    clearError();
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err) { showError(err); }
  });

  $("logout-btn").addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, user => onUser(user));
}
