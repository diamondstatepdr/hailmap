"use client";

import type { ReactNode } from "react";
import BottomSheet from "@/components/ui/BottomSheet";

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
  expandedMax?: string;
}

/** Bottom map card for a report, warning, county, or radar swath. */
export default function MapDetailSheet({ label, onClose, children, expandedMax = "min(70dvh, 32rem)" }: Props) {
  return (
    <BottomSheet label={label} tone="map" onClose={onClose} expandedMax={expandedMax} peekHeight={112}>
      <div className="map-detail-body">{children}</div>
    </BottomSheet>
  );
}
