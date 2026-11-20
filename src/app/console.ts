/**
 * bombadil-kit/console: in fuzz mode, make every console.error one
 * self-contained string that says where it came from.
 *
 *   import { installFuzzConsole } from 'bombadil-kit/console';
 *   if (import.meta.env.VITE_FUZZ === 'true') installFuzzConsole();
 *
 * Bombadil records only a console call's first argument, so React's warnings
 * reach the report without the component stack React passes after it, and a
 * "Maximum update depth exceeded" says nothing about which component looped.
 * The warning is printed inside the setState call, though, so the JS stack at
 * that moment runs through the effect that called it: its file and line are
 * what this appends.
 */
const PLACEHOLDER = /%[sdifoOc%]/g;

const show = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** console's own formatting: printf placeholders first, the rest appended. */
export const formatConsoleArgs = (args: unknown[]): string => {
  if (args.length === 0) return '';
  const [first, ...rest] = args;
  if (typeof first !== 'string') return args.map(show).join(' ');

  const queue = [...rest];
  const head = first.replace(PLACEHOLDER, (token) => {
    if (token === '%%') return '%';
    if (token === '%c') {
      queue.shift(); // CSS, not content
      return '';
    }
    return queue.length ? show(queue.shift()) : token;
  });
  return [head, ...queue.map(show)].join(' ');
};

// React's own frames (react-dom, the scheduler) are the same for every
// warning, so they never say anything. Vite's shared chunks stay: libraries
// like react-redux live in them.
const REACT = /react-dom|scheduler/;
// This module's own frames, from node_modules or Vite's pre-bundle.
const SELF = /bombadil-kit[/_]/;

/**
 * The frames that say where a console.error came from: the app's own source
 * if any; else, for an update a library scheduled from its own effect, the
 * library's frames minus React's. Never this file.
 */
export const appFrames = (stack: string | undefined): string[] => {
  const frames = (stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at ') && !SELF.test(line));
  const own = frames.filter((line) => line.includes('/src/') && !line.includes('node_modules'));
  if (own.length) return own.slice(0, 8);
  return frames.filter((line) => line.includes('node_modules') && !REACT.test(line)).slice(0, 8);
};

/**
 * The current JS stack, 100 frames deep. V8 keeps 10 by default, fewer than
 * React's own path from setState to its warning: with 10, the effect that set
 * state never shows.
 */
// V8's, not the DOM's: the browser types don't declare it.
const V8Error = Error as ErrorConstructor & { stackTraceLimit: number };

export const deepStack = (): string | undefined => {
  const limit = V8Error.stackTraceLimit;
  V8Error.stackTraceLimit = 100;
  try {
    return new Error().stack;
  } finally {
    V8Error.stackTraceLimit = limit;
  }
};

/** Wraps console.error; returns a function that puts the original back. */
export const installFuzzConsole = (): (() => void) => {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    const frames = appFrames(deepStack());
    original.call(console, [formatConsoleArgs(args), ...frames].join('\n    '));
  };
  return () => {
    console.error = original;
  };
};
