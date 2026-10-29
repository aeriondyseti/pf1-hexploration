// Course plotting on the canvas, for any user (DESIGN §4.10): click a hex to set the destination,
// shift-click to add a waypoint. Each change goes to the GM as a setPlan request; the course is drawn
// on the hex layer by drawCourse.
import { store } from "../store";
import { travel } from "../travel";
import type { HexKey, MapData } from "../types";

let active = false;
let waypoints: HexKey[] = [];
let destination: HexKey | null = null;
let hint: HTMLElement | null = null;
let before: HexKey[] = [];

const key = (o: { i: number; j: number }): HexKey => `${o.i},${o.j}`;
const parse = (k: HexKey) => {
  const [i, j] = k.split(",").map(Number);
  return { i, j };
};

/** Adjacent-hex chain from `from` through each stop, excluding `from`. */
export function chain(from: HexKey, stops: HexKey[]): HexKey[] {
  const out: HexKey[] = [];
  let prev = from;
  for (const stop of stops) {
    const path: any[] = canvas.grid.getDirectPath([parse(prev), parse(stop)]) ?? [];
    for (const o of path.slice(1)) out.push(key(o));
    prev = stop;
  }
  return out;
}

function currentCourse(): HexKey[] {
  const from = store.getCaravan().position;
  if (!from) return [];
  const stops = destination ? [...waypoints, destination] : waypoints;
  return chain(from, stops);
}

async function send(text: string): Promise<void> {
  const res = await travel.setPlan({ activity: "travel", course: currentCourse(), routeId: null }, text);
  if (!res.ok) (globalThis as any).ui?.notifications?.warn(res.error ?? "The plan was refused.");
  updateHint();
}

function stopPlotting(): void {
  active = false;
  updateHint();
}

export function plotCourse(): void {
  const c = store.getCaravan();
  if (!canvas?.grid?.isHexagonal) return void (globalThis as any).ui?.notifications?.warn("Open a hex scene to plot a course.");
  if (!c.position) return void (globalThis as any).ui?.notifications?.warn("The GM hasn't placed the caravan on the map yet.");
  if (c.trip) return void (globalThis as any).ui?.notifications?.warn("A trip is underway.");
  before = [...c.plan.course];
  waypoints = [];
  destination = null;
  active = true;
  updateHint();
}

function onPointerDown(event: PointerEvent): void {
  if (!active || event.button !== 0) return;
  event.stopImmediatePropagation(); // keep the click from Foundry/PIXI (token selection, the painter)
  event.preventDefault();
  const pt = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  const at = key(canvas.grid.getOffset(pt));
  if (event.shiftKey) {
    waypoints.push(at);
    void send("added a waypoint");
  } else {
    destination = at;
    void send("set the destination");
  }
}

function updateHint(): void {
  if (!active) {
    hint?.remove();
    hint = null;
    return;
  }
  if (!hint) {
    hint = document.createElement("div");
    hint.id = "pf1hex-course-hint";
    hint.className = "pf1hex-course-hint";
    hint.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>("[data-hx]")?.dataset.hx;
      if (action === "clear") {
        waypoints = [];
        destination = null;
        void send("cleared the course");
      } else if (action === "cancel") {
        void travel.setPlan({ activity: "travel", course: before, routeId: null }, "kept the old course");
        stopPlotting();
      } else if (action === "done") stopPlotting();
    });
    (document.getElementById("interface") ?? document.body).append(hint);
  }
  const n = store.getCaravan().plan.course.length;
  hint.innerHTML = `<span><kbd>Click</kbd> a hex: destination</span>
    <span><kbd>Shift</kbd>+<kbd>Click</kbd>: waypoint</span>
    <strong>${n ? `${n} hex${n === 1 ? "" : "es"}` : "No course yet"}</strong>
    <button type="button" data-hx="clear">Clear</button>
    <button type="button" data-hx="cancel">Cancel</button>
    <button type="button" data-hx="done">Done</button>`;
}

export function registerCourse(): void {
  Hooks.on("canvasReady", () => {
    canvas.app?.view?.addEventListener("pointerdown", onPointerDown, { capture: true });
  });
  Hooks.on("canvasTearDown", () => {
    canvas.app?.view?.removeEventListener("pointerdown", onPointerDown, { capture: true });
    stopPlotting();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && active) {
        stopPlotting();
        e.stopPropagation();
      }
    },
    { capture: true },
  );
  Hooks.once("ready", () => store.onChange(() => active && updateHint()));
}

/** The planned course (no trip) or the trip's remaining course, from the caravan's hex. */
export function drawCourse(root: any, _map: MapData, size: number): void {
  const c = store.getCaravan();
  const course = c.trip ? c.trip.course : c.plan.course;
  if (!c.position || !course.length || !canvas?.grid) return;
  const pts = [c.position, ...course].map((k) => canvas.grid.getCenterPoint(parse(k)));
  const g = new PIXI.Graphics();
  g.lineStyle(Math.max(4, size / 8), c.trip ? 0xffc400 : 0xf3cb85, c.trip ? 0.85 : 0.7);
  g.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
  const end = pts[pts.length - 1];
  g.lineStyle(3, 0x141417, 1).beginFill(0xf3cb85, 1).drawCircle(end.x, end.y, size / 7).endFill();
  root.addChild(g);
}
