import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOrderQuery } from '../api.ts';
import { ErrorNote, Spinner, money } from '../ui.tsx';

export const Order = () => {
  const { id = '' } = useParams();
  const { data, error, isLoading, refetch } = useOrderQuery(id);
  useEffect(() => {
    // A 404 is shown as "Not found"; only real failures are worth logging.
    if (error && !('status' in error && error.status === 404)) console.error('Could not load order', id, error);
  }, [error, id]);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorNote error={error} retry={refetch} />;
  return (
    <>
      <h1>Order {data.id}</h1>
      <p>
        Thanks, {data.name}. {money(data.total)}, placed {new Date(data.placedAt).toLocaleDateString('en-US')}, ships to{' '}
        {data.address}.
      </p>
      <Link to="/">Keep shopping</Link>
    </>
  );
};
