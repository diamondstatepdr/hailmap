"use client";

import { Moon, Palette, Send, SlidersHorizontal, SunMedium } from "lucide-react";

interface StateChip {
  code: string;
  count: number;
  on: boolean;
}

interface Props {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onAppearance: () => void;
  onFilters: () => void;
  onHelp: () => void;
  onSendLeads: () => void;
  onClose: () => void;
  states?: StateChip[];
  onState?: (code: string) => void;
}

export default function AppMenu({ theme, onToggleTheme, onAppearance, onFilters, onHelp, onSendLeads, onClose, states = [], onState }: Props) {
  return (
    <div id="app-menu" className="app-menu" data-app-menu role="menu">
      <button type="button" role="menuitem" onClick={() => { onAppearance(); onClose(); }}>
        <Palette size={18} />
        Colors
      </button>
      <button type="button" role="menuitem" onClick={() => { onToggleTheme(); onClose(); }}>
        {theme === "dark" ? <SunMedium size={18} /> : <Moon size={18} />}
        {theme === "dark" ? "Light map" : "Dark map"}
      </button>
      <button type="button" role="menuitem" onClick={() => { onFilters(); onClose(); }}>
        <SlidersHorizontal size={18} />
        Filters
      </button>
      <button type="button" role="menuitem" onClick={() => { onHelp(); onClose(); }}>
        ?
        What do I do here?
      </button>
      <button type="button" role="menuitem" onClick={() => { onSendLeads(); onClose(); }}>
        <Send size={18} />
        Send leads
      </button>
      {states.length && onState ? (
        <div className="menu-states">
          <p>States</p>
          <div role="group" aria-label="Jump to a state">
            {states.map((item) => (
              <button
                key={item.code}
                type="button"
                role="menuitemcheckbox"
                aria-checked={item.on}
                onClick={() => {
                  onState(item.code);
                  onClose();
                }}
              >
                {item.code} {item.count}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
