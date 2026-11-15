/**
 * Copies text for the person. Uses the async Clipboard API where the browser allows it, and
 * otherwise selects `field` (or a throwaway field) and runs the old `copy` command. Resolves to
 * false when neither worked, so the caller can ask the person to copy by hand.
 */
export async function copyText(text: string, field?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied (no secure context, no permission): fall back below.
  }
  return selectAndCopy(text, field ?? null);
}

function selectAndCopy(text: string, field: HTMLInputElement | null): boolean {
  const temporary = field ? null : makeTemporaryField(text);
  try {
    const target = field ?? (temporary as HTMLTextAreaElement);
    target.focus();
    target.select();
    target.setSelectionRange(0, text.length);
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    temporary?.remove();
  }
}

function makeTemporaryField(text: string): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  return el;
}
