/*
 * City photos come from Wikimedia as large JPEGs. In production they go through
 * Vercel's image optimizer (same origin, edge-cached, WebP, resized to the slot),
 * which turns a ~200 KB tile into ~20 KB. Widths must match `images.sizes` in
 * vercel.json. Elsewhere (dev, self-hosted) we fall back to Wikimedia's own
 * standard thumbnail widths.
 */

export const OPTIMIZER = import.meta.env.VITE_IMAGE_OPTIMIZER === '1';
export const OPT_WIDTHS = [96, 256, 384, 640, 828, 1200, 1920] as const;
const QUALITY = 70;

const WIKI_WIDTHS = [500, 960, 1280];
const isWikimedia = (src: string) => /wikimedia\.org\/.+\/\d+px-/.test(src);
const wikiSize = (src: string, w: number) => src.replace(/\/\d+px-([^/?]+)/, `/${w}px-$1`);

export const optimized = (src: string, w: number) => `/_vercel/image?url=${encodeURIComponent(src)}&w=${w}&q=${QUALITY}`;

/** src + srcSet for an image displayed at most `maxCss` CSS pixels wide. */
export function imageSources(src: string, maxCss: number): { src: string; srcSet?: string } {
  if (OPTIMIZER) {
    // 1x and 2x of the slot are all the browser ever needs.
    const ws = OPT_WIDTHS.filter((w) => w <= maxCss * 2);
    const top = OPT_WIDTHS.find((w) => w >= maxCss * 2) ?? OPT_WIDTHS[OPT_WIDTHS.length - 1];
    const set = [...new Set([...ws.filter((w) => w >= maxCss / 2), top])];
    return { src: optimized(src, set[0]), srcSet: set.map((w) => `${optimized(src, w)} ${w}w`).join(', ') };
  }
  if (!isWikimedia(src)) return { src };
  const top = WIKI_WIDTHS.find((w) => w >= maxCss * 2) ?? WIKI_WIDTHS[WIKI_WIDTHS.length - 1];
  const ws = WIKI_WIDTHS.filter((w) => w <= top);
  return { src: wikiSize(src, ws[0]), srcSet: ws.map((w) => `${wikiSize(src, w)} ${w}w`).join(', ') };
}

/** Warm the cache for an image the user is about to see (e.g. a hovered card's hero). */
export function preloadImage(src: string | null, maxCss: number, sizes: string) {
  if (!src) return;
  const s = imageSources(src, maxCss);
  const img = new Image();
  img.sizes = sizes;
  if (s.srcSet) img.srcset = s.srcSet;
  img.src = s.src;
}
