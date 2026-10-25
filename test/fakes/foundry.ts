// Minimal Foundry v13 / pf1 fakes for integration tests. One shared world (documents, settings,
// world time, chat, socket bus, hooks) seen through several clients (gm, player); `useClient`
// swaps the globals (game, canvas, fromUuid, ...) to that client's view.

type Listener = (...args: any[]) => unknown;

export interface FakeUser {
  id: string;
  name: string;
  isGM: boolean;
  isSelf: boolean;
}

function setProperty(target: any, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)!] = value;
}

function expand(data: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) setProperty(out, k, v);
  return out;
}

function mergeInto(target: any, source: any): void {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object") {
      mergeInto(target[k], v);
    } else target[k] = v;
  }
}

class Collection<T extends { id: string }> extends Array<T> {
  get(id: string): T | undefined {
    return this.find((d) => d.id === id);
  }
  get contents(): T[] {
    return [...this];
  }
}

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}${(++idCounter).toString().padStart(4, "0")}`;

export class FakeDocument {
  id: string;
  name: string;
  flags: Record<string, Record<string, any>>;
  system: any;
  parent: FakeDocument | null;
  [key: string]: any;

  constructor(
    readonly world: FakeWorld,
    readonly documentName: string,
    data: { id?: string; name?: string; flags?: any; system?: any; [key: string]: any },
    parent: FakeDocument | null = null,
  ) {
    const { id, name, flags, system, ...rest } = data;
    this.id = id ?? nextId(documentName);
    this.name = name ?? documentName;
    this.flags = structuredClone(flags ?? {});
    this.system = structuredClone(system ?? {});
    this.parent = parent;
    Object.assign(this, structuredClone(rest));
    world.registry.set(this.uuid, this);
  }

  get uuid(): string {
    return `${this.parent ? `${this.parent.uuid}.` : ""}${this.documentName}.${this.id}`;
  }

  getFlag(scope: string, key: string): any {
    return this.flags[scope]?.[key];
  }

  async setFlag(scope: string, key: string, value: any): Promise<this> {
    const current = this.flags[scope]?.[key];
    if (current && typeof current === "object" && value && typeof value === "object") {
      return this.update({ [`flags.${scope}.${key}`]: { ...current, ...value } });
    }
    return this.update({ [`flags.${scope}.${key}`]: value });
  }

  async unsetFlag(scope: string, key: string): Promise<this> {
    delete this.flags[scope]?.[key];
    return this;
  }

  async update(data: Record<string, unknown>): Promise<this> {
    const changes = expand(structuredClone(data));
    mergeInto(this, changes);
    this.world.hooks.callAll(`update${this.documentName}`, this, changes, {}, this.world.current?.user.id);
    return this;
  }
}

export class FakeActor extends FakeDocument {
  items = new Collection<FakeDocument>();
  statuses = new Set<string>();
  /** Scripted pf1 roll totals: skill rolls always return `skillTotal`; saves take `fortTotals` in turn (the last repeats). */
  skillTotal = 10;
  fortTotals: number[] = [10];
  skillCalls: { skillId: string; options: any }[] = [];
  /** User ids with OWNER permission (GMs always own). */
  owners: string[] = [];

  constructor(world: FakeWorld, data: any) {
    const { items, statuses, owners, skillTotal, fortTotals, ...rest } = data;
    super(world, "Actor", rest);
    this.owners = [...(owners ?? [])];
    if (skillTotal !== undefined) this.skillTotal = skillTotal;
    if (fortTotals !== undefined) this.fortTotals = [...fortTotals];
    for (const status of statuses ?? []) this.statuses.add(status);
    for (const item of items ?? []) this.createItem(item);
  }

  testUserPermission(user: { id: string; isGM: boolean }, level: string): boolean {
    return user.isGM || (level === "OWNER" && this.owners.includes(user.id));
  }

  get isOwner(): boolean {
    const user = (globalThis as any).game?.user;
    return !!user && this.testUserPermission(user, "OWNER");
  }

  // pf1 v11 returns the chat message; the total is on msg.rolls[0].
  async rollSkill(skillId: string, options: any = {}): Promise<any> {
    this.skillCalls.push({ skillId, options });
    return { rolls: [{ total: this.skillTotal }] };
  }

  async rollSavingThrow(_save: string, _options: any = {}): Promise<any> {
    const total = this.fortTotals.length > 1 ? this.fortTotals.shift()! : this.fortTotals[0];
    return { rolls: [{ total }] };
  }

  createItem(data: any): FakeDocument {
    const item = new FakeDocument(this.world, "Item", data, this);
    this.items.push(item);
    this.world.hooks.callAll("createItem", item, {}, this.world.current?.user.id);
    return item;
  }

  async setCondition(id: string, on: boolean): Promise<void> {
    // pf1 v11: fatigued and exhausted share the "lethargy" track; enabling one clears the other.
    const lethargy = ["fatigued", "exhausted"];
    if (on && lethargy.includes(id)) for (const other of lethargy) this.statuses.delete(other);
    if (on) this.statuses.add(id);
    else this.statuses.delete(id);
    this.world.hooks.callAll("updateActor", this, { statuses: [...this.statuses] }, {}, this.world.current?.user.id);
  }
}

export class FakeScene extends FakeDocument {
  tokens = new Collection<FakeDocument>();

  constructor(world: FakeWorld, data: any) {
    super(world, "Scene", data);
  }

  createToken(data: any): FakeDocument {
    const token = new FakeDocument(this.world, "Token", { x: 0, y: 0, ...data }, this);
    this.tokens.push(token);
    return token;
  }
}

export class FakeHooks {
  private listeners = new Map<string, { fn: (...args: any[]) => unknown; once: boolean }[]>();
  on(name: string, fn: (...args: any[]) => unknown): number {
    const list = this.listeners.get(name) ?? [];
    list.push({ fn, once: false });
    this.listeners.set(name, list);
    return list.length;
  }
  once(name: string, fn: (...args: any[]) => unknown): number {
    const list = this.listeners.get(name) ?? [];
    list.push({ fn, once: true });
    this.listeners.set(name, list);
    return list.length;
  }
  off(name: string, fn: (...args: any[]) => unknown): void {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((l) => l.fn !== fn));
  }
  callAll(name: string, ...args: any[]): true {
    const list = this.listeners.get(name) ?? [];
    this.listeners.set(name, list.filter((l) => !l.once));
    for (const l of list) l.fn(...args);
    return true;
  }
  call(name: string, ...args: any[]): boolean {
    return this.callAll(name, ...args);
  }
}

/** Stand-in for Foundry's Roll: every die shows `FakeRoll.next` (default 7). */
export class FakeRoll {
  static next = 7;
  constructor(readonly formula = "1d20") {}
  evaluateSync() {
    return { total: FakeRoll.next };
  }
  async evaluate() {
    return { total: FakeRoll.next };
  }
}

export interface FakeClient {
  user: FakeUser;
  game: any;
  socketListeners: Map<string, Listener[]>;
}

export class FakeWorld {
  registry = new Map<string, FakeDocument>();
  actors = new Collection<FakeActor>();
  scenes = new Collection<FakeScene>();
  users: { id: string; name: string; isGM: boolean }[] = [];
  settingsConfig = new Map<string, any>();
  settingsValues = new Map<string, any>();
  messages: any[] = [];
  worldTime = 0;
  hooks = new FakeHooks();
  clients: Record<string, FakeClient> = {};
  current: FakeClient | null = null;
  activeScene: FakeScene | null = null;
  /** GM user id the world treats as the active GM (null = no GM connected). */
  activeGMId: string | null = null;
  /** The canvas grid every client sees (a plain row-offset hex grid by default). */
  grid: any = {
    size: 100,
    isHexagonal: true,
    columns: false,
    even: false,
    getCenterPoint: ({ i, j }: { i: number; j: number }) => ({ x: j * 100 + 50, y: i * 100 + 50 }),
  };
  notifications = { info: [] as string[], warn: [] as string[], error: [] as string[] };
  private bus: Promise<void> = Promise.resolve();

  addClient(name: string, isGM: boolean): FakeClient {
    const user = { id: nextId("User"), name, isGM };
    this.users.push(user);
    if (isGM && !this.activeGMId) this.activeGMId = user.id;
    const client = this.buildClient(user);
    this.clients[name] = client;
    return client;
  }

  private buildClient(base: { id: string; name: string; isGM: boolean }): FakeClient {
    const world = this;
    const view = (u: { id: string; name: string; isGM: boolean }): FakeUser => ({ ...u, isSelf: u.id === base.id });
    const socketListeners = new Map<string, Listener[]>();
    const users = {
      get contents() {
        return world.users.map(view);
      },
      filter: (fn: (u: FakeUser) => boolean) => world.users.map(view).filter(fn),
      find: (fn: (u: FakeUser) => boolean) => world.users.map(view).find(fn),
      map: <R>(fn: (u: FakeUser) => R) => world.users.map(view).map(fn),
      get: (id: string) => world.users.map(view).find((u) => u.id === id),
      get activeGM() {
        const gm = world.users.find((u) => u.id === world.activeGMId);
        return gm ? view(gm) : null;
      },
      [Symbol.iterator]: () => world.users.map(view)[Symbol.iterator](),
    };
    const game = {
      user: view(base),
      users,
      actors: world.actors,
      scenes: world.scenes,
      settings: {
        register: (scope: string, key: string, config: any) => world.settingsConfig.set(`${scope}.${key}`, config),
        get: (scope: string, key: string) => {
          const id = `${scope}.${key}`;
          if (!world.settingsConfig.has(id)) throw new Error(`Setting not registered: ${id}`);
          return world.settingsValues.has(id) ? structuredClone(world.settingsValues.get(id)) : world.settingsConfig.get(id).default;
        },
        set: async (scope: string, key: string, value: any) => {
          const id = `${scope}.${key}`;
          if (!world.settingsConfig.has(id)) throw new Error(`Setting not registered: ${id}`);
          world.settingsValues.set(id, structuredClone(value));
          world.hooks.callAll("updateSetting", { key: id, value }, {}, {}, base.id);
          return value;
        },
      },
      socket: {
        on: (channel: string, fn: Listener) => {
          socketListeners.set(channel, [...(socketListeners.get(channel) ?? []), fn]);
        },
        // Like Foundry: every emitted argument is forwarded, then the real sender id is appended.
        emit: (channel: string, ...args: any[]) => world.broadcast(base.id, channel, args),
      },
      time: {
        get worldTime() {
          return world.worldTime;
        },
        advance: async (seconds: number) => {
          world.worldTime += seconds;
          return world.worldTime;
        },
      },
      modules: new Map(),
    };
    return { user: game.user, game, socketListeners };
  }

  /** Deliver to every OTHER client, one at a time, with globals switched to the receiver. */
  private broadcast(senderId: string, channel: string, args: any[]): void {
    const payload = structuredClone(args);
    this.bus = this.bus.then(async () => {
      for (const client of Object.values(this.clients)) {
        if (client.user.id === senderId) continue;
        for (const fn of client.socketListeners.get(channel) ?? []) {
          const previous = this.current;
          this.activate(client);
          try {
            await fn(...structuredClone(payload), senderId);
          } finally {
            if (previous) this.activate(previous);
          }
        }
      }
    });
  }

  /** Resolves once every queued socket message has been handled. */
  async flush(): Promise<void> {
    let last: Promise<void>;
    do {
      last = this.bus;
      await last;
    } while (last !== this.bus);
  }

  activate(client: FakeClient): void {
    this.current = client;
    const g = globalThis as any;
    g.game = client.game;
    g.canvas = { scene: this.activeScene, grid: this.grid };
    g.ui = {
      notifications: {
        info: (m: string) => this.notifications.info.push(m),
        warn: (m: string) => this.notifications.warn.push(m),
        error: (m: string) => this.notifications.error.push(m),
      },
    };
    g.Roll = FakeRoll;
    g.Hooks = this.hooks;
    g.fromUuidSync = (uuid: string) => this.registry.get(uuid) ?? null;
    g.fromUuid = async (uuid: string) => this.registry.get(uuid) ?? null;
    g.ChatMessage = {
      create: async (data: any) => {
        const message = { ...structuredClone(data), author: client.user.id };
        this.messages.push(message);
        return message;
      },
    };
  }

  createActor(data: any = {}): FakeActor {
    const actor = new FakeActor(this, data);
    this.actors.push(actor);
    return actor;
  }

  createScene(data: any = {}, active = true): FakeScene {
    const scene = new FakeScene(this, data);
    this.scenes.push(scene);
    if (active) {
      this.activeScene = scene;
      if (this.current) this.activate(this.current);
    }
    return scene;
  }
}

/** A world with a GM client and a player client; the GM client is active. */
export function createWorld(): FakeWorld & { gm: FakeClient; player: FakeClient } {
  const world = new FakeWorld();
  const gm = world.addClient("gm", true);
  const player = world.addClient("player", false);
  world.activate(gm);
  return Object.assign(world, { gm, player });
}

/** Switch the globals to a client of the world. */
export function useClient(world: FakeWorld, client: FakeClient): void {
  world.activate(client);
}
