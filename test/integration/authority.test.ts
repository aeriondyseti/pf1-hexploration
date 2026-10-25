import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, useClient } from "../fakes/foundry";
import { authority, SOCKET_CHANNEL } from "../../src/authority";
import type { Request } from "../../src/types";

describe("authority", () => {
  let world: ReturnType<typeof createWorld>;
  const seen: { userId: string; handledBy: string; isGM: boolean }[] = [];
  const claim: Request = { type: "claimRole", roleId: "scout", actorUuid: "Actor.a" };

  beforeEach(() => {
    seen.length = 0;
    world = createWorld();
    authority.registerHandler("claimRole", async (_request, userId) => {
      seen.push({ userId, handledBy: game.user.id, isGM: game.user.isGM });
      return { ok: true };
    });
    authority.registerHandler("releaseRole", async () => {
      throw new Error("Role not held");
    });
    for (const client of [world.gm, world.player]) {
      useClient(world, client);
      authority.init();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("knows which client is the active GM", () => {
    useClient(world, world.gm);
    expect(authority.isActiveGM()).toBe(true);
    useClient(world, world.player);
    expect(authority.isActiveGM()).toBe(false);
  });

  it("applies a player request only on the GM client", async () => {
    useClient(world, world.player);
    expect(await authority.send(claim)).toEqual({ ok: true });
    expect(seen).toEqual([{ userId: world.player.user.id, handledBy: world.gm.user.id, isGM: true }]);
    expect(game.user.id).toBe(world.player.user.id);
  });

  it("runs a GM request locally", async () => {
    useClient(world, world.gm);
    expect(await authority.send(claim)).toEqual({ ok: true });
    expect(seen).toEqual([{ userId: world.gm.user.id, handledBy: world.gm.user.id, isGM: true }]);
  });

  it("rejects unknown and malformed requests, and reports handler errors", async () => {
    useClient(world, world.player);
    expect(await authority.send({ type: "bogus" } as any)).toMatchObject({ ok: false, error: expect.stringContaining("Unknown") });
    expect(await authority.send(null as any)).toEqual({ ok: false, error: "Malformed request" });
    expect(await authority.send({ type: "releaseRole", roleId: "scout", actorUuid: "Actor.a" })).toEqual({
      ok: false,
      error: "Role not held",
    });
    expect(seen).toHaveLength(0);
  });

  it("refuses an envelope that names someone other than the socket sender", async () => {
    useClient(world, world.player);
    game.socket.emit(SOCKET_CHANNEL, { kind: "request", envelope: { id: "forged", userId: world.gm.user.id, request: claim } });
    await world.flush();
    expect(seen).toEqual([]);
  });

  it("reads the server-appended sender, not an extra argument padded by the client", async () => {
    useClient(world, world.player);
    const envelope = { id: "padded", userId: world.gm.user.id, request: claim };
    (game.socket.emit as any)(SOCKET_CHANNEL, { kind: "request", envelope }, world.gm.user.id);
    await world.flush();
    expect(seen).toEqual([]);
    game.socket.emit(SOCKET_CHANNEL, { kind: "request", envelope: { ...envelope, id: "honest", userId: world.player.user.id } });
    await world.flush();
    expect(seen).toEqual([{ userId: world.player.user.id, handledBy: world.gm.user.id, isGM: true }]);
  });

  it("fails fast with no GM, and times out when the GM never answers", async () => {
    useClient(world, world.player);
    world.activeGMId = null;
    expect(await authority.send(claim)).toEqual({ ok: false, error: "No GM connected" });

    world.activeGMId = world.gm.user.id;
    world.gm.socketListeners.clear(); // GM connected but not listening
    vi.useFakeTimers();
    const pending = authority.send(claim);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, error: "No GM connected" });
  });
});
