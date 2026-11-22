// Every bombadil-kit property, with this app's selectors. ../plants.json says
// which planted bug each one has to catch.
import {
  apiCalls,
  appRenders as renders,
  consoleQuietUnlessFaulted,
  errorBoundaryNeverShown,
  failedWritesShown,
  milestones,
  noBlankPage,
  noLeakedText,
  noSidewaysScroll,
  nothingUnder,
  spinnersClear,
} from 'bombadil-kit/spec';
import { INJECTED_MARKER } from 'bombadil-kit/faults';

export const noErrorBoundary = errorBoundaryNeverShown('[data-testid="error-boundary-fallback"]');
// withFaults and startMockRequest count requests in flight, so `within` can be small:
// in 30s a stuck spinner gets ~0.9-1.1s of idle time (28-33% of its spinner time);
// the slow reviews page ~0.07s (1%).
export const spinnersSettle = spinnersClear({ within: 0.5 });
export const noLeakedValues = noLeakedText();
export const noHorizontalOverflow = noSidewaysScroll();
export const failedWritesAreShown = failedWritesShown({ errorSelector: '[role="alert"]' });
// Only errors carrying the injector's marker are excused, whenever they land:
// installFuzzConsole puts the logged fault's text in the first argument.
export const noConsoleErrorsUnlessFaulted = consoleQuietUnlessFaulted({ injected: new RegExp(INJECTED_MARKER) });
export const noTextOverLogo = nothingUnder({ selector: 'header img', container: 'header' });
export const appRenders = renders({ root: '#root' });
// Not a property (so not exported: Bombadil would refuse it): which mock API
// endpoints each flow called, for the report's API coverage.
apiCalls();
// Not a property either: where a workflow got done, per flow. flows.json says
// which ones each flow expects; explore reaching them shows as undeclared.
milestones({
  added: (doc) => [...doc.querySelectorAll('main p')].some((p) => p.textContent?.startsWith('Added.')),
  // Only after the order was placed: a reload of an order page isn't one.
  ordered: {
    holds: (doc) => /^Order \S+$/.test(doc.querySelector('main h1')?.textContent ?? '') && !!doc.querySelector('main p')?.textContent?.startsWith('Thanks,'),
    after: 'POST /orders',
  },
});
// No lazy routes here, so nothing harmless to wait out: a clean sweep's
// longest blank stretch is 0ms, and the walker leaves a blank cart in 100-550ms.
export const noBlankPages = noBlankPage({ minMs: 50 });
