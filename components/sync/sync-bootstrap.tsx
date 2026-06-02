"use client";

import { useEffect } from "react";
import { setLocalDBScope } from "@/lib/local-db";
import { createDesktopClient } from "@/lib/supabase/desktop-client";
import { webSyncService } from "@/lib/sync";
import { createClient } from "@/lib/supabase/client";
import { isTauriRuntime } from "@/lib/runtime/detect";
import { getAuthService } from "@/lib/services/auth-service-factory";

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
      const sessionResult = await getAuthService().getSession();
      const userId = sessionResult.data?.user?.id ?? undefined;
      const supabase = createClient();

      if (!isMounted) {
        return null;
      }

      setLocalDBScope(userId);

      if (userId) {
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
      const supabase = createDesktopClient();

      const sessionResult = await getAuthService().getSession();
      setLocalDBScope(sessionResult.data?.user?.id ?? undefined);
      await webSyncService.start();
      await webSyncService.scheduleFlush();
      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        setLocalDBScope(session?.user?.id);
        void webSyncService.scheduleFlush();
      });
      return () => authListener.subscription.unsubscribe();
    };

    const subscriptionPromise = desktop ? bootstrapDesktop() : bootstrapWeb();

    return () => {
      isMounted = false;
      void subscriptionPromise.then((subscription) => {
        if (typeof subscription === "function") {
          subscription();
          return;
        }
        subscription?.unsubscribe();
      });
      void webSyncService.stop();
    };
  }, []);

  return null;
}
