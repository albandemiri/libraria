/**
 * `*`: any URL no other route matches. The 404 is thrown, so the root error boundary renders the
 * localized "not found" page inside the site shell.
 */
export function loader(): never {
  throw new Response('Not Found', { status: 404 });
}

/** Never rendered (the loader always throws); a UI route, so the error is not a bare resource reply. */
export default function NotFound() {
  return null;
}
