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
// The runner (`bombadil-kit run`) hands the page cookies these read:
//   fuzz_fence  the flow's allowed paths (`fenced`)
//   fuzz_root   the repo's absolute path (`appRenders`, for repo-relative files)
//   fuzz_app    the app's directory in the repo (`appRenders`, Vite URLs)
//   fuzz_seed     the run's seed        fuzz_faults  its fault rate
//   fuzz_ref_date the run's mock date
// The last three are how a run's seed, fault rate and mock date reach the page
// when server.env can't: a prebuilt static bundle reads only the URL and the
// cookies. `/?world={seed}` in a flow's start and these carry the same values
// `server.command` and `server.env` are given.
import { always, eventually } from '@antithesishq/bombadil';
import {
  actions,
  extract,
  getFingerprint,
  registerCustomAction,
  type Fingerprint,
  type State,
} from '@antithesishq/bombadil/browser';

// Import, then export the bindings: `export { … } from` beside an import of the
// same names makes Bombadil's bundle declare them twice ("Identifier
// 'faultInFlight' has already been declared").
import { contentLength, isVisible, visibleOutside } from './dom.ts';
import {
  consoleErrorExcused,
  faultInFlight,
  freshFailedWrite,
  unannouncedWrite,
  faultLine,
  requestPattern,
  isErrorFault,
  isWriteFault,
  spinnerDeadline,
  unexcusedConsoleErrors,
  type ConsoleExcuse,
  type WriteWatch,
  type FaultKind,
  type InjectedFault,
} from './faults.ts';
import { hasSettled, persist, spinnerStuck, spinnerTime, type Persisted, type PersistStore, type SpinnerStore } from './settled.ts';
import { freshApiCalls, type ApiSnapshot, type ApiWindow, type CallOutcome, type MockCall, type MockEndpoint } from './api.ts';
import { reachedMilestones, type MilestonePredicate } from './milestones.ts';

export {
  freshApiCalls,
  reachedMilestones,
  type MilestonePredicate,
  type ApiSnapshot,
  type CallOutcome,
  type MockCall,
  type MockEndpoint,
  consoleErrorExcused,
  faultInFlight,
  freshFailedWrite,
  hasSettled,
  unannouncedWrite,
  faultLine,
  requestPattern,
  isErrorFault,
  isWriteFault,
  spinnerDeadline,
  unexcusedConsoleErrors,
  type ConsoleExcuse,
  type WriteWatch,
  type FaultKind,
  type InjectedFault,
  type Persisted,
};

type FaultWindow = Window & {
  __mockFaults?: InjectedFault[];
  __mockPending?: number;
  __mockBusyMs?: number;
  __mockBusySince?: number;
  __fuzzWrites?: WriteWatch;
};
type PersistWindow = Window & { __fuzzPersisted?: PersistStore };
type ActionGenerator = ReturnType<typeof actions>;

/**
 * For use inside `extract`: how long `active` has held without a break on the
 * current history entry, in milliseconds and captured states. `key` names the
 * timer; give each condition its own. The timers live on the page's `window`,
 * so a reload resets them, and a change of history entry restarts them.
 *
 *   const stuck = extract((state) => persisted(state, 'stuck', isStuck(state.document)));
 *   export const notStuck = always(() => !hasSettled(stuck.current));
 */
export const persisted = (state: State, key: string, active: boolean): Persisted =>
  persist(((state.window as PersistWindow).__fuzzPersisted ??= {}), key, state.navigationHistory.current.id, active, Date.now());

/** The loading indicators spinnersClear and noBlankPage look for. */
const LOADING = '[role="status"][aria-busy="true"], [role="progressbar"]';

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

/** Which spinnersClear tally a page adds to. */
export type PageKey = (loc: Location) => string;
const byPath: PageKey = (loc) => loc.pathname;

/**
 * A visible loading indicator clears. A random walker leaves a page within a
 * fraction of a second, so a spinner that never clears is never seen for long
 * in one visit; it is seen on every visit. So, per path, the time a spinner
 * shows is added up across visits (sessionStorage, which outlives the walker's
 * reloads) until the path is seen without one, along with the part of it no
 * mock request was in flight (withFaults or startMockRequest keep that count).
 * Stuck: over `within` seconds with nothing in flight, and at least `share` of
 * all its spinner time. A spinner waiting on slow requests the walker keeps
 * abandoning isn't stuck however long the sweep; one with nothing to wait for
 * is. Without the in-flight count, all spinner time is idle and `within` alone
 * decides, so keep it large. Reads `window.__mockFaults`: a slow fault still in
 * flight adds its `delayMs` to the deadline, and once a hang was injected the
 * property holds (a hung request spins forever).
 * `exclude`: spinners inside an element matching it are meant to run long.
 * `key`: which tally a page adds to; the path by default. Pages that route on
 * the query string (`/?id=open`, `/?id=closed`) need it to keep theirs apart:
 * `key: (loc) => loc.pathname + loc.search`.
 *
 * "In flight" means any mock request, not only the one the spinner waits on:
 * while a long unrelated request runs (polling, a slow fault on another
 * endpoint), a stuck spinner counts as busy, and that time is missed.
 */
export const spinnersClear = ({
  selector = LOADING,
  within = 15,
  share = 0.1,
  exclude,
  key = byPath,
}: { selector?: string; within?: number; share?: number; exclude?: string; key?: PageKey } = {}) => {
  const stuck = extract((state) => {
    const win = state.window as FaultWindow & SpinnerWindow;
    const at = Date.now();
    const path = key(win.location);
    const deadline = spinnerDeadline(win.__mockFaults ?? [], at, within);
    const store = spinnerStore(win);
    watchLeaving(win);
    const left = win.__fuzzLeft ?? undefined;
    win.__fuzzLeft = null;
    const spinning = visibleOutside(state.document.querySelectorAll(selector), exclude);
    const tally = spinnerTime(store.value, path, spinning, at, busyMs(win, at), left, win.performance.timeOrigin, deadline === null);
    store.save();
    // A string, so the report names the path and tells stuck paths apart.
    return spinnerStuck(tally, deadline, share) ? `${path}: still loading, ${Math.round(tally.idle / 1000)}s of it with nothing in flight` : null;
  });
  return always(() => stuck.current === null);
};

/**
 * bombadil-kit/faults' mockBusyMs, read from the same window fields (the spec
 * bundle doesn't import app-side code). Undefined if the app doesn't count.
 * A page load restarts it: across a reload, the interval counts in full.
 */
const busyMs = (win: FaultWindow, at: number): number | undefined => {
  if (win.__mockPending === undefined) return undefined;
  const open = win.__mockPending > 0 ? at - (win.__mockBusySince ?? at) : 0;
  return (win.__mockBusyMs ?? 0) + open;
};

// v2: a tally per path is { idle, on }.
const SPINNER_KEY = 'bombadil-kit:spinners:v2';
type SpinnerWindow = FaultWindow & {
  __fuzzSpinners?: SpinnerStore;
  /** The first navigation since the last capture: when, and the busy clock then. */
  __fuzzLeft?: { at: number; busy?: number } | null;
  __fuzzWatchingLeaving?: boolean;
};

/**
 * Records when the walker leaves a page (pushState, replaceState, popstate),
 * with the busy clock at that moment: spinnersClear credits a spinner only up
 * to then. Installed once per page load.
 *
 * It replaces `history.pushState` and `replaceState` on the app's window with
 * wrappers that pass every call through. Debugging navigation in fuzz mode? A
 * router or analytics script that wraps them too wraps the kit's wrapper, and
 * the kit's frame shows in their stacks.
 */
const watchLeaving = (win: SpinnerWindow) => {
  if (win.__fuzzWatchingLeaving) return;
  win.__fuzzWatchingLeaving = true;
  const mark = () => {
    if (win.__fuzzLeft) return;
    const at = Date.now();
    const busy = busyMs(win, at);
    win.__fuzzLeft = busy === undefined ? { at } : { at, busy };
  };
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = win.history[name];
    win.history[name] = function (this: History, ...args: Parameters<History['pushState']>) {
      mark();
      return original.apply(this, args);
    };
  }
  win.addEventListener('popstate', mark);
};

/** spinnersClear's tally: in sessionStorage, which a reload keeps; on the window if storage throws. */
const spinnerStore = (win: SpinnerWindow) => {
  try {
    const value = JSON.parse(win.sessionStorage.getItem(SPINNER_KEY) ?? 'null') as SpinnerStore | null;
    const store = value ?? { paths: {} };
    return { value: store, save: () => win.sessionStorage.setItem(SPINNER_KEY, JSON.stringify(store)) };
  } catch {
    return { value: (win.__fuzzSpinners ??= { paths: {} }), save: () => {} };
  }
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

export interface FailedWritesOptions {
  /** Writes that fail silently on purpose, as `/^METHOD \/path$/`. */
  quiet?: RegExp[];
  /** What tells the user: default `[role="alert"]`. */
  errorSelector?: string;
  /** Seconds the alert has to show within. Default 5. */
  within?: number;
  /** The endpoint, for the finding's id. Default requestPattern: record segments of the path as `:id`. */
  request?: (method: string, path: string) => string;
}

/**
 * When the app's fault injector fails a write (`write: true`, or without it
 * anything but GET), the user is told on the page they're on when it fails:
 * something matching `errorSelector` shows up there with text in it, within
 * `within` seconds and before they leave. An alert on another page doesn't
 * count, and one that shows and is then cleared (a retry that succeeds, a
 * Dismiss) has done its job: one alert per failed write. Reads
 * `window.__mockFaults` (bombadil-kit/faults); slow and hung faults don't count.
 * `quiet`: writes that fail silently on purpose, as `/^METHOD \/path$/`.
 */
export const failedWritesShown = ({
  quiet = [] as RegExp[],
  errorSelector = '[role="alert"]',
  within = 5,
  request = requestPattern,
}: FailedWritesOptions = {}) => {
  const unannounced = extract((state) => {
    const win = state.window as FaultWindow;
    const alertShown = [...state.document.querySelectorAll(errorSelector)].some(
      (el) => isVisible(el) && (el.textContent ?? '').trim() !== '',
    );
    // On the window, like __mockFaults: a page load starts both over.
    const watch = (win.__fuzzWrites ??= { pending: [], seen: new WeakSet() });
    const fault = unannouncedWrite(watch, win.__mockFaults ?? [], Date.now(), quiet, state.navigationHistory.current.id, alertShown, within * 1000);
    // `request` first: the report names a finding, and builds its id, from
    // the first string, so one endpoint's failures are one finding whatever
    // the status or record. The full line is the evidence.
    return fault ? { request: request(fault.method, fault.path), fault: faultLine(fault) } : null;
  });
  return always(() => unannounced.current === null);
};

/**
 * Bombadil's noConsoleErrors, except for errors an injected fault explains.
 * The app logs the failures it handles, and failedWritesShown/spinnersClear
 * judge those. Anything else (a React warning, a failed render) still counts.
 *
 * By time (`grace`, or `{ grace, hangGrace }`): any error `grace` ms after an
 * injected error, `grace` ms after a slow response answers (`at + delayMs`),
 * `hangGrace` ms after a hang started (default `grace`; raise it to the app's
 * request timeout).
 *
 * By message (`{ injected }`): only an error whose text matches `injected`,
 * the marker the mock layer puts in what it injects; every other error fails,
 * whenever it lands. Bombadil records a logged object as `"Object"`, so the
 * marker inside one is only seen with bombadil-kit/console's
 * installFuzzConsole. With the built-in injector:
 *
 *   import { INJECTED_MARKER } from 'bombadil-kit/faults';
 *   export const quiet = consoleQuietUnlessFaulted({ injected: new RegExp(INJECTED_MARKER) });
 */
export const consoleQuietUnlessFaulted = (options: number | ConsoleExcuse = 5000, hangGrace?: number) => {
  const excuse: ConsoleExcuse =
    typeof options === 'number' ? { grace: options, ...(hangGrace === undefined ? {} : { hangGrace }) } : options;
  const unexcused = extract((state) =>
    unexcusedConsoleErrors(state.console, (state.window as FaultWindow).__mockFaults ?? [], Date.now(), excuse),
  );
  return always(() => unexcused.current.length === 0);
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

let blankPages = 0;

/**
 * What fills a page without much text: something to click (an empty state's
 * "Keep shopping"), a form, media, an error being shown.
 */
const FILLED = 'a[href], button, input:not([type=hidden]), select, textarea, img, video, canvas, [role="alert"]';

/**
 * The page is never (nearly) empty for long: fewer than `minChars` characters
 * of text outside `chrome`, and nothing outside it matching `filled` (a link,
 * a button, a form field, media, an alert) or `loading`, for at least
 * `minStates` captured states and `minMs` (see hasSettled). Catches the route
 * that renders only its header and footer after a failed request, which
 * appRenders, once past first paint, can't.
 *
 * `minMs` has to outlast the app's harmless blank moments (a lazy route
 * loading) but not the walker's stay: a blank page offers nothing to click
 * but the chrome, so the walker leaves it in well under a second. Find the
 * floor in a clean sweep's trace (the `blank` snapshot) and set it above.
 */
export const noBlankPage = ({
  chrome = 'header, footer, nav',
  minChars = 50,
  loading = LOADING,
  filled = FILLED,
  minStates = 3,
  minMs = 250,
}:{ chrome?: string; minChars?: number; loading?: string; filled?: string; minStates?: number; minMs?: number } = {}) => {
  const key = `noBlankPage#${blankPages++}`;
  const blank = extract((state) => {
    const doc = state.document;
    const { body } = doc;
    const empty =
      !body ||
      (contentLength(body, chrome) < minChars &&
        !visibleOutside(doc.querySelectorAll(loading)) &&
        !visibleOutside(doc.querySelectorAll(filled), chrome));
    return persisted(state, key, empty);
  });
  return always(() => !hasSettled(blank.current, { minStates, minMs }));
};

// ---------------------------------------------------------------- extractors

/**
 * Not a property: records, as the `api` snapshot, the mock API calls each
 * state saw, for the report's API coverage. Call it once at the top level of
 * the spec, and don't export it (Bombadil takes every export for a property
 * or an action, and refuses anything else):
 *
 *   apiCalls();
 *
 * Reads window.__mockCalls (bombadil-kit/faults' createFaultInjector fills
 * it; a mock layer of the app's own can too) and, once per document,
 * window.__mockEndpoints, the inventory.
 */
export const apiCalls = () => {
  const api = extract((state) => freshApiCalls(state.window as ApiWindow));
  // The report reads the snapshot by this name. The bundler names an
  // extractor after its variable; say it outright, in case it can't see this one.
  const named = api as typeof api & { named?: (name: string) => unknown };
  if (typeof named.named === 'function') named.named('api');
  return api;
};

/**
 * Not a property: records, as the `milestones` snapshot, the milestones each
 * state reached: the names whose predicate turned true (once while it stays
 * true; again after it went false and back; a new document starts over). The
 * report counts them per flow, against the `milestones` its flows.json entry
 * expects. Call it once at the top level of the spec, unexported, like
 * apiCalls:
 *
 *   milestones({
 *     saved: (doc) => !!doc.querySelector('[role="status"].success'),
 *   });
 *
 * A milestone is where the workflow got done, not where it went: a page
 * reached is route coverage; a save dispatched isn't a save that completed.
 */
export const milestones = (defs: Record<string, MilestonePredicate>) => {
  const reached = extract((state) => reachedMilestones(defs, state.document, state.window));
  // The report reads the snapshot by this name (see apiCalls).
  const named = reached as typeof reached & { named?: (name: string) => unknown };
  if (typeof named.named === 'function') named.named('milestones');
  return reached;
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
