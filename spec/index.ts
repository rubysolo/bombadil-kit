// bombadil-kit/spec: properties and actions for Bombadil specs.
//
// Bombadil bundles a spec with its imports and runs it against the page, so
// this file is imported as TypeScript straight from node_modules. Every
// property is a factory: call it at the top level of your spec and export the
// result under the name the report should show.
//
//   export const noErrorBoundary = errorBoundaryNeverShown('[data-testid="crash"]');
//   export const spinnersSettle = spinnersClear({ selector: '.spinner' });
//
// The runner (`bombadil-kit run`) hands the page three cookies these read:
//   fuzz_fence  the flow's allowed paths (`fenced`)
//   fuzz_root   the repo's absolute path (`appRenders`, for repo-relative files)
//   fuzz_app    the app's directory in the repo (`appRenders`, Vite URLs)
import { always, eventually, now } from '@antithesishq/bombadil';
import {
  actions,
  extract,
  getFingerprint,
  registerCustomAction,
  type Fingerprint,
} from '@antithesishq/bombadil/browser';

// Import, then export the bindings: `export { … } from` beside an import of the
// same names makes Bombadil's bundle declare them twice ("Identifier
// 'faultInFlight' has already been declared").
import { faultInFlight, freshFailedWrite, isErrorFault, isWriteFault, type FaultKind, type InjectedFault } from './faults.ts';

export { faultInFlight, freshFailedWrite, isErrorFault, isWriteFault, type FaultKind, type InjectedFault };

type FaultWindow = Window & { __mockFaults?: InjectedFault[] };
type ActionGenerator = ReturnType<typeof actions>;

const isVisible = (el: Element) => {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

const cookie = (doc: Document, name: string): string | null => {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(doc.cookie);
  return m ? decodeURIComponent(m[1]!) : null;
};

// The report lists a spec's properties from its source; when you add a
// property factory here, add its name to PROPERTY_FACTORIES in
// src/report/project.ts (test/project.test.ts checks they match).

// ---------------------------------------------------------------- properties

/** No render throws far enough to show the error boundary's fallback. */
export const errorBoundaryNeverShown = (selector = '[data-testid="error-boundary-fallback"]') => {
  const shown = extract((state) => state.document.querySelector(selector) !== null);
  return always(() => !shown.current);
};

/**
 * A visible loading indicator clears within `within` seconds. On a mock API
 * that answers in milliseconds, one that outlives that is waiting on a
 * request that failed and was never handled.
 */
export const spinnersClear = ({ selector = '[role="status"][aria-busy="true"], [role="progressbar"]', within = 15 } = {}) => {
  const spinning = extract((state) => [...state.document.querySelectorAll(selector)].some(isVisible));
  return always(now(() => spinning.current).implies(eventually(() => !spinning.current).within(within, 'seconds')));
};

/** Text that means a JS value reached the page unformatted. */
export const LEAKED = /\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date|\bnull\b/;

/** No `undefined`, `NaN`, `[object Object]`, `Invalid Date`, `null` in the visible text. */
export const noLeakedText = (pattern: RegExp = LEAKED) => {
  const leaked = extract((state) => {
    const text = state.document.body?.innerText ?? '';
    const match = pattern.exec(text);
    return match ? text.slice(Math.max(0, match.index - 40), match.index + 40) : null;
  });
  return always(() => leaked.current === null);
};

/** The page never scrolls sideways (more than `tolerance` px). */
export const noSidewaysScroll = (tolerance = 1) => {
  const overflow = extract((state) => {
    const root = state.document.documentElement;
    return root ? root.scrollWidth - state.window.innerWidth : 0;
  });
  return always(() => overflow.current <= tolerance);
};

/**
 * When the app's fault injector fails a write (`write: true`, or without it
 * anything but GET), the user is told within `within` seconds: something
 * matching `errorSelector` shows up with text in it. Reads `window.__mockFaults`
 * (bombadil-kit/faults); slow and hung faults don't count.
 * `quiet`: writes that fail silently on purpose, as `/^METHOD \/path$/`.
 */
export const failedWritesShown = ({
  quiet = [] as RegExp[],
  errorSelector = '[role="alert"]',
  within = 5,
} = {}) => {
  const failedWrite = extract((state) => {
    const fault = freshFailedWrite((state.window as FaultWindow).__mockFaults ?? [], Date.now(), quiet);
    return fault ? `${fault.method} ${fault.path} → ${String(fault.status)}` : null;
  });
  const errorShown = extract((state) =>
    [...state.document.querySelectorAll(errorSelector)].some((el) => isVisible(el) && (el.textContent ?? '').trim() !== ''),
  );
  return always(now(() => failedWrite.current !== null).implies(eventually(() => errorShown.current).within(within, 'seconds')));
};

/**
 * Bombadil's noConsoleErrors, except while an injected fault may still be
 * making the app log: `grace` ms after an error, `grace` ms after a slow
 * response answers (`at + delayMs`), and from a hang on. The app logs the
 * failures it handles, and failedWritesShown/spinnersClear judge those.
 * Anything else (a React warning, a failed render) still counts.
 */
export const consoleQuietUnlessFaulted = (grace = 5000) => {
  const faulted = extract((state) => faultInFlight((state.window as FaultWindow).__mockFaults ?? [], Date.now(), grace));
  const errors = extract((state) => state.console.filter((e) => e.level === 'error').map((e) => e.args));
  return always(() => errors.current.length === 0 || faulted.current);
};

/**
 * No text outside `container` is drawn over the element `selector` matches
 * (a floating header's logo, a sticky button). Reports the first offender.
 */
export const nothingUnder = ({ selector = 'header img', container = 'header' } = {}) => {
  const over = extract((state) => {
    const target = state.document.querySelector(selector);
    if (!target) return null;
    const box = target.getBoundingClientRect();
    if (box.width === 0) return null;
    const walker = state.document.createTreeWalker(state.document.body, NodeFilter.SHOW_TEXT);
    const range = state.document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text || node.parentElement?.closest(container)) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        const w = Math.min(r.right, box.right) - Math.max(r.left, box.left);
        const h = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
        if (w > 2 && h > 2) return text.slice(0, 60);
      }
    }
    return null;
  });
  return always(() => over.current === null);
};

// React keeps, on each fiber, where the JSX that created it was written:
// `_debugSource.fileName` up to React 18, `_debugStack` (an Error) from 19.
type Fiber = {
  child: Fiber | null;
  sibling: Fiber | null;
  _debugSource?: { fileName?: string };
  _debugStack?: { stack?: string };
};
type RenderWindow = Window & { __fuzzRendered?: Set<string> };

/**
 * The app renders something within `within` seconds of any state: no blank
 * page. It also records, as the `rendered` snapshot, which source files are on
 * screen (a dev build of React only); the report unions them per flow into
 * coverage.json, which `bombadil-kit affected` maps a diff onto.
 *
 * Paths are made repo-relative with the fuzz_root/fuzz_app cookies. React 19's
 * `_debugStack` path is read from Vite's dev URLs (`/src/…`, `/@fs/…`).
 */
export const appRenders = ({ root = '#root', within = 10 } = {}) => {
  const rendered = extract((state) => {
    const doc = state.document;
    const win = state.window as RenderWindow;
    const seen = (win.__fuzzRendered ??= new Set());
    const repo = (cookie(doc, 'fuzz_root') ?? '').replace(/\/?$/, '/');
    const app = (cookie(doc, 'fuzz_app') ?? '').replace(/\/?$/, '/');
    const relative = (file: string) => (repo !== '/' && file.startsWith(repo) ? file.slice(repo.length) : file);
    const fromStack = (stack: string) => {
      for (const m of stack.matchAll(/https?:\/\/[^/\s]+(\/[^\s?:)]+)/g)) {
        const path = m[1]!;
        if (path.includes('/node_modules/')) continue;
        return path.startsWith('/@fs/') ? relative(path.slice(4)) : `${app === '/' ? '' : app}${path.slice(1)}`;
      }
      return undefined;
    };
    const fresh: string[] = [];
    const el = doc.querySelector(root);
    const key = el && Object.keys(el).find((k) => k.startsWith('__reactContainer$'));
    const stack = key ? [(el as unknown as Record<string, Fiber>)[key]] : [];
    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber) continue;
      const source = fiber._debugSource?.fileName;
      const file = source ? relative(source) : fiber._debugStack?.stack ? fromStack(fiber._debugStack.stack) : undefined;
      if (file && !file.includes('node_modules') && !seen.has(file)) {
        seen.add(file);
        fresh.push(file);
      }
      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return { fresh, total: seen.size };
  });
  return always(eventually(() => rendered.current.total > 0).within(within, 'seconds'));
};

// ------------------------------------------------------------------- actions

// Random Unicode almost never passes validation, so on its own the fuzzer
// doesn't get past a sign-in form. This fills every visible, empty field with
// a plausible value; `variant` picks among fixed sets, so a trace replays.
// All of it is made up: example.com, 555 numbers, card numbers every test
// gateway accepts.
const PEOPLE = [
  ['Maria', 'Lopez', 'maria.lopez', '3035550142', 'Riverside Club', '80302', 'Springfield', '742 Example St'],
  ['James', "O'Neil", 'j.oneil', '7205550199', 'Équipe Nord', '60601', 'Shelbyville', '12 Sample Ave'],
  ['Ana-Sofía', 'Núñez', 'ana.nunez', '3035550100', 'Los Rápidos', '73301', 'Ogdenville', '1 Placeholder Rd'],
  ['Lee', 'Wu', 'lee', '3035550111', 'W', '10001', 'X', '9 Q St'],
] as const;

export const fillPlausible = registerCustomAction('fillPlausible', async (document, _window, variant: number) => {
  const [first, last, local, phone, org, zip, city, street] = PEOPLE[variant % PEOPLE.length]!;

  // React tracks an input's value through the prototype setter; assigning
  // el.value directly is invisible to onChange and to form libraries.
  const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const guess = (el: HTMLInputElement | HTMLTextAreaElement): string | undefined => {
    const hint =
      `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('autocomplete') ?? ''}`.toLowerCase();
    if (hint.includes('cc-number')) return variant % 4 === 3 ? '3782 822463 10005' : '4111 1111 1111 1111';
    if (hint.includes('cc-csc')) return variant % 4 === 3 ? '1234' : '123';
    if (el.placeholder === 'MM' || hint.includes('cc-exp-month')) return String(1 + (variant % 12)).padStart(2, '0');
    if (el.placeholder === 'YYYY' || hint.includes('cc-exp-year')) return '2030';
    if (el.type === 'email' || hint.includes('email')) return `${local}+bombadil@example.com`;
    if (el.type === 'password' || hint.includes('password')) return 'password123';
    if (el.type === 'tel' || hint.includes('phone')) return phone;
    if (el.type === 'number') return String(1 + (variant % 12));
    if (el.type === 'date') return `2030-0${1 + (variant % 9)}-1${variant % 9}`;
    if (hint.includes('first') || hint.includes('given')) return first;
    if (hint.includes('last') || hint.includes('family')) return last;
    if (hint.includes('team') || hint.includes('club') || hint.includes('organization') || hint.includes('company')) return org;
    if (hint.includes('zip') || hint.includes('postal')) return zip;
    if (hint.includes('city') || hint.includes('address-level2')) return city;
    if (hint.includes('address')) return street;
    if (hint.includes('name')) return `${first} ${last}`;
    if (el instanceof HTMLTextAreaElement) return 'Bombadil was here.';
    if (el.type === 'text' || el.type === 'search') return org;
    return undefined;
  };

  for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if (!isVisible(el) || el.disabled || el.readOnly || el.value !== '') continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) continue;
    const value = guess(el);
    if (value !== undefined) setValue(el, value);
  }
});

/** Bombadil can't drive a native <select> popup, so this sets one directly. */
export const pickOption = registerCustomAction('pickOption', async (document, _window, nth: number, choice: number) => {
  const selects = [...document.querySelectorAll<HTMLSelectElement>('select:not(:disabled)')].filter(isVisible);
  const el = selects[nth % Math.max(selects.length, 1)];
  if (!el || el.options.length === 0) return;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, el.options[choice % el.options.length]!.value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
});

const hasEmptyField = extract((state) =>
  [...state.document.querySelectorAll('input, textarea')].some(
    (el) =>
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      !el.disabled &&
      !['hidden', 'checkbox', 'radio', 'file'].includes(el.type) &&
      el.value === '' &&
      isVisible(el),
  ),
);
const hasSelect = extract((state) => state.document.querySelector('select:not(:disabled)') !== null);

/** fillPlausible while a field is empty; pickOption while there's a <select>. */
export const formActions = actions(() => [
  ...(hasEmptyField.current ? [0, 1, 2, 3].map((v) => fillPlausible(v)) : []),
  ...(hasSelect.current ? [0, 1].flatMap((n) => [1, 2, 5].map((c) => pickOption(n, c))) : []),
]);

const CLICKABLE = [
  'a[href]:not([target=_blank])',
  'button:not(:disabled)',
  'input:not(:disabled):not([type=hidden]):not([type=file])',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
  'label[for]',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option'].map((r) => `[role=${r}]`),
].join(',');

type Target = { fingerprint: Fingerprint; point: { x: number; y: number } };

// Elements matching `selector` whose centre is on screen and not covered.
const targets = (state: { document: Document; window: Window }, selector: string, keep: (el: Element) => boolean): Target[] => {
  const { document: doc, window: win } = state;
  const out: Target[] = [];
  for (const el of doc.querySelectorAll(selector)) {
    if (!keep(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const point = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    if (point.x < 0 || point.y < 0 || point.x > win.innerWidth || point.y > win.innerHeight) continue;
    const hit = doc.elementFromPoint(point.x, point.y);
    if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue;
    out.push({ fingerprint: getFingerprint(el), point });
  }
  return out;
};

/**
 * Bombadil's `clicks`, minus anything inside `exclude`. Use it to keep a
 * signed-in flow away from the header's Sign out: two clicks from anywhere,
 * and the flow lands outside its fence with nothing left to do.
 */
export const pageClicks = ({ exclude = 'header' } = {}) => {
  const found = extract((state) => targets(state, CLICKABLE, (el) => !exclude || !el.closest(exclude)));
  return actions(() => found.current.map(({ fingerprint, point }) => ({ Click: { fingerprint, point } })));
};

/** Labels of buttons and links that move a workflow forward. */
export const FORWARD =
  /^(next|continue|save|submit|confirm|review|approve|finali[sz]e|place|pay|proceed|done|send|upload|request|start|create|sign in|log in|add to|checkout)\b/i;

/**
 * Clicks on forward buttons only. Bombadil's clicks pick any target with equal
 * chance, so a page's Next competes with every footer link; a flow five steps
 * deep then needs five lucky draws in a row. Weight this to get through.
 */
export const forwardClicks = ({ label = FORWARD, exclude = 'header' } = {}) => {
  const found = extract((state) =>
    targets(state, 'button:not(:disabled), a[href], [role="button"]', (el) => {
      const text = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim();
      return label.test(text) && (!exclude || !el.closest(exclude));
    }),
  );
  return actions(() => found.current.map(({ fingerprint, point }) => ({ Click: { fingerprint, point } })));
};

// The flow's fence (flows.json `allow`), which the runner hands the page in
// the fuzz_fence cookie: path patterns, a trailing * a prefix. Bombadil's
// --allow-url only polices full page loads; a client-side router changes the
// URL without one, so without this a flow wanders off and spends its time
// elsewhere.
const outsideFence = extract((state) => {
  const fence = cookie(state.document, 'fuzz_fence');
  if (!fence) return false;
  const path = state.document.location.pathname;
  return !fence.split(',').some((p) => (p.endsWith('*') ? path.startsWith(p.slice(0, -1)) : path === p));
});

/** `generator`'s actions, or only Back while the page is outside the flow's fence. */
export const fenced = (generator: ActionGenerator) => actions(() => (outsideFence.current ? ['Back'] : generator.generate()));
