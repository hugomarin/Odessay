type DebounceOptions = {
  leading?: boolean
  trailing?: boolean
}

/**
 * Debounce utility with leading and trailing support.
 *
 * - trailing (default): executes the function after `wait` ms of inactivity.
 * - leading: executes the function immediately on the first call in a window,
 *   then waits for the trailing edge only if additional calls arrived.
 *
 * Cancellation is supported via `.cancel()` on the returned function.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  wait: number,
  options: DebounceOptions = {},
): { (...args: Parameters<T>): void; cancel(): void } {
  const { leading = false, trailing = true } = options
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  let hasPendingTrailing = false

  const invoke = (args: Parameters<T>) => {
    hasPendingTrailing = false
    lastArgs = null
    fn(...args)
  }

  const debounced = (...args: Parameters<T>) => {
    const isFirstInWindow = timer === null
    lastArgs = args
    hasPendingTrailing = true

    if (timer) {
      clearTimeout(timer)
    }

    if (leading && isFirstInWindow) {
      invoke(args)
    }

    timer = setTimeout(() => {
      timer = null
      if (trailing && hasPendingTrailing && lastArgs) {
        invoke(lastArgs)
      }
      hasPendingTrailing = false
      lastArgs = null
    }, wait)
  }

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    hasPendingTrailing = false
    lastArgs = null
  }

  return debounced
}
