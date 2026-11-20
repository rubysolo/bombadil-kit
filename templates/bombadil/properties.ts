// The properties this app should hold however it's driven, from bombadil-kit
// with this app's selectors. The export names are what the report shows, and
// part of each finding's id: rename one and its findings start over.
import {
  appRenders as renders,
  consoleQuietUnlessFaulted,
  errorBoundaryNeverShown,
  failedWritesShown,
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
export const noConsoleErrorsUnlessFaulted = consoleQuietUnlessFaulted();
// Only if a floating header can cover content; delete otherwise.
export const noTextOverLogo = nothingUnder({ selector: 'header img', container: 'header' });
export const appRenders = renders({ root: '#root' });
