"use client";

import { useEffect } from "react";

export default function RegisterSw() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* The map still works without an offline shell. */
    });
  }, []);
  return null;
}
