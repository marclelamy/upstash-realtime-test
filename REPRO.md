# Upstash Realtime — Out-of-Order & Dropped Event Reproduction

## Purpose

This project is a minimal reproduction of a bug in `@upstash/realtime` where events emitted sequentially on the server arrive **out of order** and are **silently dropped** on the client side.

## The Bug

When emitting many events in quick succession through `@upstash/realtime`, the client receives them out of order and occasionally drops events entirely. This happens even with small payloads (< 5KB) and short delays (5ms) between emits. The server emits are sequential and awaited — there is no concurrency on the send side. The issue is in Upstash's delivery/subscription layer, not storage.

## Environment

| Dependency | Version |
|---|---|
| `@upstash/realtime` | ^1.0.2 |
| `@upstash/redis` | ^1.36.2 |
| `next` | 16.1.6 |
| `react` | 19.2.3 |
| `zod` | ^4.3.6 |
| `uuid` | ^13.0.0 |
| Node.js runtime | API route |

## Project Structure

```
├── .env.local                          # Upstash Redis credentials (fill in)
├── lib/redis/
│   ├── realtime.ts                     # Server-side Realtime instance + schema
│   └── realtime-client.ts              # Client-side useRealtime hook via createRealtime()
├── components/
│   ├── providers.tsx                   # RealtimeProvider wrapper (required by useRealtime)
│   └── realtime-test.tsx               # Test UI — subscribes, displays results
├── app/
│   ├── layout.tsx                      # Root layout, wraps children in <Providers>
│   ├── page.tsx                        # Renders <RealtimeTest />
│   └── api/
│       ├── realtime/route.ts           # SSE handler for @upstash/realtime (GET)
│       └── test-realtime/route.ts      # Emit test events (POST)
```

## How It Works

### Server Side

**`lib/redis/realtime.ts`** — Creates a `Realtime` instance with a Zod schema defining a `generate.event` that has a `type` (`content` | `complete`) and a `data` object with `messageId`, `sequenceId`, and optional `content`.

**`app/api/realtime/route.ts`** — The SSE endpoint. Uses `handle()` from `@upstash/realtime` to serve the streaming connection that the client `RealtimeProvider` connects to. The client hits `GET /api/realtime?channel=...` to subscribe.

**`app/api/test-realtime/route.ts`** — POST endpoint that:
1. Receives `{ channelId, count, minSize, maxSize, delayMs }`
2. Generates `count` random payload sizes between `minSize` and `maxSize`
3. Emits each event **sequentially** with `await channel.emit(...)` in a for-loop
4. Waits `delayMs` between each emit
5. Sends a final `complete` event
6. Returns the sizes array so the client can verify payload integrity

### Client Side

**`components/providers.tsx`** — Wraps the app in `<RealtimeProvider>` from `@upstash/realtime/client`. This is required for `useRealtime` to function — it manages the SSE connection.

**`lib/redis/realtime-client.ts`** — Calls `createRealtime()` to get a typed `useRealtime` hook.

**`components/realtime-test.tsx`** — The test UI:
1. On "Run Test", generates a unique `channelId` (UUID)
2. Subscribes to `generate:{channelId}` via `useRealtime`
3. Waits 500ms for subscription to establish
4. POSTs to `/api/test-realtime` to trigger 100 sequential server emits
5. Tracks every received event with an `arrivalIndex` (order received) and `sequenceId` (order sent)
6. Displays:
   - Expected vs received vs missing event counts
   - Whether events arrived in order
   - Missing sequence IDs
   - Full arrival order sequence
   - Per-event table showing arrival #, seq ID, type, sent size, received size, and whether payload matched

## Setup

1. Fill in `.env.local` with your Upstash Redis credentials:
   ```
   UPSTASH_REDIS_REST_URL=https://your-url.upstash.io
   UPSTASH_REDIS_REST_TOKEN=your-token
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Run the dev server:
   ```bash
   pnpm run dev
   ```

4. Open `http://localhost:3000` and click **"Run Test"**

## Test Parameters

The default test sends:
- **100 events** sequentially
- **1–5000 character** random payloads per event
- **5ms delay** between each emit
- Events are numbered with `sequenceId` 1–100, plus a final `complete` event (#101)

## Observed Behavior

- **Out of order**: Events arrive in wrong sequence (e.g. `1 → 3 → 2 → 5 → 4 → 6 → ...`)
- **Dropped events**: Some sequence IDs never arrive at the client
- All events are stored in Redis — the issue is delivery, not storage
- Content integrity is fine for events that *do* arrive — payloads match
- Problem worsens with more events, less delay, and larger payloads
- With `delayMs: 0` the problem is most severe

## Expected Behavior

- All emitted events should be delivered to the client
- Events should arrive in the same order they were emitted (FIFO)
- No events should be silently dropped

## Current Issue

The `/api/realtime` SSE route is currently returning **404** responses. The `handle()` function from `@upstash/realtime` is set up at `app/api/realtime/route.ts` but may need adjustments to the route handler signature or the `RealtimeProvider` may need an explicit `api.url` config. This needs to be debugged.
