import 'vitest';

// vitest-axe's own typings target an older Vitest; declare the matcher for this one.
declare module 'vitest' {
  interface Assertion {
    toHaveNoViolations(): void;
  }
}
