import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAddToCartMutation, useProductQuery } from '../api.ts';
import { planted } from '../plant.ts';
import { ErrorNote, Spinner, money } from '../ui.tsx';

export const Product = () => {
  const { id = '' } = useParams();
  const { data, error, isLoading, refetch } = useProductQuery(id);
  const [add, adding] = useAddToCartMutation();
  const [added, setAdded] = useState(false);
  useEffect(() => {
    // A 404 is shown as "Not found"; only real failures are worth logging.
    if (error && !('status' in error && error.status === 404)) console.error('Could not load product', id, error);
  }, [error, id]);

  if (planted('crash') && data) throw new Error(`planted: product ${id} failed to render`);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} retry={refetch} />;

  const onAdd = async () => {
    setAdded(false);
    if (planted('reject')) {
      // No catch: a failed add becomes an unhandled rejection.
      await add(data.id).unwrap();
      setAdded(true);
      return;
    }
    try {
      await add(data.id).unwrap();
      setAdded(true);
    } catch (err) {
      console.error('Could not add to cart', err);
    }
  };

  const price = planted('leak') ? `${(data as unknown as { cost: string }).cost}` : money(data.price);
  return (
    <article>
      <h1>{data.name}</h1>
      <p>{data.description}</p>
      <p className="price">{price}</p>
      <p>
        <Link to={`/reviews/${data.id}`}>Reviews</Link>
      </p>
      <button
        type="button"
        onClick={
          planted('throw')
            ? () => {
                // Synchronous: inside the async onAdd it would be a rejection instead.
                throw new Error('planted: add to cart handler threw');
              }
            : onAdd
        }
        disabled={adding.isLoading}
      >
        Add to cart
      </button>
      {added && <p>Added. <Link to="/cart">Go to cart</Link></p>}
    </article>
  );
};
