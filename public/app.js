import { DEFAULT_MINUTES, followTimer, paintLayout, paintTimer, remainingMs } from "./timer.js";
import { cameraLink, capabilities, configureZoom, runCamera } from "./zoom.js";

const element = (id) => document.getElementById(id);
const previewMode = new URLSearchParams(location.search).get("preview") === "1";
const previewMessage = "Browser preview. Open Host Timer inside Zoom to show it on your video.";
const preferencesKey = "host-timer:preferences";

function loadPreferences() {
  try {
    return JSON.parse(localStorage.getItem(preferencesKey)) ?? {};
  } catch {
    return {};
  }
}

function runController() {
  element("controller").hidden = false;
  const start = element("start");
  const reset = element("reset");
  const minutes = element("minutes");
  const toggle = element("toggle-camera");
  const status = element("camera-status");
  const size = element("overlay-size");
  const position = element("overlay-position");
  const sound = element("expiry-sound");
  const previewBadge = element("preview-badge");
  const presets = [...document.querySelectorAll("[data-minutes]")];
  const getLayout = () => ({ size: size.value, position: position.value });
  const preferences = loadPreferences();
  let duration = Number.isInteger(preferences.duration)
    && preferences.duration >= Number(minutes.min) && preferences.duration <= Number(minutes.max)
    ? preferences.duration : DEFAULT_MINUTES;
  minutes.value = String(duration);
  for (const control of [size, position]) {
    const value = preferences[control === size ? "size" : "position"];
    if ([...control.options].some((option) => option.value === value)) control.value = value;
  }
  sound.checked = preferences.sound !== false;
  let timer = { remaining: duration * 60_000, deadline: null };
  let phase = "ready";
  let overlay = "hidden";
  let busy = false;
  let link;
  let meetingEnded = false;
  let audio;
  let expiryHandled = false;

  function savePreferences() {
    try {
      localStorage.setItem(preferencesKey, JSON.stringify({
        duration,
        ...getLayout(),
        sound: sound.checked,
      }));
    } catch (error) {
      console.warn("Host Timer could not save preferences.", error);
    }
  }

  function prepareSound() {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!sound.checked || !AudioContext) return;
    try {
      audio ??= new AudioContext();
      if (audio.state !== "running") void audio.resume().catch(console.warn);
    } catch (error) {
      console.warn("Host Timer could not prepare the alert sound.", error);
    }
  }

  function playExpirySound() {
    if (!sound.checked || audio?.state !== "running") return;
    const startAt = audio.currentTime;
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.type = "sine";
    tone.frequency.value = 660;
    volume.gain.setValueAtTime(0, startAt);
    volume.gain.linearRampToValueAtTime(0.035, startAt + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.001, startAt + 0.25);
    tone.connect(volume).connect(audio.destination);
    tone.start(startAt);
    tone.stop(startAt + 0.26);
  }

  function alertAtExpiry(left) {
    if (phase !== "running" || left > 0 || expiryHandled) return;
    expiryHandled = true;
    try {
      playExpirySound();
    } catch (error) {
      console.warn("Host Timer could not play the alert sound.", error);
    }
  }

  function notice(text, error = false) {
    const message = element("notice");
    message.textContent = text;
    message.dataset.error = String(error);
  }

  function paintControls(now = Date.now()) {
    const overtime = remainingMs(timer, now) <= 0;
    const running = phase === "running";
    const labels = {
      hidden: ["Hidden", "Show on camera"],
      opening: ["Connecting…", "Showing…"],
      visible: ["Visible", "Hide from camera"],
      closing: ["Closing…", "Hiding…"],
      unknown: ["Check video", "Retry hiding"],
    };
    [status.textContent, toggle.textContent] = labels[overlay];
    status.dataset.state = busy && (overlay === "opening" || overlay === "closing")
      ? "pending" : overlay;
    const label = running ? "Pause" : phase === "paused" ? "Resume" : "Start";
    if (start.textContent !== label) start.textContent = label;
    start.disabled = busy;
    reset.disabled = busy || phase === "ready";
    toggle.disabled = busy || !link || meetingEnded;
    size.disabled = position.disabled = toggle.disabled || overlay === "unknown";
    minutes.disabled = busy || phase !== "ready";
    element("set-duration").disabled = minutes.disabled;
    const timerStatus = running ? (overtime ? "Overtime" : "Running") : phase === "paused" ? "Paused" : "Ready";
    if (element("timer-status").textContent !== timerStatus) {
      element("timer-status").textContent = timerStatus;
    }

    for (const button of presets) {
      button.disabled = busy;
      button.setAttribute("aria-pressed", String(Number(button.dataset.minutes) === duration));
    }
  }

  const paint = followTimer(() => timer, (value, now) => {
    const clock = element("clock");
    paintTimer(clock, value, now);
    const left = remainingMs(value, now);
    const label = left <= 0 ? "Time over" : "Time remaining";
    if (clock.getAttribute("aria-label") !== label) clock.setAttribute("aria-label", label);
    alertAtExpiry(left);
    previewBadge.hidden = overlay !== "visible";
    if (previewMode) paintTimer(previewBadge, value, now);
    paintControls(now);
  });

  async function hideOverlay() {
    try {
      await link.hide();
      overlay = "hidden";
      return true;
    } catch (error) {
      console.warn(error);
      overlay = "unknown";
      return false;
    }
  }

  async function updateTimer({ layoutOnly = false } = {}) {
    paint();
    if (overlay !== "visible" || previewMode) return;
    busy = true;
    paintControls();
    try {
      await link.sync();
      if (layoutOnly) notice("Attendees see the timer when your Zoom video is on.");
    } catch (error) {
      console.warn(error);
      if (layoutOnly) {
        notice("Zoom couldn’t confirm the new size or position. Change an option to try again.", true);
        return;
      }
      const hidden = await hideOverlay();
      notice(hidden
        ? "The camera stopped responding. The overlay was hidden. You can show it again."
        : "The camera stopped responding. Use Retry hiding or check your Zoom video.", true);
    } finally {
      busy = false;
      paint();
    }
  }

  function readDuration() {
    if (!minutes.reportValidity()) return false;
    duration = minutes.valueAsNumber;
    savePreferences();
    return true;
  }

  function readyTimer() {
    phase = "ready";
    expiryHandled = false;
    timer = { remaining: duration * 60_000, deadline: null };
  }

  function resetTimer() {
    readyTimer();
    void updateTimer();
  }

  function startTimer(remaining) {
    phase = "running";
    timer = { remaining, deadline: Date.now() + remaining };
  }

  element("duration").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!busy && !minutes.disabled && readDuration()) resetTimer();
  });
  for (const preset of presets) {
    preset.addEventListener("click", () => {
      duration = Number(preset.dataset.minutes);
      minutes.value = String(duration);
      savePreferences();
      resetTimer();
    });
  }
  reset.addEventListener("click", resetTimer);
  for (const control of [size, position]) {
    control.addEventListener("change", () => {
      savePreferences();
      if (previewMode) paintLayout(previewBadge, getLayout());
      void updateTimer({ layoutOnly: true });
    });
  }
  sound.addEventListener("change", () => {
    savePreferences();
    prepareSound();
  });
  start.addEventListener("click", () => {
    if (phase === "running") {
      const remaining = remainingMs(timer);
      alertAtExpiry(remaining);
      phase = "paused";
      timer = { remaining, deadline: null };
    } else {
      if (phase === "ready" && !readDuration()) return;
      prepareSound();
      startTimer(phase === "paused" ? timer.remaining : duration * 60_000);
    }
    void updateTimer();
  });

  toggle.addEventListener("click", async () => {
    if (busy || !link) return;
    const showing = overlay === "hidden";
    const startOnShow = showing && phase === "ready";
    if (startOnShow && !readDuration()) return;
    if (showing) prepareSound();
    if (startOnShow) startTimer(duration * 60_000);
    busy = true;
    overlay = showing ? "opening" : "closing";
    paint();
    if (showing) {
      notice(previewMode ? previewMessage : "Starting Zoom Camera Mode. First use can take a moment.");
      try {
        await link.show();
        if (!meetingEnded) {
          overlay = "visible";
          notice(previewMode ? previewMessage : "Attendees see the timer when your Zoom video is on.");
        }
      } catch (error) {
        console.warn(error);
        if (!meetingEnded) {
          if (startOnShow) readyTimer();
          const hidden = error.cameraWasRequested ? await hideOverlay() : true;
          if (hidden) overlay = "hidden";
          notice(hidden ? (error.message || "Zoom couldn’t show the timer.")
            : "Zoom couldn’t confirm the overlay state. Use Retry hiding or check your video.", true);
        }
      }
    } else {
      const hidden = await hideOverlay();
      notice(hidden ? (previewMode ? previewMessage : "Show the overlay whenever you need it.")
        : "Zoom couldn’t hide the overlay. Use Retry hiding or check your video.", !hidden);
    }
    busy = false;
    paint();
  });

  paint();
  return {
    connect(sdk, config) {
      if (config.runningContext !== "inMeeting" || (config.product && config.product !== "desktop")) {
        notice("Start or host a meeting in Zoom Workplace on your Mac, then open Host Timer from Apps.");
        return;
      }
      const missing = capabilities.filter((api) => config.unsupportedApis?.includes(api));
      if (missing.length) {
        notice("Camera Mode is unavailable. Check the Zoom client version and the app’s SDK capabilities.", true);
        return;
      }
      link = cameraLink(sdk, () => ({ timer, layout: getLayout() }), () => {
        meetingEnded = true;
        overlay = "hidden";
        readyTimer();
        notice("Meeting ended. Open Host Timer in your next meeting to use the overlay.");
        paint();
      });
      notice("Turn on your Zoom video before showing the overlay.");
      paint();
    },
    preview() {
      element("preview").hidden = false;
      paintLayout(previewBadge, getLayout());
      link = { show() {}, hide() {} };
      notice(previewMessage);
      paint();
    },
    notice,
  };
}

async function main() {
  if (previewMode) {
    runController().preview();
    return;
  }

  let connection;
  try {
    connection = await configureZoom();
  } catch (error) {
    console.warn(error);
    runController().notice("Open Host Timer from Apps in Zoom. For a browser preview, visit /?preview=1.");
    return;
  }

  const { sdk, config } = connection;
  if (config.runningContext === "inCamera") {
    await runCamera(sdk, config);
  } else {
    runController().connect(sdk, config);
  }
}

main().catch(console.error);
