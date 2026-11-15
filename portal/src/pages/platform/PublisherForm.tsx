import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Notice from '../../components/Notice';
import { useFocusFirstInvalid } from '../../lib/useFocusFirstInvalid';
import { currentLanguage } from '../../i18n';
import { countryName } from '../../lib/format';
import { Button, Field, Input, Select } from '../../ui';
import styles from './Platform.module.css';

/** The countries the form offers. "other" is stored as ZZ. */
export const COUNTRY_CHOICES = ['AL', 'XK', 'MK', 'ME', 'IT', 'DE', 'CH', 'GR', 'other'] as const;

export type PublisherValues = {
  name: string;
  contactEmail: string;
  /** A choice from COUNTRY_CHOICES, a stored code outside the list, or '' for none yet. */
  country: string;
};

export const toApiCountry = (choice: string): string => (choice === 'other' ? 'ZZ' : choice);
export const fromApiCountry = (code: string | null): string =>
  code === null ? '' : code === 'ZZ' ? 'other' : code;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMPTY_PUBLISHER: PublisherValues = { name: '', contactEmail: '', country: 'AL' };

type Errors = Partial<Record<keyof PublisherValues, string>>;

/**
 * Name, contact email and country of a publisher. Validates before it calls `onSubmit`. With
 * `showSubmit` off the form has no button of its own: a dialog submits it through `formId`.
 */
export default function PublisherForm({
  initial = EMPTY_PUBLISHER,
  formId,
  submitLabel,
  showSubmit = true,
  busy = false,
  errorKey = null,
  saved = false,
  message,
  onSubmit,
}: {
  initial?: PublisherValues;
  formId?: string;
  submitLabel?: string;
  showSubmit?: boolean;
  busy?: boolean;
  /** A translation key for a server refusal, shown above the fields. */
  errorKey?: string | null;
  saved?: boolean;
  /** Replaces "saved" (for example "Nothing to save"); both vanish once the form is edited. */
  message?: string;
  onSubmit: (values: PublisherValues) => void;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const [values, setValues] = useState<PublisherValues>(initial);
  const [errors, setErrors] = useState<Errors>({});

  const [touched, setTouched] = useState(false);
  const { formRef, request } = useFocusFirstInvalid();
  const countryMissing = initial.country === '';

  const set = (patch: Partial<PublisherValues>) => {
    setTouched(true);
    setValues((v) => ({ ...v, ...patch }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(false);
    const next: Errors = {};
    const name = values.name.trim();
    const email = values.contactEmail.trim();
    if (!name) next.name = t('platform.form.errors.name');
    if (!EMAIL_SHAPE.test(email)) next.contactEmail = t('platform.form.errors.email');
    if (!values.country) next.country = t('platform.form.errors.country');
    setErrors(next);
    if (Object.keys(next).length > 0) {
      request();
      return;
    }
    onSubmit({ name, contactEmail: email, country: values.country });
  };

  const options = [
    ...(values.country === '' ? [{ value: '', label: t('platform.form.chooseCountry') }] : []),
    ...COUNTRY_CHOICES.map((code) => ({
      value: code,
      label: code === 'other' ? t('platform.country.other') : countryName(code, lang),
    })),
    // A code stored earlier that the short list does not offer stays selectable.
    ...(values.country !== '' && !(COUNTRY_CHOICES as readonly string[]).includes(values.country)
      ? [{ value: values.country, label: countryName(values.country, lang) }]
      : []),
  ];

  return (
    <form ref={formRef} id={formId} className={styles.form} onSubmit={submit} noValidate>
      {errorKey && <Notice tone="error">{t(errorKey)}</Notice>}
      <Field label={t('platform.form.name')} error={errors.name} required>
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            maxLength={200}
            value={values.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('platform.form.email')} error={errors.contactEmail} required>
        {(props) => (
          <Input
            {...props}
            type="email"
            autoComplete="off"
            maxLength={254}
            value={values.contactEmail}
            onChange={(e) => set({ contactEmail: e.target.value })}
          />
        )}
      </Field>
      <Field
        label={t('platform.form.country')}
        hint={
          countryMissing && values.country === '' ? t('platform.form.countryMissing') : undefined
        }
        error={errors.country}
        required
      >
        {(props) => (
          <Select
            {...props}
            label={t('platform.form.country')}
            value={values.country}
            onChange={(country) => set({ country })}
            options={options}
          />
        )}
      </Field>
      {showSubmit && (
        <div className={styles.formActions}>
          <Button type="submit" variant="primary" loading={busy}>
            {submitLabel ?? t('platform.form.save')}
          </Button>
          <span role="status" className={styles.num}>
            {touched ? '' : (message ?? (saved ? t('platform.form.saved') : ''))}
          </span>
        </div>
      )}
    </form>
  );
}
