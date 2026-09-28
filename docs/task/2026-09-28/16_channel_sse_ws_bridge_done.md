# Task 16: Channel → SSE/WS bridge (`@ChannelRoute`)

- File: `src/decorators/sse.ts` / `websocket.ts` (decorator baru), `src/core/route-builder.ts`, `src/channels/`
- Masalah: channels (pub/sub) dan SSE/WS endpoint sudah ada tapi tidak terhubung — consumer harus manual subscribe→stream→unsubscribe di tiap handler (boilerplate berulang).

## Deskripsi fitur

```ts
@Get('/events')
@Sse()
@ChannelRoute((c) => `user:${User(c)?.id}`)   // pattern channel per-request
notifications(c: Context) { /* stream dikelola otomatis */ }
```

Route-builder: saat `@Sse`/`@WebSocket` + `@ChannelRoute`, otomatis `channels.subscribe(pattern, client)` saat connect dan `unsubscribe` saat abort/close. Pertimbangan: pattern dinamis (fungsi dari `c`), auth (subscribe setelah guard), format event SSE (`event:` + `data:`).

## Checklist

- [x] `@ChannelRoute(pattern | (c) => pattern)` decorator (`src/decorators/channel-route.ts`, key `CHANNEL_ROUTE`)
- [x] SSE: subscribe `SseChannelClient`, stream ditahan via `stream.onAbort` → unsubscribe; WS: wrap `onOpen`/`onClose` pada events object (user callbacks tetap jalan)
- [x] `SseChannelClient.isAlive` kini juga cek `stream.aborted` (disconnect = abort)
- [x] `describe()` expose `channelRoute`
- [x] Unit test: publish sampai ke SSE stream + unsubscribe on abort; WS subscribe/unsubscribe via fake upgrader — 2 test baru
- [x] README section `@ChannelRoute`
- [x] Verifikasi `bun run type-check` / `bun test` / `bun run build` — 260 tests hijau

- Referensi: fitur proposal session 2026-09-28

## Status

- [x] Completed
