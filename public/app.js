import { DEFAULT_MINUTES, followTimer, paintTimer, remainingMs } from "./timer.js";
import { cameraLink, capabilities, configureZoom, runCamera } from "./zoom.js";

const element = (id) => document.getElementById(id);
const previewMode = new URLSearchParams(location.search).get("preview") === "1";
const previewMessage = "Browser preview. Open Host Timer inside Zoom to show it on your video.";

function runController() {
  element("controller").hidden = false;
  const start = element("start");
  const reset = element("reset");
  const minutes = element("minutes");
  const toggle = element("toggle-camera");
  const status = element("camera-status");
  const presets = [...document.querySelectorAll("[data-minutes]")];
  let timer = { remaining: DEFAULT_MINUTES * 60_000, deadline: null };
  let duration = DEFAULT_MINUTES;
  let phase = "ready";
  let overlay = "hidden";
  let busy = false;
  let link;
  let meetingEnded = false;

  function notice(text, error = false) {
    const message = element("notice");
    message.textContent = text;
    message.dataset.error = String(error);
  }

  function paintControls() {
    const finished = remainingMs(timer) === 0;
    const running = phase === "running" && !finished;
    const editable = phase === "ready" || finished;
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
    const label = finished ? "Restart" : running ? "Pause" : phase === "paused" ? "Resume" : "Start";
    if (start.textContent !== label) start.textContent = label;
    start.disabled = busy;
    reset.disabled = busy || phase === "ready";
    toggle.disabled = busy || !link || meetingEnded;
    minutes.disabled = busy || !editable;
    element("set-duration").disabled = minutes.disabled;
    const timerStatus = finished ? "Time’s up" : running ? "Running" : phase === "paused" ? "Paused" : "Ready";
    if (element("timer-status").textContent !== timerStatus) {
      element("timer-status").textContent = timerStatus;
    }

    for (const button of presets) {
      button.disabled = busy;
      button.setAttribute("aria-pressed", String(Number(button.dataset.minutes) === duration));
    }
  }

  const paint = followTimer(() => timer, (value, now) => {
    paintTimer(element("clock"), value, now);
    const badge = element("preview-badge");
    badge.hidden = overlay !== "visible";
    if (previewMode) paintTimer(badge, value, now);
    paintControls();
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

  async function updateTimer() {
    paint();
    if (overlay !== "visible" || previewMode) return;
    busy = true;
    paintControls();
    try {
      await link.sync();
    } catch (error) {
      console.warn(error);
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
    return true;
  }

  function resetTimer() {
    phase = "ready";
    timer = { remaining: duration * 60_000, deadline: null };
    void updateTimer();
  }

  element("duration").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!busy && !minutes.disabled && readDuration()) resetTimer();
  });
  for (const preset of presets) {
    preset.addEventListener("click", () => {
      duration = Number(preset.dataset.minutes);
      minutes.value = String(duration);
      resetTimer();
    });
  }
  reset.addEventListener("click", resetTimer);
  start.addEventListener("click", () => {
    const remaining = remainingMs(timer);
    if (phase === "running" && remaining > 0) {
      phase = "paused";
      timer = { remaining, deadline: null };
    } else {
      if ((phase === "ready" || remaining === 0) && !readDuration()) return;
      const length = phase === "paused" && remaining > 0 ? remaining : duration * 60_000;
      phase = "running";
      timer = { remaining: length, deadline: Date.now() + length };
    }
    void updateTimer();
  });

  toggle.addEventListener("click", async () => {
    if (busy || !link) return;
    busy = true;
    const showing = overlay === "hidden";
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
      link = cameraLink(sdk, () => timer, () => {
        meetingEnded = true;
        overlay = "hidden";
        phase = "ready";
        timer = { remaining: duration * 60_000, deadline: null };
        notice("Meeting ended. Open Host Timer in your next meeting to use the overlay.");
        paint();
      });
      notice("Turn on your Zoom video before showing the overlay.");
      paint();
    },
    preview() {
      element("preview").hidden = false;
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
