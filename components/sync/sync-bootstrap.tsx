"use client";

import { useEffect, useRef } from "react";
import { setLocalDBScope } from "@/lib/local-db";
import { createDesktopClient } from "@/lib/supabase/desktop-client";
import { createClient } from "@/lib/supabase/client";
import { isTauriRuntime } from "@/lib/runtime/detect";
import { getAuthService } from "@/lib/services/auth-service-factory";
import { getSyncService } from "@/lib/sync/sync-service-factory";

const DESKTOP_REMOTE_HYDRATION_DELAY_MS = 250;

export function SyncBootstrap() {
  const lastHydratedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let deferredDesktopHydration: ReturnType<typeof setTimeout> | null = null;
    const desktop = isTauriRuntime();
    const syncService = getSyncService();

    const hydrateFromRemote = async (userId: string) => {
      try {
        await syncService.hydrateWritings();
        await syncService.hydrateCollections();
        if (desktop) {
          // ODE-473: local/cloud vocabulary merge on sign-in. Best-effort —
          // a failure here never blocks writings hydration or leaves the
          // local vocabulary in a worse state; it just retries next session.
          const { reconcileVocabularyOnSignIn } = await import(
            "@/lib/services/desktop/vocabulary-reconciler"
          );
          const outcome = await reconcileVocabularyOnSignIn(userId);
          if (outcome.status === "pending") {
            console.warn("[sync:bootstrap] vocabulary reconciliation pending", outcome.reason);
          }
        }
        lastHydratedUserIdRef.current = userId;
        return true;
      } catch (error) {
        console.error("[sync:bootstrap]", error);
        return false;
      }
    };

    const scheduleDesktopHydration = (userId: string) => {
      if (deferredDesktopHydration) {
        clearTimeout(deferredDesktopHydration);
      }
      deferredDesktopHydration = setTimeout(() => {
        deferredDesktopHydration = null;
        if (isMounted && lastHydratedUserIdRef.current === userId) {
          void hydrateFromRemote(userId);
        }
      }, DESKTOP_REMOTE_HYDRATION_DELAY_MS);
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
        await hydrateFromRemote(userId);
      }

      await syncService.start();
      await syncService.scheduleFlush();

      const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          setLocalDBScope(undefined);
          lastHydratedUserIdRef.current = null;
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

        // Re-hydrate only when the authenticated user actually changed. Without
        // this guard, INITIAL_SESSION / SIGNED_IN events for the same user
        // trigger a second full hydration after bootstrap has already hydrated.
        if (nextUserId === lastHydratedUserIdRef.current) {
          return;
        }

        setLocalDBScope(nextUserId);
        lastHydratedUserIdRef.current = nextUserId;
        void hydrateFromRemote(nextUserId);
        void syncService.scheduleFlush();
      });

      return authListener.subscription;
    };

    const bootstrapDesktop = async () => {
      const supabase = createDesktopClient();

      // The desktop shell already performs the authoritative network validation
      // through AuthService.getSession(). Bootstrap only needs the locally
      // persisted session to start the SQLite-backed sync adapter; calling
      // getUser() here creates a second identical startup request.
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id ?? undefined;

      await syncService.start();
      await syncService.scheduleFlush();
      if (userId) {
        // Let Desk's first local catalog/collection read complete before the
        // cloud snapshot opens a SQLite write transaction. Cloud hydration is
        // still automatic, just no longer on the critical render path.
        lastHydratedUserIdRef.current = userId;
        scheduleDesktopHydration(userId);
      }
      const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          if (deferredDesktopHydration) {
            clearTimeout(deferredDesktopHydration);
            deferredDesktopHydration = null;
          }
          lastHydratedUserIdRef.current = null;
          return;
        }

        const nextUserId = session?.user?.id;
        // Ignore transient null sessions (see web path above): switching scope to
        // undefined on a transient refresh event makes the user's writings vanish.
        if (!nextUserId) {
          return;
        }

        if (nextUserId === lastHydratedUserIdRef.current) {
          return;
        }

        if (deferredDesktopHydration) {
          clearTimeout(deferredDesktopHydration);
          deferredDesktopHydration = null;
        }
        lastHydratedUserIdRef.current = nextUserId;
        void hydrateFromRemote(nextUserId);
        void syncService.scheduleFlush();
      });
      return () => authListener.subscription.unsubscribe();
    };

    const subscriptionPromise = desktop ? bootstrapDesktop() : bootstrapWeb();

    return () => {
      isMounted = false;
      if (deferredDesktopHydration) {
        clearTimeout(deferredDesktopHydration);
      }
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
