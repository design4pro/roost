/**
 * How the pairing key rides a WebSocket upgrade.
 *
 * A browser's WebSocket constructor lets a page choose the URL and the
 * subprotocol list, and nothing else - there is no way to set a header. The
 * key therefore travels as the second entry of that list, because the one
 * place it must never appear is the URL: the Worker's invocation logs record
 * the URL and the method of every request, and a key written there is a key
 * leaked to anyone who can read the logs.
 *
 * The first entry names the protocol and is what the hub echoes back.
 */
export const WS_SUBPROTOCOL = 'roost.v1'
