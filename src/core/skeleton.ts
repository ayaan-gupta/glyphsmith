import jhf from '../../vendor/hershey/futural.jhf?raw'
import type { SkeletonGlyph } from './hershey'
import { parseJhf } from './hershey'

let cached: Map<string, SkeletonGlyph> | null = null

/** Hershey Roman Simplex, parsed once. See vendor/hershey for its licence. */
export function getSkeleton(): Map<string, SkeletonGlyph> {
  cached ??= parseJhf(jhf)
  return cached
}
