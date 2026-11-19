export const DEFAULT_MINUTES = 15;

export function remainingMs(timer, now = Date.now()) {
  return timer.deadline === null ? timer.remaining : Math.max(0, timer.deadline - now);
}

export function timerDisplay(timer, now = Date.now()) {
  const seconds = Math.ceil(remainingMs(timer, now) / 1000);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return {
    text: `${minutes}:${remainder}`,
    tone: seconds === 0 ? "red" : seconds <= 300 ? "orange" : "green",
  };
}

export function paintTimer(element, timer, now) {
  const { text, tone } = timerDisplay(timer, now);
  if (element.textContent !== text) element.textContent = text;
  if (element.dataset.tone !== tone) element.dataset.tone = tone;
}

export function validTimer(timer) {
  return timer && Number.isFinite(timer.remaining) && timer.remaining >= 0
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
    if (timer.deadline !== null && left > 0) {
      timeout = setTimeout(tick, (left % 1000 || 1000) + 12);
    }
  }
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pageshow", tick);
  return tick;
}
