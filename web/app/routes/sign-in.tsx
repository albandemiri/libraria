import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { AuthForm } from '../auth/AuthForm';
import { authenticate, redirectIfSignedIn } from '../auth/auth.server';
import { assertSameOrigin } from '../server/security.server';

export function loader({ request }: LoaderFunctionArgs) {
  return redirectIfSignedIn(request);
}

export async function action({ request }: ActionFunctionArgs) {
  assertSameOrigin(request);
  return authenticate(request, 'signIn');
}

export default function SignIn() {
  return <AuthForm mode="signIn" />;
}
