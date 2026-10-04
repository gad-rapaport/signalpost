# Slim configuration

The default stack is Slim.

| Setting         | Value                                                          | Measured 2026-10-04                   |
| --------------- | -------------------------------------------------------------- | ------------------------------------- |
| Image           | distroless Node 24, production dependencies, one SQLite binary | 255 MB unpacked, 60 MB compressed     |
| App             | 160 MB limit, heap 96 MB, 4 concurrent checks, libuv pool 4    | 40-56 MiB, 11 pids, under 1% CPU idle |
| Demo target     | Same image, 64 MB limit, internal network only                 | 29 MiB                                |
| Database        | SQLite WAL, retention 30 days raw, 400 days daily              | 0.7 MB volume with the demo           |
| Background work | Scheduler tick every second, retention every 6 hours           |                                       |
| Browser         | Server-rendered HTML, one stylesheet, no scripts               |                                       |

Growth estimate: one monitor every 30 s stores 2,880 checks a day, roughly 0.3 MB a day with indexes (an estimate, not
measured at scale); 30 days of raw data for 10 monitors is then about 100 MB, which retention keeps steady. The status page reads daily rollups, so page cost
does not grow with check frequency.

No optional services. The seed and restore run only on demand through the `tools` profile.
