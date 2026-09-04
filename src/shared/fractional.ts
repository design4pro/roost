/**
 * Fractional indexing over base-26 strings, used for `bookmarks.position`.
 *
 * A bookmark's place among its siblings has to survive being written by one
 * browser and read by another that has not seen the intervening moves, so an
 * integer index is the wrong shape: inserting at position 3 renumbers everything
 * after it, which is a row per sibling and a conflict per concurrent move. A
 * fractional key is a string strictly between its two neighbours, so an insert
 * writes exactly one row and two clients inserting in the same gap produce two
 * different keys instead of a collision.
 *
 * The digits are 'a'..'z' and the invariant is that a key never ends in 'a', the
 * zero digit - otherwise there would be no room left between it and its
 * predecessor. Every key this module returns satisfies that.
 */

const DIGITS = 'abcdefghijklmnopqrstuvwxyz'
const ZERO = DIGITS[0]!

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new Error(`fractional: ${a} is not below ${b}`)
  }
  if (a.endsWith(ZERO) || b?.endsWith(ZERO)) {
    throw new Error('fractional: key ends in the zero digit')
  }

  if (b !== null) {
    // Peel off the shared prefix and recurse on what is left: the midpoint of
    // 'abz' and 'acd' is 'a' followed by the midpoint of 'bz' and 'cd'.
    let shared = 0
    while ((a[shared] ?? ZERO) === b[shared]) shared++
    if (shared > 0) {
      return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared))
    }
  }

  const digitA = a === '' ? 0 : DIGITS.indexOf(a[0]!)
  const digitB = b === null ? DIGITS.length : DIGITS.indexOf(b[0]!)

  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))]!
  }
  // The two leading digits are adjacent, so there is nothing between them at
  // this length. Borrow a digit: either b has more to give, or we extend a.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1)
  }
  return DIGITS[digitA]! + midpoint(a.slice(1), null)
}

/**
 * A key strictly between `a` and `b`. Either bound may be null, meaning "no
 * neighbour on that side" - `keyBetween(null, null)` is the key of a list's
 * first and only item.
 */
export function keyBetween(a: string | null, b: string | null): string {
  return midpoint(a ?? '', b)
}

/** Keys for `count` items inserted in order between `a` and `b`. */
export function keysBetween(
  a: string | null,
  b: string | null,
  count: number,
): string[] {
  const keys: string[] = []
  let lower = a
  for (let i = 0; i < count; i++) {
    // Walking left to right and re-midpointing keeps every key inside (a, b)
    // and in ascending order, which a naive split into equal parts does not.
    const key = keyBetween(lower, b)
    keys.push(key)
    lower = key
  }
  return keys
}
