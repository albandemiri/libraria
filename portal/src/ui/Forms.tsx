import {
  type ComponentPropsWithRef,
  type DragEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Forms.module.css';
import { CheckIcon, CrossIcon, UploadIcon } from './icons';

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
};

/** Wires a label, hint and error to its control; pass the props to the input. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {hint && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          <CrossIcon />
          {error}
        </span>
      )}
    </div>
  );
}

export function Input(props: ComponentPropsWithRef<'input'>) {
  return <input {...props} className={`${styles.input} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${styles.input} ${props.className ?? ''}`} />;
}

export function FileDrop({
  onFiles,
  title,
  hint,
  accept,
  multiple = false,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  /** Visible label and accessible name of the control. */
  title: string;
  hint?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const [over, setOver] = useState(false);
  const hintId = useId();
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) onFiles(Array.from(e.dataTransfer.files));
  };
  return (
    <div className={styles.dropWrap}>
      <label
        className={styles.drop}
        data-over={over}
        data-disabled={disabled}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <UploadIcon />
        <span className={styles.dropTitle}>{title}</span>
        <input
          type="file"
          className={styles.fileInput}
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </label>
      {/* Outside the label, so the control's name stays just its title. */}
      {hint && (
        <span id={hintId} className={styles.dropHint}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Stepper({
  steps,
  current,
  complete,
}: {
  steps: string[];
  current: number;
  /** Per-step completion. Without it, every step before `current` counts as done. */
  complete?: boolean[];
}) {
  const { t } = useTranslation();
  return (
    <ol
      className={styles.steps}
      aria-label={t('ui.stepLabel', { current: current + 1, count: steps.length })}
    >
      {steps.map((label, i) => {
        const done = complete ? complete[i] === true : i < current;
        return (
          <li
            key={label}
            className={`${styles.step} ${done ? styles.done : ''}`}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className={styles.marker} aria-hidden="true">
              {done ? <CheckIcon /> : i + 1}
            </span>
            {label}
            {done && <span className="ui-sr-only">{t('ui.stepDone')}</span>}
          </li>
        );
      })}
    </ol>
  );
}
