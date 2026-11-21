// The mock API: seeded data in memory, answered by an RTK Query baseQuery.
import { faker } from '@faker-js/faker';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { MockEndpoint } from 'bombadil-kit/faults';
import { startMockRequest } from 'bombadil-kit/faults';
import { seedFaker } from 'bombadil-kit/faker';

// Seeded before any data is built, so a seed replays the same shop.
export const { mockNow } = seedFaker(faker, import.meta.env);

export interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
}
export interface CartLine {
  product: Product;
  qty: number;
}
export interface Order {
  id: string;
  name: string;
  email: string;
  address: string;
  lines: CartLine[];
  total: number;
  placedAt: string;
}

const products: Product[] = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1),
  name: faker.commerce.productName(),
  price: Number(faker.commerce.price({ min: 5, max: 200 })),
  description: faker.commerce.productDescription(),
}));
let cart: { productId: string; qty: number }[] = [];
const orders = new Map<string, Order>();

const cartLines = (): CartLine[] =>
  cart.map(({ productId, qty }) => ({ product: products.find((p) => p.id === productId)!, qty }));

const latency = Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 50) || 0;
const notFound = { error: { status: 404, data: { error: 'Not found' } } } as const;

const answer = (method: string, path: string, body: Record<string, unknown>) => {
  let m: RegExpMatchArray | null;
  if (method === 'GET' && path === '/products') return { data: products };
  if (method === 'GET' && (m = path.match(/^\/products\/(\w+)$/))) {
    const product = products.find((p) => p.id === m![1]);
    return product ? { data: product } : notFound;
  }
  if (method === 'GET' && path === '/cart') return { data: cartLines() };
  if (method === 'POST' && path === '/cart/items') {
    const productId = String(body.productId);
    if (!products.some((p) => p.id === productId)) return notFound;
    const line = cart.find((l) => l.productId === productId);
    if (line) line.qty += 1;
    else cart.push({ productId, qty: 1 });
    return { data: cartLines() };
  }
  if (method === 'DELETE' && (m = path.match(/^\/cart\/(\w+)$/))) {
    cart = cart.filter((l) => l.productId !== m![1]);
    return { data: cartLines() };
  }
  if (method === 'POST' && path === '/orders') {
    const { name, email, address } = body as Record<string, string>;
    const lines = cartLines();
    if (!name?.trim() || !email?.trim() || !address?.trim() || lines.length === 0) {
      return { error: { status: 422, data: { errors: ['Name, email, address and a non-empty cart are required'] } } };
    }
    const id = String(orders.size + 1001);
    const total = lines.reduce((sum, l) => sum + l.product.price * l.qty, 0);
    orders.set(id, { id, name, email, address, lines, total, placedAt: new Date(mockNow()).toISOString() });
    cart = [];
    return { data: { id } };
  }
  if (method === 'GET' && (m = path.match(/^\/orders\/(\w+)$/))) {
    const order = orders.get(m[1]!);
    return order ? { data: order } : notFound;
  }
  return notFound;
};

// The endpoints answer() has, for the report's API coverage: ones no flow
// calls show there as never called. Keys are what withFaults logs, METHOD /path.
if (typeof window !== 'undefined') {
  window.__mockEndpoints = ['GET /products', 'GET /products/:id', 'GET /cart', 'POST /cart/items', 'DELETE /cart/:id', 'POST /orders', 'GET /orders/:id'].map(
    (key): MockEndpoint => ({ key, variants: [] }),
  );
}

export const mockBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args) => {
  const { url, method = 'GET', body = {} } = typeof args === 'string' ? { url: args } : args;
  if (latency) await new Promise((r) => setTimeout(r, latency));
  // structuredClone: the app must not hold the mock's own objects.
  return structuredClone(answer(method.toUpperCase(), url, body as Record<string, unknown>)) as
    | { data: unknown }
    | { error: FetchBaseQueryError };
};

export interface Review {
  author: string;
  text: string;
}

const reviewLatency = Number(import.meta.env.VITE_REVIEWS_LATENCY_MS ?? 400) || 0;
const reviews = new Map<string, Review[]>(
  products.map((p) => [p.id, Array.from({ length: 3 }, () => ({ author: faker.person.firstName(), text: faker.lorem.sentence() }))]),
);

/**
 * Reviews the way many apps fetch: on mount, no cache, aborted on unmount.
 * Its own latency (VITE_REVIEWS_LATENCY_MS, default 400ms), slower than the
 * rest of the mock, so a walker often leaves before it answers.
 */
export const fetchReviews = (productId: string, signal: AbortSignal) =>
  new Promise<Review[]>((resolve, reject) => {
    // In flight until it answers or is abandoned: spinnersClear doesn't count that time.
    const done = startMockRequest();
    const timer = setTimeout(() => {
      done();
      resolve(structuredClone(reviews.get(productId) ?? []));
    }, reviewLatency);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      done();
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
