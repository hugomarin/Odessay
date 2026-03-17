"use client";

import { useEffect } from "react";
import { getSyncWorker } from "@/lib/sync";

export function SyncBootstrap() {
  useEffect(() => {
    const worker = getSyncWorker();
    worker.start();

    return () => {
      worker.stop();
    };
  }, []);

  return null;
}
