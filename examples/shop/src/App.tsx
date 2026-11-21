import { Link, Route, Routes } from 'react-router-dom';
import { Cart } from './pages/Cart.tsx';
import { Checkout } from './pages/Checkout.tsx';
import { Order } from './pages/Order.tsx';
import { Product } from './pages/Product.tsx';
import { Products } from './pages/Products.tsx';
import { planted } from './plant.ts';
import { Notices } from './notices.tsx';
import { ErrorBoundary } from './ui.tsx';

const LOGO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%23c0392b'/%3E%3C/svg%3E";

export const App = () => (
  <>
    <header>
      <Link to="/">
        <img src={LOGO} alt="Shop" width={32} height={32} />
      </Link>
      <nav>
        <Link to="/">Products</Link> <Link to="/cart">Cart</Link>
      </nav>
    </header>
    {planted('overlap') && <p className="promo">Free shipping today</p>}
    <Notices />
    <main>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Products />} />
          <Route path="/products/:id" element={<Product />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/orders/:id" element={<Order />} />
          <Route path="*" element={<p>Nothing here. <Link to="/">Back to the shop</Link></p>} />
        </Routes>
      </ErrorBoundary>
    </main>
  </>
);
