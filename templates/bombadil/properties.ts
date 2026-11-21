// The properties this app should hold however it's driven, from bombadil-kit
// with this app's selectors. The export names are what the report shows, and
// part of each finding's id: rename one and its findings start over.
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

export const noErrorBoundary = errorBoundaryNeverShown('[data-testid="error-boundary-fallback"]');
export const spinnersSettle = spinnersClear({ selector: '[role="status"]' });
export const noLeakedValues = noLeakedText();
export const noHorizontalOverflow = noSidewaysScroll();
export const failedWritesAreShown = failedWritesShown({
  // Writes that fail silently on purpose, e.g. sign-out, password reset.
  quiet: [/^DELETE \/session$/],
  errorSelector: '[role="alert"]',
});
// Tighter, once the app's error logs include the fault it got: excuse only
// errors that carry the injector's marker, not any error near a fault.
//   import { INJECTED_MARKER } from 'bombadil-kit/faults';
//   consoleQuietUnlessFaulted({ injected: new RegExp(INJECTED_MARKER) })
export const noConsoleErrorsUnlessFaulted = consoleQuietUnlessFaulted();
// Only if a floating header can cover content; delete otherwise.
export const noTextOverLogo = nothingUnder({ selector: 'header img', container: 'header' });
export const appRenders = renders({ root: '#root' });
// Not a property (so not exported: Bombadil would refuse it): which mock API
// endpoints each flow called, for the report's API coverage.
apiCalls();
// Not a property either: where a workflow got done (a success banner, the
// new values on screen), not just where it went. flows.json's `milestones`
// says which ones each flow should reach.
milestones({
  ordered: (doc) => !!doc.querySelector('[data-testid="order-confirmation"]'),
});
// A route left with only its header and footer, say after a failed request.
// minMs: just above the longest `blank` stretch in a clean sweep's trace.
export const noBlankPages = noBlankPage({ chrome: 'header, footer, nav', minMs: 250 });
