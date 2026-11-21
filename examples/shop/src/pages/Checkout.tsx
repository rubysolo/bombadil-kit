import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaceOrderMutation } from '../api.ts';
import { ErrorNote } from '../ui.tsx';

export const Checkout = () => {
  const [place, placing] = usePlaceOrderMutation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', address: '' });
  useEffect(() => {
    // A 422 is the form's answer, shown to the user; anything else is a failure worth logging.
    const e = placing.error;
    if (e && !('status' in e && e.status === 422)) console.error('Could not place the order', e);
  }, [placing.error]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { id } = await place(form).unwrap();
      navigate(`/orders/${id}`);
    } catch {
      // placing.error shows it, and the effect above logs it.
    }
  };
  const field = (name: keyof typeof form, label: string, type = 'text', autoComplete: string = name) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        value={form[name]}
        onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      />
    </label>
  );
  return (
    <form onSubmit={submit}>
      <h1>Checkout</h1>
      {field('name', 'Name')}
      {field('email', 'Email', 'email')}
      {field('address', 'Address', 'text', 'street-address')}
      <button type="submit" disabled={placing.isLoading}>
        Place order
      </button>
      {/* Other failures show as a notice (notices.tsx), wherever the user is by then. */}
      {placing.error && 'status' in placing.error && placing.error.status === 422 && <ErrorNote error={placing.error} />}
    </form>
  );
};
