// Small helpers shared by the UI windows.

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function option(value: string, label: string, selected = false): string {
  return `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
}

/** `ui` (Foundry's UI singletons) is not in the shared globals declaration. */
export function toast(message: string, level: "info" | "warn" | "error" = "info"): void {
  const notifications = (globalThis as any).ui?.notifications;
  if (notifications) notifications[level](message);
  else console.warn(`pf1-hexploration | ${message}`);
}

/** Run an action handler, surfacing any thrown error as a notification. */
export async function attempt(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("pf1-hexploration |", err);
    toast(err instanceof Error ? err.message : String(err), "error");
  }
}

export function actorFor(uuid: string | null | undefined): any | null {
  if (!uuid) return null;
  try {
    return fromUuidSync(uuid) ?? null;
  } catch {
    return null;
  }
}

export function canControl(actor: any): boolean {
  return !!game.user?.isGM || !!actor?.isOwner;
}

/** Coalesce bursts of store changes into a single re-render. */
export function rerenderer(app: any): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (app.rendered) app.render();
    });
  };
}

/** Foundry drag payload ({type, uuid}) from a drop event, or null. */
export function dragData(event: DragEvent): any | null {
  try {
    const editor = foundry.applications?.ux?.TextEditor?.implementation ?? (globalThis as any).TextEditor;
    if (editor?.getDragEventData) return editor.getDragEventData(event);
    return JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
  } catch {
    return null;
  }
}
