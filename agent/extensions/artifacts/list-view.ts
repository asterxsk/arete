import { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { Key } from "@earendil-works/pi-tui";
import type { ArtifactInfo } from "./storage.ts";
import { buildListItems } from "./list-helpers.ts";
import type { ListItem } from "./list-helpers.ts";

interface ListViewTheme {
  fg: (name: string, text: string) => string;
  bg: (name: string, text: string) => string;
  bold: (text: string) => string;
  inverse: (text: string) => string;
}

interface CustomUiContext {
  ui: {
    custom: <T>(
      factory: (
        tui: unknown,
        theme: ListViewTheme,
        keybindings: unknown,
        done: (result: T) => void,
      ) => Component,
    ) => Promise<T>;
  };
}

const TAB_LABELS = ["html", "md"] as const;

class ArtifactListComponent {
  private readonly tabs: { label: string; items: ListItem[] }[];
  private tabIndex = 0;
  private itemIndex = 0;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  public onDone: ((result: ListItem | null) => void) | undefined;

  constructor(
    private readonly tui: { requestRender: () => void },
    private readonly theme: ListViewTheme,
    artifacts: ArtifactInfo[],
    nowMs: number,
  ) {
    const allItems = buildListItems(artifacts, nowMs);
    const htmlTab = {
      label: "html",
      items: allItems.filter((item) => item.value.endsWith(".html")),
    };
    const mdTab = {
      label: "md",
      items: allItems.filter((item) => item.value.endsWith(".md")),
    };

    if (mdTab.items.length > 0) {
      this.tabs = [mdTab, htmlTab];
    } else {
      this.tabs = [htmlTab, mdTab];
    }
    this.tabIndex = 0;
  }

  get focused(): boolean {
    return true;
  }

  set focused(_value: boolean) {
    // Not used — no child input components need focus management
  }

  private moveTab(delta: number): void {
    if (this.tabs.length === 0) return;
    this.tabIndex = (this.tabIndex + delta + this.tabs.length) % this.tabs.length;
    this.itemIndex = 0;
    this.invalidate();
  }

  private moveItem(delta: number): void {
    const items = this.tabs[this.tabIndex]?.items;
    if (!items || items.length === 0) return;
    let next = this.itemIndex + delta;
    if (next < 0) next = 0;
    if (next >= items.length) next = items.length - 1;
    this.itemIndex = next;
    this.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
      this.moveTab(1);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.moveTab(-1);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.moveItem(-1);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.moveItem(1);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const items = this.tabs[this.tabIndex]?.items;
      if (items && items[this.itemIndex]) {
        this.onDone?.(items[this.itemIndex]);
      }
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.onDone?.(null);
      return;
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const lines: string[] = [];
    const add = (text: string) => lines.push(truncateToWidth(text, width));

    // Top divider
    const divider = this.theme.fg("accent", "─".repeat(Math.max(0, width)));
    add(divider);

    // Header
    add(this.theme.fg("accent", this.theme.bold(" Artifact Picker")));
    lines.push("");

    // Tabs
    const tabs = this.tabs.map((tab, i) => {
      const label = tab.label;
      if (i === this.tabIndex) {
        return this.theme.bg("selectedBg", this.theme.fg("text", this.theme.bold(` ${label} `)));
      }
      return this.theme.bg("toolPendingBg", this.theme.fg("muted", ` ${label} `));
    });
    add(" " + tabs.join(" "));
    lines.push("");

    // Content
    const tab = this.tabs[this.tabIndex];
    if (!tab || tab.items.length === 0) {
      add(this.theme.fg("muted", " No artifacts found."));
    } else {
      for (let i = 0; i < tab.items.length; i++) {
        const item = tab.items[i];
        const selected = i === this.itemIndex;
        const icon = selected ? "■" : "□";
        const marker = selected
          ? this.theme.fg("accent", `  ${icon} `)
          : `  ${icon} `;
        const name = selected
          ? this.theme.fg("accent", item.label)
          : this.theme.fg("text", item.label);

        // Right-aligned description (relative time), truncated to fit
        const desc = item.description ?? "";
        const descText = this.theme.fg("dim", desc);
        const nameStr = `${marker}${name}`;
        const remainingWidth = Math.max(0, width - nameStr.length - 2);
        const truncatedDesc = remainingWidth > 0 ? truncateToWidth(descText, remainingWidth) : "";
        const paddedName = nameStr + " ".repeat(Math.max(0, width - nameStr.length - truncatedDesc.length));
        add(`${paddedName}${truncatedDesc}`);
      }
    }

    lines.push("");

    // Help text
    add(this.theme.fg("dim", "Tab switch • ↑↓ move • Enter open • Esc close"));

    // Bottom divider
    add(divider);

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export function showArtifactList(
  ctx: CustomUiContext,
  artifacts: ArtifactInfo[],
): Promise<ListItem | null> {
  return ctx.ui.custom<ListItem | null>((_tui, theme, _keybindings, done) => {
    const component = new ArtifactListComponent(_tui, theme, artifacts, Date.now());
    component.onDone = done;
    return component;
  });
}
