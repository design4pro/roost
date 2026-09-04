# Spec

## What it does

One dashboard page shows every device the user has signed in from, and for each:
its windows (with tab groups and tabs) and its bookmark tree. From there the user
can close a tab, focus a tab in its own browser, close a window, restore another
device's window into this browser, and create, move, delete or copy bookmarks -
including copying a folder from one browser to another.

Out of scope for v1, on purpose: renaming a bookmark, renaming a device after
onboarding, drag and drop, incognito windows, and any browser that is not
Chrome-family.

## The rules it holds to

1. **One owner per window.** Only the device a window belongs to writes its rows.
   Anything another device wants done there goes through a command.
2. **Restore copies, it does not link.** The restored window belongs to the
   browser that created it. It gets its own ids and diverges immediately.
3. **Bookmarks mirror per browser.** Trees are never merged. A copy is a new
   subtree created through `chrome.bookmarks.*` on the target browser.
4. **The server is authoritative for order.** `seq` comes from the Durable
   Object. Clients replay from their last `seq`; they never reconcile clocks.
5. **A write that changes nothing writes nothing.** Snapshots and bookmark
   upserts are diffed server-side before they touch a row.
6. **The extension never trusts an event payload for state.** It re-reads Chrome.

## Protocol

JSON, one message per frame, 1 MB cap, `PROTOCOL_VERSION = 1`.

| Direction | Frame                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C->S      | `hello { protocol, deviceId, name, os, browserVersion, extensionVersion, lastSeq, lastClientSeq }` - first frame; `deviceId` must equal the `?device=` tag |
| S->C      | `welcome { seq, mode: 'delta' \| 'snapshot' }` - carries no data                                                                                           |
| S->C      | `changes { seqFrom, seqTo, ops }` - both the welcome payload and live updates                                                                              |
| C->S      | `ops { clientSeq, ops }` - at most 100 ops                                                                                                                 |
| S->C      | `ack { clientSeq, seq }`                                                                                                                                   |
| S->C      | `commands { items }` - live, and whatever was pending at `hello`                                                                                           |
| S->C      | `error { code, message, retryAt? }`                                                                                                                        |
| text      | `ping` / `pong` every 20s                                                                                                                                  |

Close codes: `4001` protocol version, `4002` bad frame or ops before hello,
`4004` write budget exhausted.

`Op` is `upsert | delete | window_snapshot | command | command_done`.
Entities: `device | window | tab | tab_group | bookmark`.
Commands: `tab.close | tab.activate | window.close | bookmark.create |
bookmark.move | bookmark.remove | bookmark.copy`.

## Budgets

Free-plan Durable Objects allow 100 000 written rows per day and fail silently
past that, so the Worker keeps its own count and refuses before the platform
does, with `error { code: 'quota', retryAt }` and close `4004`. The numbers that
matter, asserted in `apply.test.ts`:

- reordering a 200-tab window: one row (`tab_order` is JSON on the window)
- closing a 200-tab window: at most three rows (cascade, not per tab)
- re-sending an unchanged snapshot or bookmark tree: zero rows

## Deploying

The hub runs on the user's own Cloudflare account, put there by the Deploy to
Cloudflare button in the README: it forks the repo, provisions the Durable
Object and asks for `PAIRING_SECRET` while it deploys. No API token, no domain
and no CLI. [DEPLOY.md](DEPLOY.md) is the whole procedure.

That key is the only thing guarding the hub. Every route - the WebSocket upgrade
included - answers 401 without it, and the check happens before the request can
reach the Durable Object. It rides in `Authorization` for REST and as the second
`Sec-WebSocket-Protocol` entry for the socket, never in the URL, because
invocation logs record URLs and not headers. The cost is stated plainly in the
README: whoever holds the key holds every tab and bookmark, and rotating it means
changing the secret and pairing both browsers again.

## Accessibility

WCAG 2.2 AA. Both panels are APG treegrids with roving tabindex; every action is
reachable from the keyboard; the row action button is rendered always (visible on
hover, focus and selection) so it clears the 24x24 target minimum; the focused
row is never left under a sticky header; the restore dialog is a native
`<dialog>`.

## Manual checks

The suite cannot cover these; they belong to a release.

- [ ] Chrome and Canary side by side, one window with 200+ tabs
- [ ] a branded Chrome build (not Chromium) loads the unpacked build
- [ ] Memory Saver discards a tab and no ghost row appears
- [ ] the dashboard next to `chrome://bookmarks` and Tab Search, light and dark
- [ ] Google Sync running on both profiles: copying a folder across produces no
      ping-pong in `wrangler tail`
- [ ] a fresh Cloudflare account reaches "connected" in both browsers using only
      `docs/DEPLOY.md` - any step the document does not cover is a documentation
      bug and is fixed before the release, not after

## Release

`pnpm check && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm e2e`,
then `pnpm zip` for the packaged build. Coverage runs on Istanbul rather than
V8, because the Workers pool runs inside workerd, which has no V8 profiler.

Before any of that, `docs/adr/0001-why-not-cloudflare-access.md` has to record a
real deploy through the button, and `pnpm verify:cloud` has to confirm that the
live hub refuses both a missing key and a wrong one.
