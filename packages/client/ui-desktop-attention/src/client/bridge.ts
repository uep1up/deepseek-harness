/** Detect the Electron shell's completion-attention bridge in the application document. */
import type { AttentionBridge } from './attention.ts'

/** Shape carried on `globalThis.dshDesktop` by the Desktop preload. */
export interface DesktopCarrier {
  readonly protocolVersion?: unknown
  readonly attention?: unknown
}

function isBridge(value: unknown): value is AttentionBridge {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.notify === 'function'
    && typeof candidate.setBadge === 'function'
    && typeof candidate.read === 'function'
    && typeof candidate.update === 'function'
    && typeof candidate.onActivate === 'function'
}

/**
 * Resolve the Desktop attention bridge.
 * @param value - `globalThis.dshDesktop` in production; explicit input in tests.
 * @returns the bridge, or undefined in a browser or an incompatible shell.
 */
export function desktopAttentionBridge(value: unknown): AttentionBridge | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const carrier = value as DesktopCarrier
  if (carrier.protocolVersion !== 1) return undefined
  return isBridge(carrier.attention) ? carrier.attention : undefined
}

/**
 * Read the carrier the preload exposes to the application document.
 * @returns the bridge, or undefined outside the Desktop application document.
 */
export function currentDesktopAttention(): AttentionBridge | undefined {
  return desktopAttentionBridge((globalThis as typeof globalThis & { dshDesktop?: DesktopCarrier }).dshDesktop)
}
