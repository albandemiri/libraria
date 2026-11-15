import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './AppRoutes';
import { AuthProvider } from './auth/AuthProvider';
import i18n from './i18n';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
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
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
