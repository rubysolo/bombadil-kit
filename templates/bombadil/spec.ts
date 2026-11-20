// The whole app, signed out, from its start page: an unfenced random walk.
export {
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from '@antithesishq/bombadil/browser/defaults/properties';
export * from './properties.ts';

import { actions, weighted } from '@antithesishq/bombadil/browser';
import { clicks, inputs, navigation, scroll } from '@antithesishq/bombadil/browser/defaults/actions';
import { formActions, forwardClicks } from 'bombadil-kit/spec';

// Bombadil's `waitOnce` won't wait twice in a row, so while the app is still
// loading (a spinner and nothing to click) it runs out of actions and stops.
const wait = actions(() => ['Wait']);

// One exported generator, so these weights set the whole mix. Exported
// separately, Bombadil's defaults spend most actions on back/forward/reload,
// scrolling and waiting, and rarely get a form submitted.
export const appActions = weighted([
  [10, clicks],
  [6, forwardClicks()],
  [6, formActions],
  [3, inputs],
  [2, scroll],
  [1, navigation],
  [1, wait],
]);
