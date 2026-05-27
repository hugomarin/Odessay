"use client";

import { useEffect } from "react";
import { setLocalDBScope } from "@/lib/local-db";
import { webSyncService } from "@/lib/sync";
import { createClient } from "@/lib/supabase/client";

export function SyncBootstrap() {
  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    const hydrateFromRemote = async () => {
      try {
        await webSyncService.hydrateWritings();
        return true;
      } catch (error) {
        console.error("[sync:bootstrap]", error);
        return false;
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

      await webSyncService.start();
      await webSyncService.scheduleFlush();
    };

    void bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setLocalDBScope(session?.user?.id);
      if (session?.user?.id) {
        void hydrateFromRemote();
      }
      void webSyncService.scheduleFlush();
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
      void webSyncService.stop();
    };
  }, []);

  return null;
}
