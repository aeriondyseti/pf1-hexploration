// Authority: players send requests; only the active GM's client runs handlers and writes (invariant 2).
import type { AuthorityApi, RequestHandler } from "../contracts";
import { MODULE_ID, type Request, type RequestEnvelope, type RequestResult } from "../types";

export const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const REPLY_TIMEOUT_MS = 10_000;

type SocketMessage =
  | { kind: "request"; envelope: RequestEnvelope }
  | { kind: "reply"; id: string; result: RequestResult; toUserId: string };

const handlers = new Map<string, RequestHandler>();
const pending = new Map<string, (result: RequestResult) => void>();

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function handle(request: unknown, userId: string): Promise<RequestResult> {
  const type = (request as Request | null)?.type;
  if (!request || typeof request !== "object" || typeof type !== "string") {
    return { ok: false, error: "Malformed request" };
  }
  const handler = handlers.get(type);
  if (!handler) return { ok: false, error: `Unknown request type: ${type}` };
  try {
    return await handler(request as Request, userId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function onMessage(message: SocketMessage, senderId: unknown): Promise<void> {
  if (message?.kind === "request") {
    if (!authority.isActiveGM()) return;
    const envelope = message.envelope;
    if (!envelope || typeof envelope.id !== "string") return;
    // Only the server-reported sender counts; a request whose envelope names someone else is forged.
    if (typeof senderId !== "string" || !game.users?.get(senderId)) return;
    const userId = senderId;
    const result =
      envelope.userId === senderId ? await handle(envelope.request, userId) : { ok: false, error: "Sender mismatch" };
    const reply: SocketMessage = { kind: "reply", id: envelope.id, result, toUserId: userId };
    game.socket.emit(SOCKET_CHANNEL, reply);
  } else if (message?.kind === "reply") {
    if (message.toUserId !== game.user?.id) return;
    pending.get(message.id)?.(message.result);
  }
}

export const authority = {
  init() {
    // Foundry appends the real sender id as the LAST argument; a client can pad extra arguments
    // to emit(), so never read it positionally.
    game.socket.on(SOCKET_CHANNEL, (...args: unknown[]) => onMessage(args[0] as SocketMessage, args.at(-1)));
  },

  async send(request: Request): Promise<RequestResult> {
    if (authority.isActiveGM()) return handle(request, game.user.id);
    if (!game.users?.activeGM) return { ok: false, error: "No GM connected" };

    const envelope: RequestEnvelope = { id: randomId(), userId: game.user.id, request };
    return new Promise<RequestResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(envelope.id);
        resolve({ ok: false, error: "No GM connected" });
      }, REPLY_TIMEOUT_MS);
      pending.set(envelope.id, (result) => {
        clearTimeout(timer);
        pending.delete(envelope.id);
        resolve(result);
      });
      const message: SocketMessage = { kind: "request", envelope };
      game.socket.emit(SOCKET_CHANNEL, message);
    });
  },

  registerHandler(type: Request["type"], handler: RequestHandler) {
    handlers.set(type, handler);
  },

  isActiveGM(): boolean {
    return !!game.users?.activeGM?.isSelf;
  },
} satisfies AuthorityApi;
