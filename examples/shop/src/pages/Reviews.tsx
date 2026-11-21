import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchReviews, type Review } from '../mock.ts';
import { Spinner } from '../ui.tsx';

/** Fetched on mount, no cache, aborted on unmount: every visit starts a new request. */
export const Reviews = () => {
  const { id = '' } = useParams();
  const [list, setList] = useState<Review[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setList(null);
    fetchReviews(id, controller.signal).then(setList, (err: unknown) => {
      if ((err as Error).name !== 'AbortError') console.error('Could not load reviews', err);
    });
    return () => controller.abort();
  }, [id]);

  if (!list) return <Spinner />;
  return (
    <>
      <h1>Reviews</h1>
      <ul>
        {list.map((r, i) => (
          <li key={i}>
            <strong>{r.author}</strong>: {r.text}
          </li>
        ))}
      </ul>
      <Link to={`/products/${id}`}>Back to the product</Link>
    </>
  );
};
