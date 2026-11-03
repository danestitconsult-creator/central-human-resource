// Detects the iPhone / iPad situations that need special handling.
const ua = navigator.userAgent || "";

// iPhone, iPad, iPod. (Recent iPads report themselves as a Mac with a touch screen.)
export const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Opened from the Home Screen icon
export const isStandalone = navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);

// Inside another app's browser (Instagram, WhatsApp, Facebook, a PWABuilder wrapper...). Real Safari/Chrome include "Safari" in the UA.
export const isEmbeddedWebView = isIOS && !isStandalone && !/safari/i.test(ua);

// Google refuses to sign in from embedded web views, and its popup is unreliable in a Home Screen app.
export const googleSignInSupported = !(isIOS && (isStandalone || isEmbeddedWebView));
