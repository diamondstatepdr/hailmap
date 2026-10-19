"use client";

import { useEffect } from "react";

export default function RegisterSw() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* The map still works without an offline shell. Push alerts need this registration. */
    });
  }, []);
  return null;
}
