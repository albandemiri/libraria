import { index, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/discover.tsx'),
  route('eksploro', 'routes/explore.tsx', { id: 'explore-all' }),
  route('eksploro/numero', 'routes/explore-count.ts'),
  route('eksploro/:genre', 'routes/explore.tsx', { id: 'explore-genre' }),
  route('kerko', 'routes/search.tsx'),
  route('kerko/sugjerime', 'routes/suggest.ts'),
  route('botues/:publisherId', 'routes/publisher.tsx'),
  route('libri/:id/:slug?', 'routes/book.tsx'),
  route('kopertina/:id', 'routes/cover.ts'),
  route('gjuha', 'routes/language.ts'),
  route('hyr', 'routes/sign-in.tsx'),
  route('regjistrohu', 'routes/register.tsx'),
  route('dil', 'routes/sign-out.ts'),
  route('pagesa', 'routes/checkout-start.tsx'),
  route('pagesa/:transactionId', 'routes/checkout-status.tsx'),
  route('pagesa/:transactionId/status', 'routes/transaction-status.ts'),
  route('biblioteka', 'routes/coming-soon.tsx', { id: 'coming-soon-library' }),
  route('lista', 'routes/coming-soon.tsx', { id: 'coming-soon-lists' }),
  route('lexo/:id', 'routes/coming-soon.tsx', { id: 'coming-soon-reader' }),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
