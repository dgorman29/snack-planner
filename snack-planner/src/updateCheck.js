/* Picks up new deploys in an app that's never reloaded. An app added to the
   Home Screen (iPad/iPhone especially) stays in memory and resumes where it left
   off, so it would keep running an old build. Whenever the app comes back to the
   front, compare the deployed version.json with the build we're running and
   reload if it's changed. A cooking session survives because it's saved in
   localStorage; shared data is saved as soon as it changes. */

const MIN_GAP_MS = 60 * 1000; // don't re-check on every quick app switch

let lastCheck = 0;

// A form open in a dialog (adding or editing a recipe) may hold unsaved typing,
// so leave the reload for the next time the app comes to the front.
function midEdit() {
  return !!document.querySelector('[role="dialog"] input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), [role="dialog"] textarea');
}

async function check() {
  if (document.visibilityState !== "visible" || Date.now() - lastCheck < MIN_GAP_MS) return;
  lastCheck = Date.now();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: "no-store" });
    if (!res.ok) return;
    const { id } = await res.json();
    if (!id || id === __BUILD_ID__ || midEdit()) return;
    // GitHub Pages lets the browser keep index.html for 10 minutes; refresh that
    // cached copy first so the reload actually loads the new build.
    await fetch(window.location.href, { cache: "reload" });
    window.location.reload();
  } catch {
    // Offline or a hiccup: try again next time.
  }
}

export function startUpdateCheck() {
  if (!import.meta.env.PROD) return;
  lastCheck = Date.now(); // we just loaded, so we're current
  document.addEventListener("visibilitychange", check);
  window.addEventListener("pageshow", (e) => { if (e.persisted) check(); });
}
