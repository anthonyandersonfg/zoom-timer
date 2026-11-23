export const DEFAULT_MINUTES = 60;

export function paintLayout(badge, layout) {
  badge.dataset.size = layout?.size ?? "medium";
  badge.dataset.position = layout?.position ?? "top-center";
}

export function remainingMs(timer, now = Date.now()) {
  return timer.deadline === null ? timer.remaining : timer.deadline - now;
}

export function timerDisplay(timer, now = Date.now()) {
  const left = remainingMs(timer, now);
  const overtime = left < 0;
  const seconds = overtime ? Math.floor(-left / 1000) : Math.ceil(left / 1000);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return {
    text: `${overtime && seconds > 0 ? "+" : ""}${minutes}:${remainder}`,
    tone: left <= 0 ? "red" : seconds <= 300 ? "orange" : "green",
  };
}

export function paintTimer(element, timer, now) {
  const { text, tone } = timerDisplay(timer, now);
  if (element.textContent !== text) element.textContent = text;
  if (element.dataset.tone !== tone) element.dataset.tone = tone;
}

export function validTimer(timer) {
  return timer && Number.isSafeInteger(timer.remaining)
    && timer.remaining <= 180 * 60_000
    && (timer.deadline === null || Number.isSafeInteger(timer.deadline));
}

// Recalculate from the deadline on every wake-up, even after sleep or throttling.
export function followTimer(getTimer, paint) {
  let timeout;
  function tick() {
    clearTimeout(timeout);
    const timer = getTimer();
    const now = Date.now();
    paint(timer, now);
    const left = remainingMs(timer, now);
    if (timer.deadline !== null) {
      const untilChange = left > 0 ? (left % 1000 || 1000) : 1000 - (-left % 1000);
      timeout = setTimeout(tick, untilChange + 12);
    }
  }
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pageshow", tick);
  return tick;
}
