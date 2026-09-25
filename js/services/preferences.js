const KEY = "vinht-ui-preferences-v1";
const DEFAULTS = {
  compactGrid: false,
  reduceMotion: false,
  recentTracking: true,
  browserNotifications: false,
};

export function getUiPreferences() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}") || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setUiPreferences(patch = {}) {
  const next = { ...getUiPreferences(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  applyUiPreferences(next);
  window.dispatchEvent(new CustomEvent("vinht:preferences", { detail: next }));
  return next;
}

export function applyUiPreferences(prefs = getUiPreferences()) {
  document.body.classList.toggle("pref-compact", !!prefs.compactGrid);
  document.body.classList.toggle("pref-reduce-motion", !!prefs.reduceMotion);
}

export async function setBrowserNotificationsEnabled(enabled) {
  if (!enabled) return setUiPreferences({ browserNotifications: false });
  if (!("Notification" in window)) throw new Error("unsupported-browser-notifications");
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("notification-permission-denied");
  return setUiPreferences({ browserNotifications: true });
}

export function maybeShowBrowserNotification(title, options = {}) {
  const prefs = getUiPreferences();
  if (!prefs.browserNotifications || !("Notification" in window) || Notification.permission !== "granted") return false;
  try {
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
