# Architecture

## The pieces

|                                       |                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extension** (`src/extension`)       | MV3 service worker: capture, coalescing, id mapping, an outbound queue, one WebSocket, a command router and the window restorer. `dashboard.html` is a full page; it talks to the worker over one `runtime.connect` port. `lazy.html` stands in for a tab that has not been loaded yet. |
| **Worker** (`src/worker`)             | On the user's own `workers.dev` address. Checks the pairing key on every route - the WebSocket upgrade included - before anything reaches the Durable Object, then hands the request to the one hub this deployment has.                                                                |
| **`UserHub`** (`src/worker/user-hub`) | One SQLite Durable Object, one per deployment. The authoritative op log, the sockets (tagged by device id), and a daily prune alarm.                                                                                                                                                    |
| **`src/shared`**                      | The protocol and the mirror-apply function, imported by both ends and importing neither.                                                                                                                                                                                                |

## Why a Durable Object and not a database

Everything one user owns is small, changes constantly, and is read by two or
three sockets that all want the same delta. That is a single-writer problem, and
a Durable Object is a single writer with a SQLite file and a socket list
attached. Ordering falls out of the object's own serialization instead of being
reconstructed from timestamps, which is what makes the op log's `seq` mean
something.

## Data flow

```
chrome.* event
  -> capture/dirty.ts      one event becomes zero or more dirty keys
  -> coalescer.ts          300ms per key, flushed at 500ms or 100 keys
  -> capture/flush.ts      reads the CURRENT state of Chrome, builds ops
  -> ws/queue.ts           stamps clientSeq, persists the batch
  -> mirror/store.ts       applies our own ops optimistically
  -> UserHub.applyOps      one synchronous block; ack to us, changes to the rest
```

The flush deliberately reads live state rather than trusting the event payload.
Five `onUpdated` events for one tab collapse into one read and one op, and an
event that arrived just before the tab closed reads as "gone" instead of writing
a row about a tab that no longer exists.

## Ownership

Every window, tab and tab group belongs to exactly one device, and only that
device writes it. That makes the sync single-writer per row and removes the
whole class of merge conflicts. What crosses devices is a **command**: "close
this tab", "copy this folder", executed by the owner through the real `chrome.*`
API, whose resulting event is the only path back into the mirror.

Bookmarks are mirrored per browser for the same reason - and because merging two
bookmark trees that Google Sync is also editing has no correct answer.

Restoring a window is a one-time copy: the new window belongs to the browser
that made it and lives its own life from then on.

## Layering

```
src/shared/**            imports neither end
src/extension/dashboard  imports #/extension/port/protocol and #/shared only
src/worker/**            imports #/shared only
```

Enforced by `no-restricted-imports` in `eslint.config.js`. The dashboard rule is
the load-bearing one: it is what keeps the UI a function of one typed message
stream instead of a second consumer of `chrome.*`.

## Three layers inside each end

Core is pure - `(state, event, now) => { state, effects }` - and is where the
tests are. Adapters take the narrowest `Deps` they can. Wiring is the
entrypoints, and is the only place that reads a real clock.
