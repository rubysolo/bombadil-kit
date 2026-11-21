// The spec for signed-in flows: spec.ts's properties, with clicks that stay
// out of the header (so the fuzzer can't sign itself out partway through a
// workflow), fenced to the flow's paths.
export {
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from '@antithesishq/bombadil/browser/defaults/properties';
export * from './properties.ts';

import { actions, weighted } from '@antithesishq/bombadil/browser';
import { inputs, navigation, scroll } from '@antithesishq/bombadil/browser/defaults/actions';
import { fenced, formActions, forwardClicks, pageClicks } from 'bombadil-kit/spec';

const wait = actions(() => ['Wait']);

// Outside the flow's paths the only move is Back.
export const appActions = fenced(
  weighted([
    [10, pageClicks({ exclude: 'header' })],
    [6, forwardClicks({ exclude: 'header' })],
    [6, formActions],
    [3, inputs],
    [2, scroll],
    [1, navigation],
    [1, wait],
  ]),
);
