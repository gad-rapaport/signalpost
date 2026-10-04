# Animation brief

## Purpose and audience

A 21.5-second film for the portfolio page and README that shows what Signalpost watches, what it refuses to do
and how a failure plays out from detection to recovery. Audience: interviewers for DevOps, SRE and security
roles. It must work without sound.

## Core message

Every service is checked every 30 seconds through an outbound policy that a request to cloud metadata cannot
pass; two failures open an incident, two good checks close it, and customers see the same story.

## Reference and what was taken from it

The local reference video (an illustrated product film, stored rotated by 90 degrees and viewed in the correct
orientation frame by frame; not included here) moves from a person with a need to a screen, into an abstract
space where objects travel, and back to the person for the result. Adapted for Signalpost:

| Reference element                          | Here                                                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Person with a need in a simple environment | An on-call engineer at a desk at night, clock at 02:14                                                   |
| Push into the device                       | The desk monitor grows into the real monitor list, rows highlighted one by one                           |
| Abstract space where objects travel        | The list unfolds into a live system diagram; check pulses travel through the policy gate to the services |
| An object handled and set aside            | A request to 169.254.169.254 hits the gate and bounces back, labelled "refused"                          |
| Return to the person for the outcome       | The engineer leans back; the phone shows the real status page and the signed webhook                     |

Not taken: any character, brand, layout, colour or asset of the reference. The style here is an animated
system diagram on a control-room panel, unlike the other films in the portfolio.

## Duration and format

21.5 s, 1920x1080, 30 fps, H.264 (yuv420p, BT.709, faststart), no audio.

## Palette and typography

Signalpost tokens: panel `#0f2a3d`, night `#0b1b27`, signal green `#5fd0a5`, amber `#f2b04c`, alert red
`#ff8a80`, text `#e8f1f6`/`#a9bac6`. Barlow, Barlow Semi Condensed and Red Hat Mono from the app's font
packages.

## Motion language

Diagram motion: pulses travel along the links at a steady rhythm (one per service every 0.9 s, eased), each
arrival flashes a ring on the node; the gate flashes red once when it stops the metadata request; a failing
node shakes slightly and turns red; cards and badges pop with a small overshoot. No flashes faster than
3 per second.

## Scenes

| #   | Time      | Content                                                                                                                                                                                      | Capability            |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | 0-4.1     | Engineer at a desk at night, window, clock 02:14, small status board on the screen                                                                                                           | The need              |
| 2   | 3.9-8.1   | The real monitor list (admin screenshot), rows highlighted in turn                                                                                                                           | Regular checks        |
| 3   | 7.8-12.4  | Diagram: Signalpost, outbound policy gate, three services in an internal network; pulses flow; a request to 169.254.169.254 is refused                                                       | Outbound policy       |
| 4   | 12.6-17.0 | Orders API fails twice ("1 failed", "2 failed"), incident "Orders API is not responding" opens, overall "Partial outage"; two good checks resolve it ("Resolved", "All systems operational") | Thresholds, incidents |
| 5   | 16.9-19.7 | Engineer leans back; phone with the real mobile status page; "incident.resolved, signed webhook"                                                                                             | Status page, webhook  |
| 6   | 19.5-21.5 | Mark, name, tagline, repository                                                                                                                                                              | Brand                 |

Timing per element: [ANIMATION-STORYBOARD.md](ANIMATION-STORYBOARD.md).

## On-screen text

"Is everything up? Know before your customers do." / "Signalpost checks every service, every 30 seconds." /
"Each check passes the outbound policy first." / "A request to cloud metadata never leaves." / "Two failures in a
row open an incident." / "Two good checks close it." / "Customers see the same story on the status page." /
"Signalpost" / "Uptime monitoring with a locked-down outbound policy" / repository.

## Assets and sources

| Asset                                | Source                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Monitor list                         | `docs/screenshots/admin-monitors.png`, captured from the running stack                                                        |
| Phone screen                         | `docs/screenshots/mobile.png`, the real status page on a phone                                                                |
| Incident and status texts            | Exactly as the app writes them (`incidents.ts`, `scheduler.ts`, `statusPage.ts`) for an HTTP 503 failure, as in `drill error` |
| Thresholds, interval, policy wording | The demo configuration: 30 s interval, 2 failures, 2 recoveries; refusal reason for a link-local address                      |
| Everything else                      | Original SVG in [animation/scene.js](../animation/scene.js)                                                                   |
| Fonts                                | Barlow, Barlow Semi Condensed, Red Hat Mono (SIL OFL)                                                                         |
| Music                                | None                                                                                                                          |

The engineer is an invented illustration. In the app, the metadata URL is refused when the monitor is saved
(it is not on the allowlist) and, for an allowlisted name that resolves there, at check time; the film shows
the second case as a single request stopped at the gate.

## Production

Same pipeline as the other portfolio films: SVG scene, deterministic `seek(t)`, Playwright frame capture,
ffmpeg encode; nothing in the app image. See [ANIMATION-RENDERING.md](ANIMATION-RENDERING.md).

## Acceptance checks

Reviewed on contact sheets and per-transition frames. Fixed before the final render: incident card and status
chip covering the gate labels, the webhook notice running off the right edge, and the refusal label covering
the network label. Every capability shown is implemented and covered by tests and the drills in
OPERATIONS.md. No personal data.
