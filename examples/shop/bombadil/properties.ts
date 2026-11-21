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
// The mock answers in 50ms; a clean sweep's worst path shows a spinner ~0.3s in all.
export const spinnersSettle = spinnersClear({ within: 3 });
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
  ordered: (doc) => /^Order \S+$/.test(doc.querySelector('main h1')?.textContent ?? '') && !!doc.querySelector('main p')?.textContent?.startsWith('Thanks,'),
});
// No lazy routes here, so nothing harmless to wait out: a clean sweep's
// longest blank stretch is 0ms, and the walker leaves a blank cart in 100-550ms.
export const noBlankPages = noBlankPage({ minMs: 50 });
