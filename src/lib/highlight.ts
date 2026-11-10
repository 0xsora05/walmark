type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

/**
 * Paints ranges with the CSS Custom Highlight API (::highlight(name) in globals.css).
 * Returns false where the API is missing; the app still works, saved words just aren't painted.
 */
export function setHighlight(name: string, ranges: Range[]): boolean {
  if (typeof window === 'undefined') return false;
  const registry = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Ctor = (window as unknown as { Highlight?: HighlightCtor }).Highlight;
  if (!registry || !Ctor) return false;
  if (!ranges.length) registry.delete(name);
  else registry.set(name, new Ctor(...ranges));
  return true;
}
