// Applies a validated Signal Mode before hydration so the first desktop paint is correct.
(() => {
  const key = "frameshift:signal-mode:v1";
  const modes = new Set([
    "neon-grid",
    "aurora-drift",
    "terminal-rain",
    "redshift",
  ]);
  let mode = "neon-grid";

  try {
    const stored = window.localStorage.getItem(key);
    if (modes.has(stored)) {
      mode = stored;
    } else if (stored !== null) {
      window.localStorage.setItem(key, mode);
    }
  } catch {
    mode = "neon-grid";
  }

  document.documentElement.dataset.signalMode = mode;
})();
