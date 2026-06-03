"use client";

import { useEffect } from "react";
import { setLocalDBScope } from "@/lib/local-db";
import { createDesktopClient } from "@/lib/supabase/desktop-client";
import { createClient } from "@/lib/supabase/client";
import { isTauriRuntime } from "@/lib/runtime/detect";
import { getAuthService } from "@/lib/services/auth-service-factory";
import { getSyncService } from "@/lib/sync/sync-service-factory";

export function SyncBootstrap() {
  useEffect(() => {
    let isMounted = true;
    const desktop = isTauriRuntime();
    const syncService = getSyncService();

    const hydrateFromRemote = async () => {
      try {
        await syncService.hydrateWritings();
        await syncService.hydrateCollections();
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

      await syncService.start();
      await syncService.scheduleFlush();

      const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          setLocalDBScope(undefined);
          return;
        }

        const nextUserId = session?.user?.id;
        // Ignore transient null sessions: INITIAL_SESSION / TOKEN_REFRESHED can
        // fire with a null session during refresh. Switching scope to undefined
        // here points the local DB at the empty default scope and makes the
        // user's writings momentarily vanish. Only SIGNED_OUT clears scope.
        if (!nextUserId) {
          return;
        }

        setLocalDBScope(nextUserId);
        void hydrateFromRemote();
        void syncService.scheduleFlush();
      });

      return authListener.subscription;
    };

    const bootstrapDesktop = async () => {
      const supabase = createDesktopClient();

      const sessionResult = await getAuthService().getSession();
      const userId = sessionResult.data?.user?.id ?? undefined;
      setLocalDBScope(userId);

      if (userId) {
        await hydrateFromRemote();
      }

      await syncService.start();
      await syncService.scheduleFlush();
      const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_OUT") {
          setLocalDBScope(undefined);
          return;
        }

        const nextUserId = session?.user?.id;
        // Ignore transient null sessions (see web path above): switching scope to
        // undefined on a transient refresh event makes the user's writings vanish.
        if (!nextUserId) {
          return;
        }

        setLocalDBScope(nextUserId);
        await hydrateFromRemote();
        void syncService.scheduleFlush();
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
      void syncService.stop();
    };
  }, []);

  return null;
}
