// The Caravan window: roster, hold, wagon and pack import/export. Everyone views; the GM edits.
import { MODULE_ID, CARAVAN_TYPE, type CaravanState, type Pack, type RosterMember, type SupplyTrack } from "../types";
import { store } from "../store";
import { ledger } from "../ledger";
import { pf1Adapter } from "../pf1";
import { attempt, esc, option, rerenderer, toast } from "./html";

// Item flag keys the store reads for the hold (src/store supplyItems; not named in the contracts).
export const SUPPLY_FLAG = "supply";
export const UNITS_FLAG = "units";

let CaravanApp: any = null;

export function caravanAppClass(): any {
  if (CaravanApp) return CaravanApp;
  const { ApplicationV2 } = foundry.applications.api;

  CaravanApp = class extends (ApplicationV2 as any) {
    exportText: string | null = null;
    unsubscribe: (() => void) | null = null;

    static DEFAULT_OPTIONS = {
      id: "pf1hex-caravan",
      classes: ["pf1hex", "pf1hex-caravan"],
      window: { title: "Caravan", resizable: true, icon: "fa-solid fa-horse" },
      position: { width: 620, height: 700 },
      actions: {
        setActor: onSetActor,
        createCaravan: onCreateCaravan,
        openSheet: () => store.getCaravanActor()?.sheet?.render(true),
        addMember: onAddMember,
        removeMember: onRemoveMember,
        saveRoster: onSaveRoster,
        saveWagon: onSaveWagon,
        saveItem: onSaveItem,
        importPack: onImport,
        exportPack: onExport,
      },
    };

    async _renderHTML(): Promise<string> {
      return renderCaravan(this);
    }

    _replaceHTML(result: string, content: HTMLElement): void {
      content.innerHTML = result;
    }

    async _onFirstRender(...args: any[]): Promise<void> {
      await super._onFirstRender?.(...args);
      this.unsubscribe = store.onChange(rerenderer(this));
    }

    _onClose(...args: any[]): void {
      super._onClose?.(...args);
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  };
  return CaravanApp;
}

// ---------- rendering ----------

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const quantityOf = (item: any): number => Number(item?.system?.quantity ?? 0);

function renderCaravan(app: any): string {
  const gm = !!game.user?.isGM;
  const caravan = store.getCaravan();
  const actor = store.getCaravanActor();
  const actors: any[] = (game.actors?.contents ?? []).filter((a: any) => a.type === CARAVAN_TYPE);
  const inRoster = new Set(caravan.roster.map((m) => m.actorUuid));

  const actorSection = gm
    ? `<section class="pf1hex-row">
  <label>Caravan actor</label>
  <select name="caravanActor">${[option("", "— none —"), ...actors.map((a) => option(a.uuid, a.name, a.uuid === actor?.uuid))].join("")}</select>
  <button type="button" data-action="setActor">Set</button>
  <button type="button" data-action="createCaravan"><i class="fa-solid fa-plus"></i> New caravan</button>
  ${actor ? `<button type="button" data-action="openSheet"><i class="fa-solid fa-id-card"></i> Sheet</button>` : ""}
</section>`
    : `<h2>${actor ? esc(actor.name) : "No caravan set"}</h2>`;

  const rosterRows = caravan.roster.map((m, idx) => {
    if (!gm) {
      return `<tr><td>${esc(m.name)}</td><td class="num">${fmt(m.food)}</td><td class="num">${fmt(m.water)}</td><td>${
        m.draft ? "yes" : ""
      }</td><td>${m.npc ? "yes" : ""}</td><td></td></tr>`;
    }
    return `<tr data-index="${idx}">
  <td>${esc(m.name)}</td>
  <td><input type="number" step="0.1" min="0" name="food" value="${m.food}"></td>
  <td><input type="number" step="0.1" min="0" name="water" value="${m.water}"></td>
  <td><input type="checkbox" name="draft"${m.draft ? " checked" : ""}></td>
  <td><input type="checkbox" name="npc"${m.npc ? " checked" : ""}></td>
  <td><button type="button" data-action="removeMember" data-index="${idx}" title="Remove"><i class="fa-solid fa-trash"></i></button></td>
</tr>`;
  });
  const addable = actors.filter((a) => !inRoster.has(a.uuid) && a.uuid !== actor?.uuid);
  const rosterFooter = gm
    ? `<div class="pf1hex-row">
  <select name="addActor">${addable.map((a) => option(a.uuid, a.name)).join("")}</select>
  <label><input type="checkbox" name="addDraft"> draft</label>
  <button type="button" data-action="addMember"${addable.length ? "" : " disabled"}><i class="fa-solid fa-plus"></i> Add</button>
  <button type="button" data-action="saveRoster"${caravan.roster.length ? "" : " disabled"}><i class="fa-solid fa-floppy-disk"></i> Save roster</button>
</div>`
    : "";

  const supplies = store.supplyItems();
  const totals = store.supplyTotals();
  const holdRows = supplies.map(
    (s) =>
      `<tr><td>${esc(s.item.name)}${s.container ? ` <span class="pf1hex-note">in ${esc(s.container.name)}</span>` : ""}</td><td>${s.track}</td><td class="num">${quantityOf(s.item)}</td><td class="num">× ${fmt(
        s.unitsPerQuantity,
      )}</td><td class="num">${fmt(quantityOf(s.item) * s.unitsPerQuantity)}</td></tr>`,
  );

  const items: any[] = actor ? (actor.items?.contents ?? []).filter((i: any) => i.system?.quantity !== undefined) : [];
  const holdEditor =
    gm && items.length
      ? `<details class="pf1hex-hold-editor"><summary>Flag hold items as supplies (flag a container to count everything inside it)</summary>
<table class="pf1hex-table"><thead><tr><th>Item</th><th>Qty</th><th>Supply</th><th>Units/qty</th><th></th></tr></thead><tbody>
${items
  .map((item) => {
    const track = item.getFlag?.(MODULE_ID, SUPPLY_FLAG) ?? "";
    const units = item.getFlag?.(MODULE_ID, UNITS_FLAG) ?? 1;
    return `<tr data-item-id="${esc(item.id)}"><td>${esc(item.name)}</td><td class="num">${quantityOf(item)}</td>
<td><select name="supply">${option("", "none", !track)}${option("rations", "rations", track === "rations")}${option(
      "water",
      "water",
      track === "water",
    )}</select></td>
<td><input type="number" step="0.1" min="0" name="units" value="${units}"></td>
<td><button type="button" data-action="saveItem" data-item-id="${esc(item.id)}"><i class="fa-solid fa-floppy-disk"></i></button></td></tr>`;
  })
  .join("")}
</tbody></table></details>`
      : "";

  const wagon = gm
    ? `<div class="pf1hex-row">
  <label>Condition <input type="number" min="0" name="wagonCondition" value="${caravan.wagon.condition}"></label>
  <label>Max <input type="number" min="0" name="wagonMax" value="${caravan.wagon.max}"></label>
  <label>Draft required <input type="number" min="0" name="draftRequired" value="${caravan.draftRequired}"></label>
  <button type="button" data-action="saveWagon"><i class="fa-solid fa-floppy-disk"></i> Save</button>
</div>`
    : `<p>Condition <b>${caravan.wagon.condition}/${caravan.wagon.max}</b> · draft ${
        caravan.roster.filter((m) => m.draft).length
      }/${caravan.draftRequired}</p>`;

  const packs = gm
    ? `<section><h3>Content pack</h3>
  <textarea name="importJson" rows="4" placeholder="Paste a pf1-hexploration-pack JSON"></textarea>
  <div class="pf1hex-row">
    <button type="button" data-action="importPack"><i class="fa-solid fa-file-import"></i> Import pack</button>
    <input type="text" name="exportName" value="${esc(game.world?.title ?? "pack")}">
    <button type="button" data-action="exportPack"><i class="fa-solid fa-file-export"></i> Export pack</button>
  </div>
  ${app.exportText !== null ? `<textarea readonly rows="6" class="pf1hex-export">${esc(app.exportText)}</textarea>` : ""}
</section>`
    : "";

  return `${actorSection}
<section><h3>Roster</h3>
<table class="pf1hex-table"><thead><tr><th>Name</th><th>Food/day</th><th>Water/day</th><th>Draft</th><th>NPC</th><th></th></tr></thead>
<tbody>${rosterRows.join("") || `<tr><td colspan="6"><i>Empty</i></td></tr>`}</tbody></table>
${rosterFooter}</section>
<section><h3>Hold</h3>
<p>Rations <b>${fmt(totals.rations)}</b> · Water <b>${fmt(totals.water)}</b> person-days</p>
${
  holdRows.length
    ? `<table class="pf1hex-table"><thead><tr><th>Item</th><th>Supply</th><th>Qty</th><th>Units</th><th>Person-days</th></tr></thead><tbody>${holdRows.join(
        "",
      )}</tbody></table>`
    : `<p class="pf1hex-note">No supply items in the hold.</p>`
}
${holdEditor}</section>
<section><h3>Wagon</h3>${wagon}</section>
${packs}`;
}

// ---------- actions ----------

async function saveCaravan(label: string, next: CaravanState) {
  const before = structuredClone(store.getCaravan());
  await store.setCaravan(next);
  await ledger.record(label, [{ kind: "caravan", before, after: structuredClone(next) }]);
}

function field<T extends HTMLElement = HTMLInputElement>(app: any, selector: string): T | null {
  return app.element.querySelector(selector) as T | null;
}

function onSetActor(this: any) {
  return attempt(async () => {
    const uuid = field<HTMLSelectElement>(this, "select[name=caravanActor]")?.value || null;
    await store.setCaravanActor(uuid);
  });
}

function onCreateCaravan(this: any) {
  return attempt(async () => {
    if (!game.user?.isGM) return;
    const actor = await CONFIG.Actor.documentClass.create({ name: "Caravan", type: CARAVAN_TYPE, img: "icons/environment/settlement/wagon.webp" });
    if (actor) await store.setCaravanActor(actor.uuid);
  });
}

function onAddMember(this: any) {
  return attempt(async () => {
    const uuid = field<HTMLSelectElement>(this, "select[name=addActor]")?.value;
    if (!uuid) return;
    const actor = await fromUuid(uuid);
    if (!actor) return toast("Actor not found.", "warn");
    const draft = !!field(this, "input[name=addDraft]")?.checked;
    const caravan = store.getCaravan();
    const member = pf1Adapter.rosterMemberFor(actor, draft);
    await saveCaravan("Edit roster", { ...caravan, roster: [...caravan.roster, member] });
  });
}

function onRemoveMember(_event: Event, target: HTMLElement) {
  return attempt(async () => {
    const idx = Number(target.dataset.index);
    const caravan = store.getCaravan();
    const roster = caravan.roster.filter((_, i) => i !== idx);
    await saveCaravan("Edit roster", { ...caravan, roster });
  });
}

function onSaveRoster(this: any) {
  return attempt(async () => {
    const caravan = store.getCaravan();
    const roster: RosterMember[] = caravan.roster.map((m, idx) => {
      const row = this.element.querySelector(`tr[data-index="${idx}"]`) as HTMLElement | null;
      if (!row) return m;
      const num = (name: string, fallback: number) => {
        const v = Number((row.querySelector(`input[name=${name}]`) as HTMLInputElement | null)?.value);
        return Number.isFinite(v) && v >= 0 ? v : fallback;
      };
      const check = (name: string) => !!(row.querySelector(`input[name=${name}]`) as HTMLInputElement | null)?.checked;
      return { ...m, food: num("food", m.food), water: num("water", m.water), draft: check("draft"), npc: check("npc") };
    });
    await saveCaravan("Edit roster", { ...caravan, roster });
  });
}

function onSaveWagon(this: any) {
  return attempt(async () => {
    const caravan = store.getCaravan();
    const int = (name: string, fallback: number) => {
      const v = Math.floor(Number(field(this, `input[name=${name}]`)?.value));
      return Number.isFinite(v) && v >= 0 ? v : fallback;
    };
    const max = int("wagonMax", caravan.wagon.max);
    const condition = Math.min(int("wagonCondition", caravan.wagon.condition), max);
    await saveCaravan("Edit wagon", {
      ...caravan,
      wagon: { condition, max },
      draftRequired: int("draftRequired", caravan.draftRequired),
    });
  });
}

function onSaveItem(this: any, _event: Event, target: HTMLElement) {
  return attempt(async () => {
    const item = store.getCaravanActor()?.items?.get(target.dataset.itemId);
    const row = target.closest("tr");
    if (!item || !row) return;
    const track = (row.querySelector("select[name=supply]") as HTMLSelectElement).value as SupplyTrack | "";
    const units = Number((row.querySelector("input[name=units]") as HTMLInputElement).value);
    if (track) await item.setFlag(MODULE_ID, SUPPLY_FLAG, track);
    else await item.unsetFlag(MODULE_ID, SUPPLY_FLAG);
    await item.setFlag(MODULE_ID, UNITS_FLAG, Number.isFinite(units) && units > 0 ? units : 1);
    store.notify();
  });
}

function onImport(this: any) {
  return attempt(async () => {
    const text = field<HTMLTextAreaElement>(this, "textarea[name=importJson]")?.value.trim();
    if (!text) return toast("Paste a pack's JSON first.", "warn");
    let pack: Pack;
    try {
      pack = JSON.parse(text);
    } catch {
      return toast("That is not valid JSON.", "error");
    }
    if (pack?.format !== "pf1-hexploration-pack") return toast("Not a pf1-hexploration pack.", "error");
    await store.importPack(pack);
    toast(`Imported pack "${pack.name}".`);
  });
}

function onExport(this: any) {
  return attempt(() => {
    const name = field(this, "input[name=exportName]")?.value || "pack";
    this.exportText = JSON.stringify(store.exportPack(name), null, 2);
    this.render();
  });
}
