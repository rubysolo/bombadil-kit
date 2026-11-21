import { createApi } from '@reduxjs/toolkit/query/react';
import { withFaults } from 'bombadil-kit/rtk';
import { mockBaseQuery, type CartLine, type Order, type Product } from './mock.ts';
import { planted } from './plant.ts';

// Off unless VITE_MOCK_FAULT_RATE is set: then a seeded share of requests fail.
// The silent-write plant fails only the write it silences: a failed read's own
// alert would otherwise count as the error being shown.
const baseQuery = withFaults(mockBaseQuery, import.meta.env, planted('silent-write') ? { spare: [/^(?!\/cart\/items$)/] } : {});

export const api = createApi({
  baseQuery,
  tagTypes: ['Cart'],
  endpoints: (b) => ({
    products: b.query<Product[], void>({ query: () => '/products' }),
    product: b.query<Product, string>({ query: (id) => `/products/${id}` }),
    cart: b.query<CartLine[], void>({ query: () => '/cart', providesTags: ['Cart'] }),
    addToCart: b.mutation<CartLine[], string>({
      query: (productId) => ({ url: '/cart/items', method: 'POST', body: { productId } }),
      invalidatesTags: ['Cart'],
    }),
    removeFromCart: b.mutation<CartLine[], string>({
      query: (productId) => ({ url: `/cart/${productId}`, method: 'DELETE' }),
      invalidatesTags: ['Cart'],
    }),
    placeOrder: b.mutation<{ id: string }, { name: string; email: string; address: string }>({
      query: (body) => ({ url: '/orders', method: 'POST', body }),
      invalidatesTags: ['Cart'],
    }),
    order: b.query<Order, string>({ query: (id) => `/orders/${id}` }),
  }),
});

export const {
  useProductsQuery,
  useProductQuery,
  useCartQuery,
  useAddToCartMutation,
  useRemoveFromCartMutation,
  usePlaceOrderMutation,
  useOrderQuery,
} = api;
