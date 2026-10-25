/**
 * Desktop completion attention, node half. Pure browser plugin: the empty
 * apply exists so the plugin appears in the Host cordis.yml / Loader, while
 * the browser half ships through exports["./client"] and the row's
 * `dsh.client` declaration. The Electron shell owns the native surface.
 */

/** Host plugin body — no host-side behavior for this browser-only surface. */
export function apply(): void {}
