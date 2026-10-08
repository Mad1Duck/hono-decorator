# Task 47 — `examples/` aplikasi real-world

## Masalah

Ekosistem muda — tidak ada contoh end-to-end; developer baru harus merangkai sendiri dari README.

## Solusi

`examples/todo-api/` — runnable via `bun examples/todo-api/index.ts`:

- `@Module` + `createApp` bootstrap (routes + `/health` + `/docs` + shutdown)
- `@Validate` untuk body/query/params — satu schema → validasi + spec
- DI (`@Injectable` tokens), `guardExecutor` Bearer-token demo, `@RateLimit`
- `@Sse` + `@ChannelRoute` feed live, di-bridge dari `@OnEvent` domain event (`channels.publish` di dalam listener)
- `@Interval` job via `startScheduler`, `startEventBus` teardown di `onShutdown`

`examples/README.md` — cara jalan + curl contoh. `examples/` di luar `include` tsconfig — tidak ikut build/publish.

## Catatan

- `examples/` dikecualikan dari tsc include — file dibundel-verified via `bun build`.
