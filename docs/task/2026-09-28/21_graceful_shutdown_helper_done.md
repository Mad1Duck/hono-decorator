# graceful shutdown helper

**File:** see summary

gracefulShutdown() (src/utils/shutdown.ts) wires SIGINT/SIGTERM → onShutdown → container.shutdown → exit(0), with timeout hard-exit and a detach function.

## Checklist

- [x] Implemented
- [x] Tested
- [x] README updated

## Status

Done — 288 tests passing, type-check and build green.
