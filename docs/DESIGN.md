# Design

## Identity: the signal box

A status page is read when something is wrong, often on a phone. The look borrows from railway signal boxes
and control-room panels: a deep navy masthead with a green signal line, plain white panels, and state colours
that mean one thing each. Every state is an icon plus a word; colour never carries meaning alone.

| Token        | Light     | Dark      | Meaning                   |
| ------------ | --------- | --------- | ------------------------- |
| `--panel`    | `#0f2a3d` | `#081520` | Masthead, primary buttons |
| `--signal`   | `#5fd0a5` | same      | Brand line, focus accents |
| `--up`       | `#1e7a4f` | `#5fd0a5` | Operational (check icon)  |
| `--degraded` | `#985700` | `#f2b04c` | Degraded (exclamation)    |
| `--down`     | `#b42318` | `#ff8a80` | Outage (cross)            |
| `--maint`    | `#2557a7` | `#9cbcff` | Maintenance (dash)        |
| `--none`     | `#c4ccd2` | `#3b4b57` | No data                   |

All text colours meet WCAG AA against their backgrounds; state text is at least 4.5:1 in both themes.

## Typography

- **Barlow** (400/500/600): a grotesque modelled on road signage, readable at small sizes and in a hurry.
- **Barlow Semi Condensed 600** for headings: fits long service names on one line.
- **Red Hat Mono** for URLs, latencies and identifiers, so technical values stand apart from prose.

Fonts are copied from npm packages into the image at build time and served from `/assets/fonts`; nothing is
loaded from another origin.

## Pages

- **Status page:** the overall state is the first thing on the page, large, with the time it was rendered.
  Then active incidents (with their timeline), services with 30 daily bars (each bar has a text alternative),
  and the last 14 days of incidents.
- **Admin:** a table of monitors with state, latency, 24-hour uptime and last error; buttons for the common
  actions; forms with an error summary that links to each field; a confirmation page instead of a script
  dialog for deleting.

## Accessibility

Skip link, landmarks, one `h1` per page, labels for every field, error summary with links, `aria-invalid` and
`aria-describedby` on fields with errors, `aria-current` in the admin navigation, scrollable tables are
focusable regions with names, no horizontal page scroll at 390 px. Checked with axe-core (WCAG 2.2 AA rules)
on every page in E2E, desktop and phone.

## Assets and licences

| Asset                         | Source                                                                    | Licence     |
| ----------------------------- | ------------------------------------------------------------------------- | ----------- |
| Barlow, Barlow Semi Condensed | `@fontsource/barlow`, `@fontsource/barlow-semi-condensed` (Jeremy Tribby) | SIL OFL 1.1 |
| Red Hat Mono                  | `@fontsource/red-hat-mono` (Red Hat)                                      | SIL OFL 1.1 |
| Icons, logo                   | Drawn in SVG for this project                                             | n/a         |
| Demo data                     | Invented                                                                  | n/a         |
