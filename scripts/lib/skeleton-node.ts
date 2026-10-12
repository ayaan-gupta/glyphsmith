import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseJhf } from '../../src/core/hershey'

/** The skeleton font for scripts that run under Node, where Vite's ?raw import does not exist. */
export const skeleton = parseJhf(readFileSync(path.join(process.cwd(), 'vendor/hershey/futural.jhf'), 'utf8'))
