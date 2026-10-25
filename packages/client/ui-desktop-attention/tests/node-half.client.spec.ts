/**
 * Node half contributes no host behavior; the browser half is a separate
 * entry. The empty apply exists so the package can appear as a Loader row.
 */
import { expect, it } from 'vitest'
import { apply } from '../src/index.ts'

it('registers no host-side behavior', () => {
  expect(() => { apply() }).not.toThrow()
})
