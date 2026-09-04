# 3. Matching windows after a browser restart

Date: 2026-09-03

## Status

Accepted.

## Context

Chrome's tab and window ids last as long as the session. This extension needs
ids that last longer, so it mints a UUID for every window, tab and group and
keeps the mapping in `storage.session` - which is emptied when the browser
closes, exactly as it should be, because the ids it describes are gone too.

The hub does not forget. After a restart it still holds every window this
device had open, while the browser has restored those same windows under new
numbers. Something has to decide which restored window is which, or the
dashboard shows every window twice: once as a ghost that will never change
again, and once as a new window.

Two options were considered:

1. Tell the hub the session has changed and delete every window this device
   owned, then report the restored ones as new. Simple, and wrong in the way
   that matters: a device with ten windows of two hundred tabs pays for
   deleting and recreating two thousand rows on every restart, and the free
   plan's daily row allowance is the binding constraint on this design.
2. Match the restored windows to the remembered ones by their contents.

## Decision

Match by content. `matchWindows` scores every local window against every remote
one by how many `(pinned, url)` pairs they share, ignoring order, as a fraction
of the larger window. Pairs above half are adopted best-first; a local window
with no match is new, a remote window with no match is reported closed.

The threshold is a judgement, not a measurement. Chrome drops tabs it could not
restore and the user closes a few before the extension wakes up, so demanding an
exact match would orphan a window over a single tab. Demanding much less would
merge two windows that happen to share a couple of pages.

## Consequences

A restart usually costs nothing: the windows are recognised, keep their ids, and
the snapshots this device then sends diff to nothing on the server.

A window that changed beyond recognition while the browser was closed is
reported as a new window and the old one as closed. That is the same outcome as
option 1, but only for the windows it actually applies to.

The matching is a pure function over lists of tabs, so the awkward cases - a
window that lost half its tabs, two similar windows, a first run with nothing to
match - are tests rather than something to find out in production.
