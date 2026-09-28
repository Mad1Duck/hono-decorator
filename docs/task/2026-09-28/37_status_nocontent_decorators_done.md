# @Status / @NoContent — response status sugar

**File:** `src/decorators/interceptor.ts`, `src/core/route-builder.ts`, metadata key RESPONSE_STATUS

## Masalah

Handler non-200 butuh `return c.json(result, 201)` manual — decorator sugar
untuk POST→201, DELETE→204 hilang dari toolbox.

## Checklist

- [x] `@Status(code)` method decorator → metadata; result non-Response
      dipanggil `c.json(result, code)` / `c.body(null, code)` — Response
      passthrough tetap menang (Response yang di-return handler override)
- [x] `@NoContent()` = `@Status(204)` + body selalu null
- [x] OpenAPI: kalau ada `@Status(201)`, response default spec pakai 201 —
      opsional, minimal tidak konflik dengan @ApiResponse
- [x] Test: @Status(201) → status benar body utuh; @NoContent → 204 body kosong;
      handler return Response → Response menang
- [x] README: subsection di HTTP method decorators

## Status

Done — 298 tests passing, type-check and build green.
