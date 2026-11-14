import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, useEffect } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import RequireAuth from './auth/RequireAuth';
import i18n from './i18n';
import AppLayout from './layout/AppLayout';
import LoginPage from './pages/LoginPage';

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const SalesPage = lazy(() => import('./pages/SalesPage'));
const EarningsPage = lazy(() => import('./pages/EarningsPage'));
const BooksPage = lazy(() => import('./pages/BooksPage'));
const BookFormPage = lazy(() => import('./pages/BookFormPage'));
const ContractPage = lazy(() => import('./pages/ContractPage'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

/** Keeps the browser tab title in the active language. */
function DocumentTitle() {
  const { t } = useTranslation();
  const title = `${t('app.name')} · ${t('app.tagline')}`;
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
}

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <DocumentTitle />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AppLayout />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="sales" element={<SalesPage />} />
                  <Route path="earnings" element={<EarningsPage />} />
                  <Route path="books" element={<BooksPage />} />
                  <Route path="books/new" element={<BookFormPage />} />
                  <Route path="books/:id" element={<BookFormPage />} />
                  <Route path="contract" element={<ContractPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
