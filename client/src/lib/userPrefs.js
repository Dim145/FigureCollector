// Lightweight persisted user preferences. Anything that should survive a
// reload but doesn't need to round-trip the server lives here.
//
// Keys:
//   fc_bgmodel  — background-removal model size: "small" | "medium" | "large"

const STORAGE_KEY = "fc_prefs";

const DEFAULTS = {
  bgModel: "medium",
};

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* quota or disabled — ignore */
  }
}

export function getPref(key) {
  return read()[key] ?? DEFAULTS[key];
}

export function setPref(key, value) {
  const all = read();
  all[key] = value;
  write(all);
}

export const BG_MODEL_SIZES = ["small", "medium", "large"];
