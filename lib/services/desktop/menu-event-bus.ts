import { listen } from "@tauri-apps/api/event"

export type MenuActionHandler = () => void | Promise<void>

const handlerStacks = new Map<string, MenuActionHandler[]>()
const channelRegistrations = new Map<string, Promise<boolean>>()

function dispatch(action: string): void {
  const stack = handlerStacks.get(action)
  const handler = stack?.[stack.length - 1]
  if (!handler) return

  try {
    const result = handler()
    if (result && typeof result.then === "function") {
      result.catch((err) => {
        console.error(`Menu event bus: async handler for ${action} rejected`, err)
      })
    }
  } catch (err) {
    console.error(`Menu event bus: handler for ${action} threw`, err)
  }
}

async function registerChannel(action: string): Promise<boolean> {
  try {
    await listen(`menu:${action}`, () => dispatch(action))
    return true
  } catch (err) {
    console.error(
      `Menu event bus: failed to register Tauri listener for menu:${action}`,
      err,
    )
    return false
  }
}

async function ensureChannel(action: string): Promise<boolean> {
  const existing = channelRegistrations.get(action)
  if (existing) {
    const result = await existing
    if (result) return true
    channelRegistrations.delete(action)
  }

  const registration = registerChannel(action)
  channelRegistrations.set(action, registration)
  const result = await registration
  if (!result) channelRegistrations.delete(action)
  return result
}

/**
 * Subscribe a handler to a Tauri menu action.
 *
 * The underlying Tauri `listen` channel is registered only once per process.
 * Multiple subscribers for the same action form a stack: the most recent
 * subscriber receives events, and the previous subscriber is restored when the
 * current one unsubscribes. This prevents two mounted surfaces (e.g. editor +
 * modal) from running the same menu command twice.
 */
export function subscribeMenuAction(
  action: string,
  handler: MenuActionHandler,
): () => void {
  void ensureChannel(action)

  const stack = handlerStacks.get(action) ?? []
  stack.push(handler)
  handlerStacks.set(action, stack)

  return () => {
    const current = handlerStacks.get(action) ?? []
    const index = current.lastIndexOf(handler)
    if (index >= 0) {
      current.splice(index, 1)
      handlerStacks.set(action, current)
    }
  }
}
