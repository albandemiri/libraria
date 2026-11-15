import { useEffect, useRef, useState } from 'react';

/**
 * After a failed client-side validation, moves focus to the first field marked `aria-invalid`.
 * Attach `formRef` to the form and call `request()` right after setting the errors: the focus
 * moves once they are rendered.
 */
export function useFocusFirstInvalid() {
  const formRef = useRef<HTMLFormElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tick === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [tick]);
  return { formRef, request: () => setTick((n) => n + 1) };
}
