# 2. One bookmark mirror per browser

Date: 2026-09-03

## Status

Accepted.

## Context

Chrome and Canary each have a full bookmark tree, and on this machine both of
them are already synchronised by Google Sync to their own accounts. The obvious
feature request - "show me one merged tree" - asks this extension to decide what
happens when the two trees disagree: which title wins, where a folder that
exists in one browser and not the other belongs, and what to do when Google Sync
undoes a write a moment after we made it.

That is a conflict-resolution problem on data the user did not ask us to own,
running alongside another synchroniser that has the same job and more authority.
The failure mode is not a lost row; it is two synchronisers writing to each
other in a loop, and a user watching their bookmarks bar rearrange itself.

## Decision

Each browser mirrors its own tree and nothing else. A bookmark's id carries the
device that owns it (`${deviceId}:${chromeId}`), the dashboard shows one tree per
device, and nothing from another device ever appears in the local tree by
itself.

What crosses the gap is a copy, and only when the user asks: "Copy to this
browser" sends the subtree as a `bookmark.copy` command that the receiving
browser carries out through `chrome.bookmarks.*`. The events those calls produce
are the only path back into the mirror - the executor writes no ops of its own.

Roots are classified by `folderType` (Chrome 134+) rather than by the ids `"1"`
and `"2"`, because a profile being migrated to account bookmarks can hold two
bars and two "other" folders at once, and the legacy ids name only one of each.

## Consequences

There is no echo suppression anywhere in the bookmark path, and none is needed:
a copied folder is indistinguishable from one the user made by hand, which is
exactly what the mirror should record. Google Sync sees ordinary local edits and
has nothing to fight with.

The cost is that the same bookmark saved in both browsers is two rows here, and
the user is the one who decides they are the same thing. In exchange, this
extension never has to be right about a merge it was never asked to make.
