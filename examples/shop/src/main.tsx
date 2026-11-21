import { configureStore } from '@reduxjs/toolkit';
import { installFuzzConsole } from 'bombadil-kit/console';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { api } from './api.ts';
import { App } from './App.tsx';
import { planted } from './plant.ts';
import './style.css';

if (import.meta.env.VITE_FUZZ === 'true') installFuzzConsole();

const store = configureStore({
  reducer: { [api.reducerPath]: api.reducer },
  middleware: (m) => m().concat(api.middleware),
});

if (!planted('blank'))
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
    </StrictMode>,
  );
