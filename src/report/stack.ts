/**
 * Reading a violation's stack trace: which of its frames is the project's own
 * code. Only a frame's script and function name are trusted. Bombadil rewrites
 * every script it instruments, so a frame's line and column are positions in
 * Bombadil's rewrite, not in what the server sent, and no source map the
 * server has resolves them.
 */

/** One V8 stack frame: `at fn (url:line:col)` or `at url:line:col`. */
export interface Frame {
  fn: string | undefined;
  url: string;
}

const FRAME = /^\s*at (?:(.*?) )?\(?((?:https?|file):\/\/[^\s()]+?):\d+:\d+\)?\s*$/;

export const parseFrames = (text: string): Frame[] =>
  text.split('\n').flatMap((l) => {
    const m = FRAME.exec(l);
    return m ? [{ fn: m[1] || undefined, url: m[2]! }] : [];
  });

/** Frames that are never the app's: libraries, the dev server's own modules, the kit. */
const VENDOR = /(^|\/)node_modules\/|(^|\/)\.vite\/|^@|bombadil-kit[/_]/;
// A dev server sends source files under their own names (Vite's /src/App.tsx);
// a bundle (/assets/index-abc.js) names no source file.
const SOURCE_FILE = /\.(?:[cm]?tsx?|jsx|vue|svelte)$/;

const pathOf = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
  } catch {
    return url;
  }
};

/**
 * The first frame in the project's own code: its source file, from the
 * server's root, and the function it was in. Undefined when the stack runs
 * through libraries only (an error thrown in RTK's middleware), or there is no
 * stack, or the app is a bundle.
 */
export const appFrame = (text: string): { file: string; fn?: string } | undefined => {
  for (const f of parseFrames(text)) {
    const file = pathOf(f.url);
    if (!VENDOR.test(file) && SOURCE_FILE.test(file)) return f.fn ? { file, fn: f.fn } : { file };
  }
  return undefined;
};

/** How the report shows a frame: `src/pages/Product.tsx (Product)`. */
export const frameLabel = (frame: { file: string; fn?: string }): string => (frame.fn ? `${frame.file} (${frame.fn})` : frame.file);
