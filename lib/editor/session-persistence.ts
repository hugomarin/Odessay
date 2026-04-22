"use client"

import { localDB } from "@/lib/local-db";
import { createEmptyEditorSession, EDITOR_SESSION_RECORD_ID } from "@/lib/local-db/editor-sessions";
import type { LocalEditorSession } from "@/lib/local-db/schema";

export const EDITOR_SESSION_EVENT_NAME = "odessay:editor-session-change";

const canUseWindowEvents = () =>
  typeof window !== "undefined" &&
  typeof window.addEventListener === "function" &&
  typeof window.dispatchEvent === "function" &&
  typeof window.CustomEvent === "function";

export const readEditorSession = async (): Promise<LocalEditorSession> =>
  (await localDB.editorSessions.get(EDITOR_SESSION_RECORD_ID)) ?? createEmptyEditorSession();

export const writeEditorSession = async (session: LocalEditorSession) => {
  await localDB.editorSessions.save({
    ...session,
    id: EDITOR_SESSION_RECORD_ID,
    updated_at: Date.now(),
  });
};

export const emitEditorSessionChange = () => {
  if (!canUseWindowEvents()) {
    return;
  }

  window.dispatchEvent(
    new window.CustomEvent(EDITOR_SESSION_EVENT_NAME, {
      detail: { updatedAt: Date.now() },
    }),
  );
};

export const subscribeToEditorSessionChanges = (listener: () => void) => {
  if (!canUseWindowEvents()) {
    return () => {};
  }

  const handler = () => {
    listener();
  };

  window.addEventListener(EDITOR_SESSION_EVENT_NAME, handler);
  return () => {
    window.removeEventListener(EDITOR_SESSION_EVENT_NAME, handler);
  };
};
