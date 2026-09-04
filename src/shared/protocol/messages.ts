import { z } from 'zod'
import { CommandBody, Op } from './ops'

/** At most this many ops in one `ops` frame; more is a protocol error. */
export const MAX_OPS_PER_FRAME = 100

export const Hello = z.looseObject({
  type: z.literal('hello'),
  protocol: z.number(),
  deviceId: z.string(),
  name: z.string(),
  os: z.string(),
  browserVersion: z.string(),
  extensionVersion: z.string(),
  /** The last `seq` this client applied; the server replays from there. */
  lastSeq: z.number(),
  /** The last `clientSeq` this client believes was acked, for idempotency. */
  lastClientSeq: z.number(),
})
export type Hello = z.infer<typeof Hello>

export const OpsFrame = z.looseObject({
  type: z.literal('ops'),
  clientSeq: z.number(),
  ops: z.array(Op).max(MAX_OPS_PER_FRAME),
})
export type OpsFrame = z.infer<typeof OpsFrame>

/**
 * Carries no data on purpose. Everything the client is missing arrives as
 * `changes` frames, so there is exactly one code path that applies ops - and no
 * frame that has to hold a whole account at once.
 */
export const Welcome = z.looseObject({
  type: z.literal('welcome'),
  seq: z.number(),
  mode: z.enum(['delta', 'snapshot']),
})
export type Welcome = z.infer<typeof Welcome>

export const Changes = z.looseObject({
  type: z.literal('changes'),
  seqFrom: z.number(),
  seqTo: z.number(),
  ops: z.array(Op),
})
export type Changes = z.infer<typeof Changes>

export const Ack = z.looseObject({
  type: z.literal('ack'),
  clientSeq: z.number(),
  seq: z.number(),
})
export type Ack = z.infer<typeof Ack>

export const Commands = z.looseObject({
  type: z.literal('commands'),
  items: z.array(
    z.looseObject({
      id: z.string(),
      originDeviceId: z.string(),
      body: CommandBody,
    }),
  ),
})
export type Commands = z.infer<typeof Commands>

export const ErrorCode = z.enum([
  'protocol',
  'bad_request',
  'not_owner',
  'quota',
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ErrorFrame = z.looseObject({
  type: z.literal('error'),
  code: ErrorCode,
  message: z.string(),
  /** Epoch ms the client may try again, set for `quota`. */
  retryAt: z.number().optional(),
})
export type ErrorFrame = z.infer<typeof ErrorFrame>

export const ClientFrame = z.discriminatedUnion('type', [Hello, OpsFrame])
export type ClientFrame = z.infer<typeof ClientFrame>

export const ServerFrame = z.discriminatedUnion('type', [
  Welcome,
  Changes,
  Ack,
  Commands,
  ErrorFrame,
])
export type ServerFrame = z.infer<typeof ServerFrame>

/** Close codes. Anything outside this list came from the platform. */
export const CLOSE_PROTOCOL_VERSION = 4001
export const CLOSE_BAD_FRAME = 4002
export const CLOSE_QUOTA = 4004
