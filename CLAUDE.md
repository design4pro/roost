# Working in this repo

Roost is a Chrome MV3 extension (WXT + React 19) and a Cloudflare Worker with
one SQLite Durable Object per user, in a single pnpm package. `docs/SPEC.md` is
the contract; `docs/ARCHITECTURE.md` is the map.

## Node

Node 24. `.nvmrc` pins it - `nvm use` before anything else, because the default
`node` on this machine is 18 and WXT will not start on it.

## Commands

|                                           |                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:worker`            | extension watch build / `wrangler dev` on 3011                    |
| `pnpm build` / `pnpm build:extension`     | Worker dry-run deploy / the extension bundle                      |
| `pnpm typecheck` `pnpm lint` `pnpm check` | tsc, eslint, prettier                                             |
| `pnpm test`                               | vitest, four projects: `shared`, `extension`, `worker`, `tooling` |
| `pnpm e2e`                                | Playwright with the built extension loaded                        |

Run `pnpm build:extension` before `pnpm e2e`: the suite loads `.output/chrome-mv3`
from disk and will happily test a stale build. `pnpm build` is deliberately the
Worker instead - Workers Builds fills its build command from that script, and
the one-click deploy fails for a stranger if it points at the extension.

`pnpm dev:worker` and `pnpm e2e` both need a `.dev.vars`; copy
`.dev.vars.example`, which carries the pairing key the e2e fixtures use.

## The shape of the code

Three layers on both ends, and the middle one is the point:

1. **Core** - pure functions, `(state, event, now) => { state, effects }`. No
   `Date.now()`, no `setTimeout`, no `Math.random()`, no `chrome.*`. This is
   where the reducers, the diffing, the plans and the selectors live, and it is
   where nearly all the tests are.
2. **Adapters** - talk to one API each, and take the narrowest `Deps` they can
   (`Clock`, `Uuid`, `Random`, `Store`), declared in
   `src/extension/background/deps.ts`.
3. **Wiring** - the entrypoints. The only place that constructs real clocks and
   subscribes to real events.

`src/shared` is imported by both ends and imports neither. ESLint enforces all
three directions; the messages point back at the architecture doc.

## Conventions

- Prettier: no semicolons, single quotes, trailing commas. Run `pnpm format`.
- Tests sit next to the code as `*.test.ts`. Table-driven over recorded payloads
  beats a mock of `chrome.tabs`.
- Conventional Commits, in English.
- Comments explain _why_, in prose, and are worth writing where a reader would
  otherwise assume the obvious thing. Don't narrate what the line does.
- Coverage runs on Istanbul, not V8 - the Workers pool runs inside workerd,
  which has no V8 coverage profiler.

## Things that bite

- **Chrome tab and window ids are per-session and get replaced.** Memory Saver
  swaps an id out from under you (`tabs.onReplaced`). Never delete on a missing
  id; remap. `background/ids/` owns this.
- **The service worker dies mid-burst.** Anything not written to
  `storage.session` / `storage.local` before an effect runs is gone. Persist
  first, act second.
- **Free-plan Durable Objects allow 100 000 written rows a day** and fail
  silently past it. Every write path is diffed and every op batch is counted.
- **The pairing key is the only thing guarding the hub.** It never goes in a
  URL - invocation logs record those - so REST carries it as a bearer token and
  the WebSocket upgrade as the second `Sec-WebSocket-Protocol` entry.
- **Chrome will not catch a missing subprotocol echo, but `ws` will.** A browser
  only refuses a subprotocol it did not offer. The e2e second device is the
  canary for that half of the handshake.
