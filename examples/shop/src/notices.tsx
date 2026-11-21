// Failed writes, told wherever the user is now: a write can fail after they've
// left the page that made it, and that page's own error never renders.
import { createSlice, isRejectedWithValue, type Middleware, type PayloadAction } from '@reduxjs/toolkit';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { planted } from './plant.ts';
import { describe } from './ui.tsx';

interface Notice {
  id: number;
  text: string;
}

const notices = createSlice({
  name: 'notices',
  initialState: [] as Notice[],
  reducers: {
    added: (state, { payload }: PayloadAction<Notice>) => [...state.slice(-2), payload],
    dismissed: (state, { payload }: PayloadAction<number>) => state.filter((n) => n.id !== payload),
  },
});
export const noticesReducer = notices.reducer;

const WHAT: Record<string, string> = {
  addToCart: 'Could not add to cart',
  removeFromCart: 'Could not remove from cart',
  placeOrder: 'Could not place the order',
};

let next = 1;
export const noticeMiddleware: Middleware = (store) => (nxt) => (action) => {
  if (isRejectedWithValue(action)) {
    const meta = action.meta as { arg?: { type?: string; endpointName?: string } };
    const endpoint = meta.arg?.endpointName ?? '';
    const what = meta.arg?.type === 'mutation' ? WHAT[endpoint] : undefined;
    // A 422 on checkout is the form's own answer, shown inline there.
    const validation = endpoint === 'placeOrder' && (action.payload as { status?: unknown })?.status === 422;
    const silenced = planted('silent-write') && endpoint === 'addToCart';
    if (what && !validation && !silenced) {
      const text = `${what}: ${describe(action.payload as Parameters<typeof describe>[0])}`;
      store.dispatch(notices.actions.added({ id: next++, text }));
    }
  }
  return nxt(action);
};

const NoticeLine = ({ notice }: { notice: Notice }) => {
  const dispatch = useDispatch();
  useEffect(() => {
    const t = setTimeout(() => dispatch(notices.actions.dismissed(notice.id)), 8000);
    return () => clearTimeout(t);
  }, [dispatch, notice.id]);
  return (
    <p role="alert" className="error">
      {notice.text}
      <button type="button" onClick={() => dispatch(notices.actions.dismissed(notice.id))}>
        Dismiss
      </button>
    </p>
  );
};

export const Notices = () => {
  const list = useSelector((s: { notices: Notice[] }) => s.notices);
  return (
    <div className="notices">
      {list.map((n) => (
        <NoticeLine key={n.id} notice={n} />
      ))}
    </div>
  );
};
