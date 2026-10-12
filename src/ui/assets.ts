/**
 * Delivered artwork, if any has arrived. Anything in assets/generated wins
 * over the code-drawn version of the same name; until then the map is empty
 * and every piece of art on the page is drawn by the code in art.tsx.
 */
const delivered = import.meta.glob('/assets/generated/*.{png,jpg,jpeg,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export function generatedAsset(name: string): string | undefined {
  const hit = Object.keys(delivered).find((path) => path.replace(/^.*\//, '').replace(/\.[a-z]+$/, '') === name)
  return hit ? delivered[hit] : undefined
}
