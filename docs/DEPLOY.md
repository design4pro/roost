# Deploying your own hub

Roost has no server run by anyone else. You deploy one Worker and one SQLite
Durable Object to your own Cloudflare account, and only your browsers can reach
them. A free plan is enough.

You need a Cloudflare account and a GitHub or GitLab account - the deploy button
forks this repository into yours so that Cloudflare can build it. You do not
need a domain, and you do not need Node or a terminal.

## 1. Copy the key

Open the extension. Its first screen has generated a pairing key for you: a
43-character string. Copy it. This is the only thing that will stand between the
internet and your tabs, so treat it like a password.

If you are setting up a **second** browser, do not use the key it generated -
paste the key from the first browser into that field instead, and skip to
step 3.

## 2. Deploy

Click **Deploy to Cloudflare** on that screen, or the button in the
[README](../README.md). Cloudflare will:

- fork this repository into your GitHub or GitLab account,
- ask you for `PAIRING_SECRET` - paste the key,
- create the Durable Object namespace and deploy the Worker.

It finishes with an address like `https://roost.<your-subdomain>.workers.dev`.

## 3. Connect the browser

Paste that address into the extension's **Worker address** field, name the
browser, and press **Connect**. Chrome will ask for permission to talk to that
host; the extension cannot ask for it before you say where the host is.

Repeat both fields in your other browser, with the same key.

## Optional: your own domain

The `workers.dev` address works and is protected by the same key. If you would
rather use your own: **Workers & Pages -> roost -> Settings -> Domains &
Routes -> Add custom domain**. The domain has to be on an Active zone in the
same account. Then paste the new address into both browsers.

## Rotating the key

Change `PAIRING_SECRET` under **Settings -> Variables and Secrets**, then pair
both browsers again from the banner the dashboard shows. There is no way to
revoke a key without changing it - see
[adr/0001](adr/0001-why-not-cloudflare-access.md).

## When something does not work

**"Nothing answered at that address."** The address is wrong, or the deploy has
not finished. Open it in a tab: a working hub answers `{"error":"unauthorized"}`
with a 401, because your browser has no key. Anything else - a Cloudflare error
page, a timeout - means the Worker is not there yet.

**"That address answered, but refused this key."** The hub is up and the key
does not match. Check `PAIRING_SECRET` under **Settings -> Variables and
Secrets**; a value set with a trailing space or a missing character will do
this. Setting it again deploys a new version.

**Everything answers 401, including the right key.** The deploy ran without
`PAIRING_SECRET` being set at all - an unset key refuses everything on purpose,
rather than letting the hub stand open. Set it and redeploy.

**The build failed on Cloudflare.** Its build command comes from this
repository's `build` script and should be
`wrangler deploy --dry-run --outdir .worker-build`, with `npx wrangler deploy`
as the deploy command. If Workers Builds guessed something else, correct it
under **Settings -> Builds**.

**The dashboard says the hub refused this browser's key.** Press **Pair again**
in that banner and paste the key the other browser uses.

## Checking it from a terminal

Optional, and only if you have Node:

```bash
SYNC_HOSTNAME=roost.your-subdomain.workers.dev pnpm verify:cloud
```

It asks one question - whether the hub refuses a request that carries no key -
because that is the failure that looks like success from a browser that already
has one.
