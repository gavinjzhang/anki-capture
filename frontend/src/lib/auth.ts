export type TokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<string | null> | string | null

let provider: TokenProvider | null = null

export function setAuthTokenProvider(fn: TokenProvider) {
  provider = fn
}

export async function getAuthToken(opts?: { forceRefresh?: boolean }): Promise<string | null> {
  if (!provider) return null
  try {
    const v = provider(opts)
    return v instanceof Promise ? await v : v
  } catch {
    return null
  }
}
