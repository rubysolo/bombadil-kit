import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useProductsQuery } from '../api.ts';
import { planted } from '../plant.ts';
import { ErrorNote, Spinner, money } from '../ui.tsx';

export const Products = () => {
  const { data, error, isLoading, refetch } = useProductsQuery();
  useEffect(() => {
    if (error) console.error('Could not load products', error);
  }, [error]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} retry={refetch} />;
  const items = data.map((p) => (
    <li key={planted('noisy') ? undefined : p.id}>
      <Link to={`/products/${p.id}`}>{p.name}</Link> <span>{money(p.price)}</span>
    </li>
  ));
  return (
    <>
      <h1>Products</h1>
      <ul className="products" style={planted('overflow') ? { minWidth: 1200 } : undefined}>
        {items}
      </ul>
    </>
  );
};
