"use client";

import { useEffect } from "react";
import { setLocalDBScope } from "@/lib/local-db";
import { webSyncService } from "@/lib/sync";
import { createClient } from "@/lib/supabase/client";
import { isTauriRuntime } from "@/lib/runtime/detect";

export function SyncBootstrap() {
  useEffect(() => {
    let isMounted = true;
    const desktop = isTauriRuntime();

    const hydrateFromRemote = async () => {
      try {
        await webSyncService.hydrateWritings();
        return true;
      } catch (error) {
        console.error("[sync:bootstrap]", error);
        return false;
      }
    };

    const bootstrapWeb = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) {
        return null;
      }

      setLocalDBScope(user?.id);

      if (user?.id) {
        await hydrateFromRemote();
      }

      await webSyncService.start();
      await webSyncService.scheduleFlush();

      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        setLocalDBScope(session?.user?.id);
        if (session?.user?.id) {
          void hydrateFromRemote();
        }
        void webSyncService.scheduleFlush();
      });

      return authListener.subscription;
    };

    const bootstrapDesktop = async () => {
      setLocalDBScope(undefined);
      await webSyncService.start();
      await webSyncService.scheduleFlush();
      return null;
    };

    const subscriptionPromise = desktop ? bootstrapDesktop() : bootstrapWeb();

    return () => {
      isMounted = false;
      void subscriptionPromise.then((subscription) => {
        subscription?.unsubscribe();
      });
      void webSyncService.stop();
    };
  }, []);

  return null;
}
