/**
 * Render the Windows taskbar overlay dot into `resources/badge-windows.png`.
 *
 * Windows has no numeric badge for a taskbar button, so unread activity is a
 * 16 × 16 overlay image instead. The committed PNG is the output; rerun
 * `pnpm run render:badge-icon` in `apps/desktop` after changing the colour.
 */

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Overlay edge in logical pixels; Windows scales the image with the display. */
export const BADGE_EDGE = 16

/** Brand red used for the dot. */
export const BADGE_COLOR = '#E5484D'

const dot = `<svg xmlns="http://www.w3.org/2000/svg" width="${BADGE_EDGE}" height="${BADGE_EDGE}" viewBox="0 0 ${BADGE_EDGE} ${BADGE_EDGE}">
  <circle cx="8" cy="8" r="7" fill="${BADGE_COLOR}" stroke="#FFFFFF" stroke-width="1.5"/>
</svg>`

const output = fileURLToPath(new URL('../resources/badge-windows.png', import.meta.url))
await writeFile(output, await sharp(Buffer.from(dot)).png().toBuffer())
console.log(`badge icon: ${output}`)
