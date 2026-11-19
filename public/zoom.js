import { DEFAULT_MINUTES, followTimer, paintLayout, paintTimer, validTimer } from "./timer.js";

export const capabilities = [
  "getUserContext", "runRenderingContext", "closeRenderingContext",
  "drawParticipant", "drawWebView", "postMessage", "onMessage", "onMeeting",
];

const channel = "host-timer:v1";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function messageFrom(event) {
  let message = event.payload ?? event;
  if (typeof message === "string") {
    try {
      message = JSON.parse(message);
    } catch {
      return null;
    }
  }
  return message?.channel === channel ? message : null;
}

function post(sdk, message) {
  return sdk.postMessage({ channel, ...message });
}

async function drawWithRetry(draw) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await draw();
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await delay(200 * 2 ** attempt);
    }
  }
}

export async function configureZoom() {
  if (!window.zoomSdk) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://appssdk.zoom.us/sdk.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the Zoom Apps SDK."));
      document.head.append(script);
    });
  }
  const sdk = window.zoomSdk;
  const config = await sdk.config({ version: "0.16", capabilities, timeout: 8000 });
  return { sdk, config };
}

export async function runCamera(sdk, config) {
  const badge = document.getElementById("camera-badge");
  const camera = document.getElementById("camera");
  const cameraId = crypto.randomUUID();
  let timer = { remaining: DEFAULT_MINUTES * 60_000, deadline: null };
  let revision = -1;
  const paint = followTimer(() => timer, (value, now) => paintTimer(badge, value, now));

  const { participantUUID } = await sdk.getUserContext();
  if (!participantUUID) throw new Error("Zoom could not identify your meeting video.");
  const target = config.media?.renderTarget ?? { width: 1280, height: 720 };
  const frame = { x: 0, y: 0, width: target.width, height: target.height };

  // The off-screen renderer can report inCamera just before it accepts draw calls.
  await drawWithRetry(() => sdk.drawParticipant({
    ...frame, participantUUID, cutout: "standard", zIndex: 1,
  }));
  await drawWithRetry(() => sdk.drawWebView({ ...frame, zIndex: 2 }));

  sdk.addEventListener("onMessage", (event) => {
    const message = messageFrom(event);
    if (message?.kind !== "timer" || message.cameraId !== cameraId
        || !Number.isSafeInteger(message.revision) || message.revision < revision
        || !validTimer(message.timer)) return;

    revision = message.revision;
    timer = message.timer;
    paintLayout(badge, message.layout);
    paint();
    camera.hidden = false;
    post(sdk, { kind: "applied", cameraId, revision }).catch(console.warn);
  });

  // Ask again if the controller was still waiting for Camera Mode to start.
  const until = Date.now() + 45_000;
  while (revision < 0 && Date.now() < until) {
    await post(sdk, { kind: "ready", cameraId }).catch(console.warn);
    if (revision < 0) await delay(400);
  }
}

export function cameraLink(sdk, getState, onMeetingEnd) {
  let cameraId;
  let lastApplied = -1;
  let revision = 0;
  let active = false;

  function send() {
    return post(sdk, { kind: "timer", cameraId, revision, ...getState() });
  }

  sdk.addEventListener("onMessage", (event) => {
    const message = messageFrom(event);
    if (!active || !message || typeof message.cameraId !== "string") return;
    if (message.kind === "ready") {
      if (cameraId !== message.cameraId) {
        cameraId = message.cameraId;
        lastApplied = -1;
      }
      send().catch(console.warn);
    } else if (message.kind === "applied" && message.cameraId === cameraId
               && message.revision === revision) {
      lastApplied = revision;
    }
  });

  function disconnect() {
    active = false;
    cameraId = undefined;
    lastApplied = -1;
  }

  sdk.addEventListener("onMeeting", ({ action }) => {
    if (action !== "ended") return;
    disconnect();
    onMeetingEnd();
  });

  async function sync(timeout = 5000) {
    const requested = ++revision;
    const until = Date.now() + timeout;
    while (active && revision === requested && Date.now() < until) {
      if (lastApplied === requested) return;
      if (cameraId) await send().catch(console.warn);
      if (lastApplied !== requested) await delay(250);
    }
    if (!active || revision !== requested) return;
    throw new Error("Zoom’s camera overlay did not respond.");
  }

  return {
    async show() {
      const { role } = await sdk.getUserContext();
      if (role !== "host") throw new Error("Open Host Timer as the meeting host.");
      active = true;
      try {
        await sdk.runRenderingContext({ view: "camera", defaultCutout: "standard" });
        await sync(30_000);
        if (!active) throw new Error("The meeting ended.");
      } catch (error) {
        disconnect();
        throw Object.assign(new Error(error?.message || "Zoom couldn’t start Camera Mode."), {
          cameraWasRequested: true,
          cause: error,
        });
      }
    },
    async hide() {
      disconnect();
      await sdk.closeRenderingContext();
    },
    sync,
  };
}
