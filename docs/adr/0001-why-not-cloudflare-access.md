# 0001 - A pairing key instead of Cloudflare Access

Status: accepted

## Context

The hub was designed behind Cloudflare Access: a self-hosted application on the
user's own domain, a JWT verified against the team's JWKS, and a session cookie
the extension rode on every request. That is a stronger door than what replaced
it, and it was working in the test suite.

It could not be deployed by anyone but us. Access needs a hostname on an Active
zone, a Zero Trust team, a payment method on file even for the free plan, an API
token with five permissions, and a CLI run - about half an hour of setup on a
fresh account, and every step a place to get stuck. `POLICY_AUD`, which the
Worker needs in order to verify anything, only exists **after** the Access
application has been created; the "Deploy to Cloudflare" button asks for its
secrets **before** it deploys. The two cannot be reconciled: Access and
one-click deployment are mutually exclusive.

Nobody had ever deployed this. That is the fact that decided it.

## Decision

One secret, `PAIRING_SECRET`, set while the deploy button is running. The
extension generates it, shows it, and sends it on every request: as
`Authorization: Bearer` for REST, and as the second entry of the
`Sec-WebSocket-Protocol` list for the upgrade, because a browser WebSocket
cannot set headers and the URL is written to the Worker's invocation logs.

The Worker compares SHA-256 digests of the two keys with `timingSafeEqual` -
digests rather than the keys themselves, because that function throws on buffers
of unequal length, and a wrong-length guess would then produce an exception
instead of a 401 and leak the key's length in the difference. An unset or empty
`PAIRING_SECRET` refuses everything, so a half-finished deploy is shut rather
than open.

With no identity in the request there is nothing to name the Durable Object
after, so there is one hub per deployment, called `user`.

## Consequences

**What got better.** Deployment is a button. The two questions that were
blocking the release - whether the Access cookie survives a WebSocket upgrade,
and whether a host permission granted at runtime makes the request same-site
enough to carry it - existed only because the credential was a cookie, and both
disappear with a bearer token. A single distributable build now serves every
user, because nothing about the hostname has to be compiled into the manifest.
`jose`, the JWT verification, the cookie watcher, its two alarms and the
`cookies` permission are all gone: about 300 lines removed.

**What got worse, and is not hidden.** There is no user identity, no one-time
PIN, and no second factor. Anyone holding the key can read and change every tab
and bookmark. The key does not expire, so the only revocation is changing
`PAIRING_SECRET` and re-pairing both browsers - which locks both of them out at
once. The hub answers on a public `workers.dev` hostname rather than behind an
identity provider on a private domain.

A cheap mitigation exists for the re-pairing problem and is deliberately not
built yet: accepting a `PAIRING_SECRET_PREVIOUS` alongside the current one would
let a rotation happen one browser at a time. About fifteen lines, and worth
adding the first time a rotation is actually needed.

## Verification

Against a real `workerd` (`pnpm dev:worker`): `/api/health` answers 401 with no
key and 401 with a wrong one, 204 with the right one; `/auth/done` is 404; and a
WebSocket upgrade offering `roost.v1, <key>` gets a 101 that echoes
`Sec-WebSocket-Protocol: roost.v1`.

That echo is worth a note. Chrome does **not** enforce it - a browser only
refuses a subprotocol it did not itself offer, so a hub that echoed nothing
would still work there. The strict client is `ws`, used by the e2e suite's
second device, which throws `Server sent no subprotocol`. The asymmetry is in
our favour: the test that would catch a broken echo is the one that does not run
in a browser.
