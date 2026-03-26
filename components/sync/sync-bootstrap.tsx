"use client";

import { useEffect } from "react";
import { setLocalDBScope } from "@/lib/local-db";
import { getSyncWorker } from "@/lib/sync";
import { hydrateLocalWritingsFromRemote } from "@/lib/sync/remote-bootstrap";
import { createClient } from "@/lib/supabase/client";

export function SyncBootstrap() {
  useEffect(() => {
    const supabase = createClient();
    const worker = getSyncWorker();
    let isMounted = true;

    const hydrateFromRemote = async () => {
      try {
        await hydrateLocalWritingsFromRemote();
      } catch (error) {
        console.error("[sync:bootstrap]", error);
      }
    };

    const bootstrap = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) {
        return;
      }

      setLocalDBScope(user?.id);

      if (user?.id) {
        await hydrateFromRemote();
      }

      worker.start();
      worker.schedule(0);
    };

    void bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setLocalDBScope(session?.user?.id);
      if (session?.user?.id) {
        void hydrateFromRemote();
      }
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
