"use client";

import { useEffect } from "react";
import { setLocalDBScope } from "@/lib/local-db";
import { getSyncWorker } from "@/lib/sync";
import { createClient } from "@/lib/supabase/client";

export function SyncBootstrap() {
  useEffect(() => {
    const supabase = createClient();
    const worker = getSyncWorker();
    let isMounted = true;

    const bootstrap = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) {
        return;
      }

      setLocalDBScope(user?.id);
      worker.start();
    };

    void bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setLocalDBScope(session?.user?.id);
      worker.schedule(0);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
      worker.stop();
    };
  }, []);

  return null;
}
