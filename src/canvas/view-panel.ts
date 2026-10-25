// The Hex View panel: per-user switches for what the hex layer draws, plus hover tooltips.
import { MODULE_ID } from "../types";
import { escapeHtml } from "./helpers";
import { DEFAULT_VIEW, VIEW_ROWS, getView, onViewChange, setView, type ViewOptions } from "./view";

let app: any = null;

function tooltipsOn(): boolean {
  try {
    return !!game.settings.get(MODULE_ID, "hexTooltips");
  } catch {
    return true;
  }
}

function render(): string {
  const gm = !!game.user?.isGM;
  const view = getView();
  const row = (name: string, label: string, on: boolean) =>
    `<label class="pf1hex-check"><input type="checkbox" name="${name}"${on ? " checked" : ""}> ${escapeHtml(label)}</label>`;
  const rows = VIEW_ROWS.filter((r) => gm || !r.gmOnly).map((r) => row(r.key, r.label, view[r.key]));
  return `<div class="pf1hex-view">
    ${rows.join("")}
    ${row("tooltips", "Hover tooltips", tooltipsOn())}
    <div class="buttons"><button type="button" data-action="showAll"><i class="fa-solid fa-eye"></i> Show all</button></div>
    <p class="hint">These settings are yours alone and stay on this browser.</p>
  </div>`;
}

function panelClass(): any {
  const { ApplicationV2 } = foundry.applications.api;
  return class HexViewPanel extends (ApplicationV2 as any) {
    unsubscribe: (() => void) | null = null;

    static DEFAULT_OPTIONS = {
      id: "pf1hex-view",
      classes: ["pf1hex", "pf1hex-view-panel"],
      window: { title: "Hex View", resizable: false, icon: "fa-solid fa-eye" },
      position: { width: 260, height: "auto" },
      actions: {
        async showAll() {
          await setView({ ...DEFAULT_VIEW });
          await game.settings.set(MODULE_ID, "hexTooltips", true);
        },
      },
    };

    async _renderHTML(): Promise<string> {
      return render();
    }

    _replaceHTML(result: string, content: HTMLElement): void {
      content.innerHTML = result;
    }

    async _onFirstRender(...args: any[]): Promise<void> {
      await super._onFirstRender?.(...args);
      this.unsubscribe = onViewChange(() => this.render());
      this.element.addEventListener("change", async (event: Event) => {
        const input = event.target as HTMLInputElement;
        if (input?.type !== "checkbox") return;
        if (input.name === "tooltips") await game.settings.set(MODULE_ID, "hexTooltips", input.checked);
        else if (input.name in DEFAULT_VIEW) await setView({ [input.name]: input.checked } as Partial<ViewOptions>);
      });
    }

    _onClose(...args: any[]): void {
      super._onClose?.(...args);
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  };
}

export function openViewPanel(): void {
  app ??= new (panelClass())();
  app.render({ force: true });
}
