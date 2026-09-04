# Roost

One place to see and manage the open tabs, tab groups, windows and bookmarks of
every Chrome-family browser you use - and to reopen a 200-tab Canary window in
Chrome without waiting for 200 page loads.

Everything is stored in **your** Cloudflare account: one Worker and one SQLite
Durable Object, deployed by one click. There is no server run by anyone else,
and no account to create anywhere but Cloudflare.

- **Realtime** - a WebSocket to a Durable Object; a tab you open in Canary shows
  up in Chrome as fast as the round trip.
- **Native-looking** - the dashboard is a full page styled after
  `chrome://bookmarks` and Tab Search, light and dark, keyboard-complete.
- **Yours** - your hub, on your account, reachable only with a key your browser
  generated and only you have.

## Getting started

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/design4pro/chrome-extension-roost)

The extension's first screen generates a pairing key and links to that button.
Cloudflare asks for the key as `PAIRING_SECRET` while it deploys, and hands back
an address like `https://roost.<your-subdomain>.workers.dev`; paste that address
back into the extension and the browser is connected. A second browser needs the
same address and the same key. [docs/DEPLOY.md](docs/DEPLOY.md) has the details,
including what to do when something goes wrong.

## What guards your hub

One key, and nothing else. The hub answers on a public `workers.dev` address,
and every request - the WebSocket upgrade included - has to present the key or
gets a 401. That is a deliberate trade: it is what makes a one-click deploy
possible, and it is weaker than an identity provider in front of the door.

- The key is 256 bits of randomness, compared in constant time, and never put in
  a URL - the Worker's own logs record those.
- Anyone who holds the key can read and change every tab and bookmark you sync.
- There is no expiry and no revocation list. If the key leaks, change
  `PAIRING_SECRET` in the Cloudflare dashboard and pair both browsers again.

## Working on it

```bash
pnpm install
pnpm dev             # the extension, rebuilt on save (.output/chrome-mv3)
pnpm dev:worker      # the Worker, on http://localhost:3011
pnpm build           # what Cloudflare runs: a dry-run deploy of the Worker
pnpm build:extension # the extension bundle
pnpm test            # unit tests
pnpm e2e             # Playwright, against a real Chromium with the extension loaded
```

Copy `.dev.vars.example` to `.dev.vars` before `pnpm dev:worker` or `pnpm e2e`;
it carries the pairing key the local hub expects.

Load `.output/chrome-mv3` through **Load unpacked** in `chrome://extensions`, in
both Chrome and Canary. The extension id is pinned, so the same build gets the
same origin in both.

- [docs/SPEC.md](docs/SPEC.md) - what it does, and the rules it holds to
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - how it is put together
- [docs/adr/](docs/adr/) - decisions and why they went that way
