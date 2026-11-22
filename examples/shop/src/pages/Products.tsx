import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProductsQuery } from '../api.ts';
import { planted } from '../plant.ts';
import { Details, ErrorNote, Spinner, money } from '../ui.tsx';

export const Products = () => {
  const { data, error, isLoading, refetch } = useProductsQuery();
  const [details, setDetails] = useState<string>();
  useEffect(() => {
    if (error) console.error('Could not load products', error);
  }, [error]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} retry={refetch} />;
  const shown = data.find((p) => p.id === details);
  const items = data.map((p) => (
    <li key={planted('noisy') ? undefined : p.id}>
      <Link to={`/products/${p.id}`}>{p.name}</Link> <span>{money(p.price)}</span>{' '}
      <button type="button" onClick={() => setDetails(p.id)}>
        Details
      </button>
    </li>
  ));
  return (
    <>
      <h1>Products</h1>
      <ul className="products" style={planted('overflow') ? { minWidth: 1200 } : undefined}>
        {items}
      </ul>
      {shown && <Details product={shown} close={() => setDetails(undefined)} />}
    </>
  );
};
