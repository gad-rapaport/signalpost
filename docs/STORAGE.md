# Storage

Measured 2026-10-04.

| Item                     | Size                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `signalpost:local` image | 255 MB unpacked, 60 MB compressed (distroless base shared with Fieldline and Slotkeeper) |
| `signalpost_data` volume | 0.7 MB (demo data and one day of real checks)                                            |
| `./backups`              | about 110 KB per backup; not pruned automatically                                        |
| `node_modules/`          | 174 MB (development only, rebuildable)                                                   |

Removing everything: `docker compose down -v` (deletes the data volume), `docker image rm signalpost:local`,
and delete `./backups` if the backups are not needed. Rebuildable folders: `node_modules/`, `dist/`,
`public/fonts/`, `playwright-report/`, `test-results/`.
