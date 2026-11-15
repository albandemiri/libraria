import { lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import RequireAuth from './auth/RequireAuth';
import AppShell from './layout/AppShell';
import LoginPage from './pages/LoginPage';

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const SalesOrdersPage = lazy(() => import('./pages/SalesOrdersPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const EarningsPage = lazy(() => import('./pages/EarningsPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
const BookPage = lazy(() => import('./pages/BookPage'));
const BookEditorPage = lazy(() => import('./pages/BookEditorPage'));
const PayoutsPage = lazy(() => import('./pages/PayoutsPage'));
const StatementsPage = lazy(() => import('./pages/StatementsPage'));
const ContractsPage = lazy(() => import('./pages/ContractsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

/** The old /books/:id link now opens the book page. */
function BookRedirect() {
  const { bookId } = useParams();
  return <Navigate to={`/catalog/${bookId}`} replace />;
}

/** Every route in the portal. Exported on its own so redirects can be tested for real. */
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="catalog/new" element={<BookEditorPage />} />
          <Route path="catalog/:bookId/edit" element={<BookEditorPage />} />
          <Route path="catalog/:bookId" element={<BookPage />} />
          <Route path="catalog/:bookId/:tab" element={<BookPage />} />
          <Route path="sales" element={<SalesOrdersPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="earnings" element={<EarningsPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="payouts" element={<PayoutsPage />} />
          <Route path="statements" element={<StatementsPage />} />
          <Route path="contracts" element={<ContractsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="/books" element={<Navigate to="/catalog" replace />} />
      <Route path="/books/new" element={<Navigate to="/catalog/new" replace />} />
      <Route path="/books/:bookId" element={<BookRedirect />} />
      <Route path="/contract" element={<Navigate to="/contracts" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
