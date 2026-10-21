"use client";

import type { ReactNode } from "react";
import BottomSheet from "@/components/ui/BottomSheet";

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom map card for a report, warning, county, or radar swath. */
export default function MapDetailSheet({ label, onClose, children }: Props) {
  return (
    <BottomSheet label={label} tone="map" onClose={onClose} expandedMax="min(70dvh, 32rem)" peekHeight={112}>
      <div className="px-4 pb-4">{children}</div>
    </BottomSheet>
  );
}
