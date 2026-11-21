import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCartQuery, useRemoveFromCartMutation } from '../api.ts';
import { planted } from '../plant.ts';
import { ErrorNote, Spinner, money } from '../ui.tsx';

export const Cart = () => {
  const { data, error, isLoading, refetch } = useCartQuery();
  const [remove] = useRemoveFromCartMutation();
  useEffect(() => {
    if (error) console.error('Could not load the cart', error);
  }, [error]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} retry={refetch} />;
  if (planted('empty')) return null;

  const onRemove = (productId: string) =>
    remove(productId)
      .unwrap()
      .catch((err: unknown) => console.error('Could not remove from cart', err));

  const total = data.reduce((sum, l) => sum + l.product.price * l.qty, 0);
  return (
    <>
      {planted('spinner') && <Spinner />}
      <h1>Cart</h1>
      {data.length === 0 ? (
        <p>
          Your cart is empty. <Link to="/">Keep shopping</Link>
        </p>
      ) : (
        <>
          <ul>
            {data.map((l) => (
              <li key={l.product.id}>
                {l.product.name} × {l.qty} <span>{money(l.product.price * l.qty)}</span>{' '}
                <button type="button" onClick={() => onRemove(l.product.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p>Total {money(total)}</p>
          <Link to="/checkout">Checkout</Link>
        </>
      )}
    </>
  );
};
