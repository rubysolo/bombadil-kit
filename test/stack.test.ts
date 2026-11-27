import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appFrame, frameLabel, parseFrames } from '../src/report/stack.ts';

const VITE = 'http://127.0.0.1:5199';
// What the crash plant's uncaught exception carries (examples/shop, Vite dev).
const thrown = [
  'Uncaught Error: planted: product 9 failed to render',
  `    at Product (${VITE}/src/pages/Product.tsx:31:38)`,
  `    at renderWithHooks (${VITE}/node_modules/.vite/deps/chunk-VIJJTZRL.js?v=a66b9ef4:11548:26)`,
].join('\n');

test('parseFrames reads V8 frames, named or not', () => {
  assert.deepEqual(parseFrames(thrown), [
    { fn: 'Product', url: `${VITE}/src/pages/Product.tsx` },
    { fn: 'renderWithHooks', url: `${VITE}/node_modules/.vite/deps/chunk-VIJJTZRL.js?v=a66b9ef4` },
  ]);
  // Bombadil's anonymous `at (url)`, and a bare `at url` (bombadil-kit/console's frames).
  assert.deepEqual(parseFrames(`x\n    at (${VITE}/src/a.ts:3:4)\n    at ${VITE}/src/b.ts:5:6`), [
    { fn: undefined, url: `${VITE}/src/a.ts` },
    { fn: undefined, url: `${VITE}/src/b.ts` },
  ]);
});

test('appFrame: the first frame in the project’s own code, file and function, never a line', () => {
  const frame = appFrame(thrown)!;
  assert.deepEqual(frame, { file: 'src/pages/Product.tsx', fn: 'Product' });
  assert.equal(frameLabel(frame), 'src/pages/Product.tsx (Product)');
  assert.deepEqual(appFrame(`Error: x\n    at (${VITE}/src/pages/Product.tsx:161:10)`), { file: 'src/pages/Product.tsx' });
  // Library frames only (an error thrown in RTK's middleware): none.
  assert.equal(appFrame(`TypeError: x\n    at f (${VITE}/node_modules/.vite/deps/chunk-A.js?v=1:1:1)\n    at g (${VITE}/@vite/client:2:2)`), undefined);
  // A production bundle names no source file.
  assert.equal(appFrame(`Error: x\n    at f (${VITE}/assets/index-abc.js:1:200)`), undefined);
  // The kit's own frames are never the app's, linked (/@fs/) or installed.
  assert.equal(appFrame(`Error: x\n    at f (${VITE}/@fs/repo/bombadil-kit/src/app/faults.ts:1:1)`), undefined);
  assert.equal(appFrame(`Error: x\n    at f (${VITE}/node_modules/bombadil-kit/dist/app/faults.js:1:1)`), undefined);
  assert.equal(appFrame('no stack'), undefined);
});
