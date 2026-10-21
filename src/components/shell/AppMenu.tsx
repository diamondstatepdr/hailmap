"use client";

import { Moon, Palette, SlidersHorizontal, SunMedium } from "lucide-react";

interface Props {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onAppearance: () => void;
  onFilters: () => void;
  onHelp: () => void;
  onClose: () => void;
}

export default function AppMenu({ theme, onToggleTheme, onAppearance, onFilters, onHelp, onClose }: Props) {
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
    </div>
  );
}
