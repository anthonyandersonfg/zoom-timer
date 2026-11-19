# Host Timer for Zoom Workplace on macOS

Host Timer adds a countdown at the top center of the host’s outgoing video through Zoom Apps Camera Mode. Everyone who can see the host’s video can see the timer using their normal Zoom client.

## Controls

- Set a duration from 1 to 180 minutes, or use a 5, 10, 15, or 30 minute preset. The default is 15 minutes.
- Use **Start**, **Pause**, **Resume**, and **Reset** in the Apps sidebar.
- Use **Show on camera** and **Hide from camera** to control visibility independently of the countdown. The overlay starts hidden. A running timer keeps counting when hidden.
- The timer is green above 5:00, orange from 5:00 through 0:01, and red at 0:00. It stays red until reset, restarted, or hidden.

## Browser preview

With Node.js 22 or later, run `npm start` in this folder. Open [the local preview](http://127.0.0.1:8765/?preview=1). The preview uses a simulated video tile. No npm dependencies are required.

## Install for private Zoom testing

1. Run `npm start` and put the service behind a trusted HTTPS endpoint. For a short-lived development test, forward local port `8765` through an approved HTTPS tunnel. If deploying to a managed Node host, use its assigned `PORT` and set `BIND_HOST=0.0.0.0` when the hosting platform requires it.
2. In the [Zoom App Marketplace](https://marketplace.zoom.us/), use an account with Zoom developer permissions to create a **General App** named **Host Timer**. Select **User-managed**. Use the **Development** configuration.
3. Enable the **Zoom Apps SDK** surface. Set **Home URL** to the base HTTPS URL with a trailing slash. Set **OAuth Redirect URL** to the same origin followed by `/installed.html`, and include that redirect URL in the OAuth allow list. Add the hosting domain and `appssdk.zoom.us` to the app domain allow list.
4. Add the `zoomapp:inmeeting` scope and enable the following SDK APIs and events where listed.

   | Purpose | APIs and events |
   | --- | --- |
   | Identify the meeting host and their camera | `getUserContext` |
   | Enter and leave Camera Mode | `runRenderingContext`, `closeRenderingContext` |
   | Compose video and overlay | `drawParticipant`, `drawWebView` |
   | Sync sidebar and camera | `postMessage`, `onMessage` |
   | Clear the meeting’s timer state | `onMeeting` |

5. In the Marketplace **Local Test** page, select **Add App Now** and complete Zoom’s authorization. After redirect, open Zoom Workplace, start a meeting as host, turn on your camera, and select **Apps → Host Timer**. First use of Camera Mode may take longer while Zoom starts its renderer.

The service serves the app and a static installation landing page. The timer uses Zoom Apps SDK for its in-client functionality and has no Zoom REST API calls, OAuth token storage, meeting data storage, or backend timekeeping.

[Create a Zoom App](https://developers.zoom.us/docs/zoom-apps/create/) · [Zoom Local Test](https://developers.zoom.us/docs/build-flow/local-test/) · [Zoom Camera Mode](https://developers.zoom.us/docs/zoom-apps/guides/camera-mode/)

## Verify in a meeting

Have a second device join as an attendee with its camera off. Check the host’s tile from that device.

1. Confirm the host’s video starts without an overlay. Set 6 minutes, select **Show on camera**, then **Start**. Check the green timer and its transition to orange at 5:00.
2. Hide it during the countdown, wait a few seconds, then show it again. The attendee should see the current time. Check pause, resume, and reset.
3. Set 1 minute and let it finish. Confirm the attendee sees red 0:00, then hide it.
4. Open a separate window for a few seconds during a run and return. Confirm the timer has caught up, and verify that ending the meeting removes the overlay.

The sidebar and camera use the same absolute deadline. The camera calculates its own display locally and receives updates when the host changes the timer. This keeps delayed callbacks from accumulating drift and lets the countdown catch up when the renderer resumes. Attendee-side video delay still depends on Zoom and the connection.

## Deploy to Cloudflare Workers

Connect the GitHub repository under **Workers & Pages → Create application → Import a repository**. Use **zoom-host-timer** as the Worker name so it matches `wrangler.toml`. Select `main` as the production branch, use the repository root, leave the build command blank, and use `npx wrangler deploy` as the deploy command. Cloudflare serves the files from `public/` and applies the Zoom security headers in `public/_headers`. The Worker serves static assets and does not need an origin server or secrets.

Once Cloudflare assigns the Worker an HTTPS URL, verify that `/` and `/installed` return HTTP 200 and the security headers. In Zoom Marketplace’s **Development** configuration, update the **Home URL** to the new origin with a trailing slash, replace the old tunnel hostname in the **Domain allow list**, and keep `appssdk.zoom.us` in that list. Set the **OAuth redirect URL** to the new origin followed by `/installed`. The Cloudflare deployment serves this callback at the extensionless route. Reopen Host Timer in a Zoom meeting and confirm that an attendee sees the timer on the host’s video.

[Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) · [Cloudflare static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)
