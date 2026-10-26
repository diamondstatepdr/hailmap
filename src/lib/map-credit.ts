/** The bits of the attribution control the toggle needs. Tests can fake this. */
export interface CreditControl {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  classList: { remove(name: string): void };
}

export interface CreditEvent {
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

let lastToggleAt = 0;

/**
 * One tap opens the OSM credit and the next closes it.
 * MapLibre's compact handler and the native `<details>` toggle both run on the
 * same tap and undo each other. This handler runs first, cancels both, and
 * keeps the open state on `data-credit`. A second event from that same tap is ignored.
 * The `<details open>` attribute has to stay set while the credit is open.
 * Current Chrome does not paint the credit line inside a closed details element,
 * even when CSS forces that line to display.
 */
export function toggleMapCredit(root: CreditControl, event?: CreditEvent): boolean {
  event?.preventDefault();
  event?.stopImmediatePropagation();
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - lastToggleAt < 40) return root.getAttribute("data-credit") === "open";
  lastToggleAt = now;
  const open = root.getAttribute("data-credit") !== "open";
  root.setAttribute("data-credit", open ? "open" : "closed");
  root.classList.remove("maplibregl-compact-show");
  if (open) root.setAttribute("open", "");
  else root.removeAttribute("open");
  return open;
}
