import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AdminPublisher,
  type OpenInvite,
  type TeamMember,
  useInviteActions,
  useUserStatus,
} from '../../api/admin';
import Notice from '../../components/Notice';
import { currentLanguage } from '../../i18n';
import { useFocusFirstInvalid } from '../../lib/useFocusFirstInvalid';
import { copyText } from '../../lib/clipboard';
import { formatDate } from '../../lib/format';
import { Button, type Column, DataTable, Dialog, Field, Input, StatusBadge } from '../../ui';
import styles from '../Page.module.css';
import Section from '../Section';
import { adminErrorKey } from './adminErrors';
import local from './Platform.module.css';

/** What the admin sees once, right after an invite is made: never kept past the dialog. */
type Issued = { link: string; email: string; expiresAt: string };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The link, a copy button and the one-time warning. The link lives only in this dialog's props. */
function InviteLinkDialog({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const { t } = useTranslation();
  const field = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');

  const onCopy = async () => {
    // Clear first so a screen reader announces every copy, not only the first.
    setCopy('idle');
    setCopy((await copyText(issued.link, field.current)) ? 'done' : 'failed');
  };

  return (
    <Dialog
      open
      dismissible={false}
      onOpenChange={(open) => !open && onClose()}
      title={t('platform.invite.linkTitle', { email: issued.email })}
      actions={
        <Button variant="primary" onClick={onClose}>
          {t('ui.done')}
        </Button>
      }
    >
      <div className={local.dialogForm}>
        <Notice tone="plain">
          {t('platform.invite.note', {
            email: issued.email,
            date: formatDate(issued.expiresAt, currentLanguage()),
          })}
        </Notice>
        <Field label={t('platform.invite.linkLabel')}>
          {(props) => (
            <div className={local.copyRow}>
              <Input
                {...props}
                ref={field}
                readOnly
                value={issued.link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button onClick={() => void onCopy()}>{t('platform.invite.copy')}</Button>
            </div>
          )}
        </Field>
        <p role="status" className={styles.muted}>
          {copy === 'done' && t('platform.invite.copied')}
          {copy === 'failed' && t('platform.invite.copyFailed')}
        </p>
      </div>
    </Dialog>
  );
}

function InviteDialog({
  publisherId,
  onClose,
  onIssued,
}: {
  publisherId: string;
  onClose: () => void;
  onIssued: (issued: Issued) => void;
}) {
  const { t } = useTranslation();
  const { create } = useInviteActions(publisherId);
  const formId = useId();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const { formRef, request } = useFocusFirstInvalid();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_SHAPE.test(trimmed)) {
      setEmailError(t('platform.form.errors.email'));
      request();
      return;
    }
    setEmailError(undefined);
    const displayName = name.trim();
    create.mutate(
      { email: trimmed, ...(displayName && { displayName }) },
      {
        onSuccess: ({ invite, link }) =>
          onIssued({ link, email: invite.email, expiresAt: invite.expiresAt }),
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('platform.invite.title')}
      actions={
        <>
          <Button onClick={onClose}>{t('platform.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={create.isPending}>
            {t('platform.invite.create')}
          </Button>
        </>
      }
    >
      <form ref={formRef} id={formId} className={local.dialogForm} onSubmit={submit} noValidate>
        {create.isError && <Notice tone="error">{t(adminErrorKey(create.error))}</Notice>}
        <Field label={t('platform.invite.email')} error={emailError} required>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="off"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('platform.invite.name')}>
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** Logins and pending invites of one publisher: invite, re-issue, cancel, suspend, reactivate. */
export default function TeamTab({
  publisher,
  team,
  invites,
}: {
  publisher: AdminPublisher;
  team: TeamMember[];
  invites: OpenInvite[];
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { create, revoke } = useInviteActions(publisher.id);
  const userStatus = useUserStatus(publisher.id);
  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [suspending, setSuspending] = useState<TeamMember | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const fail = (error: unknown) => setErrorKey(adminErrorKey(error));

  const reissue = (invite: OpenInvite) => {
    setErrorKey(null);
    create.mutate(
      { email: invite.email, ...(invite.displayName && { displayName: invite.displayName }) },
      {
        onSuccess: (result) =>
          setIssued({
            link: result.link,
            email: result.invite.email,
            expiresAt: result.invite.expiresAt,
          }),
        onError: fail,
        // The link is on screen only; do not keep it in the mutation's state.
        onSettled: () => create.reset(),
      },
    );
  };

  const setStatus = (member: TeamMember, status: 'active' | 'suspended') => {
    setErrorKey(null);
    userStatus.mutate(
      { userId: member.id, status },
      { onError: fail, onSettled: () => setSuspending(null) },
    );
  };

  const loginColumns: Array<Column<TeamMember>> = [
    {
      key: 'email',
      header: t('platform.team.email'),
      rowHeader: true,
      cell: (m) => <span className={local.wrapCell}>{m.email}</span>,
    },
    {
      key: 'name',
      header: t('platform.team.name'),
      cell: (m) => m.displayName ?? t('common.none'),
    },
    {
      key: 'status',
      header: t('status.label'),
      cell: (m) => (
        <StatusBadge tone={m.status === 'active' ? 'positive' : 'negative'}>
          {t(`platform.team.status.${m.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'created',
      header: t('platform.team.created'),
      cell: (m) => formatDate(m.createdAt, lang),
    },
    {
      key: 'actions',
      header: <span className="ui-sr-only">{t('platform.team.actions')}</span>,
      align: 'end',
      cell: (m) =>
        m.status === 'active' ? (
          <Button
            size="sm"
            aria-label={t('platform.team.suspendLabel', { email: m.email })}
            onClick={() => setSuspending(m)}
          >
            {t('platform.team.suspend')}
          </Button>
        ) : (
          <Button
            size="sm"
            aria-label={t('platform.team.reactivateLabel', { email: m.email })}
            disabled={userStatus.isPending}
            onClick={() => setStatus(m, 'active')}
          >
            {t('platform.team.reactivate')}
          </Button>
        ),
    },
  ];

  const inviteColumns: Array<Column<OpenInvite>> = [
    {
      key: 'email',
      header: t('platform.team.email'),
      rowHeader: true,
      cell: (i) => <span className={local.wrapCell}>{i.email}</span>,
    },
    {
      key: 'name',
      header: t('platform.team.name'),
      cell: (i) => i.displayName ?? t('common.none'),
    },
    {
      key: 'created',
      header: t('platform.team.created'),
      cell: (i) => formatDate(i.createdAt, lang),
    },
    {
      key: 'expires',
      header: t('platform.team.expires'),
      cell: (i) => formatDate(i.expiresAt, lang),
    },
    {
      key: 'actions',
      header: <span className="ui-sr-only">{t('platform.team.actions')}</span>,
      align: 'end',
      cell: (i) => (
        <div className={local.rowActions}>
          <Button
            size="sm"
            aria-label={t('platform.team.reissueLabel', { email: i.email })}
            disabled={create.isPending}
            onClick={() => reissue(i)}
          >
            {t('platform.team.reissue')}
          </Button>
          <Button
            size="sm"
            aria-label={t('platform.team.cancelInviteLabel', { email: i.email })}
            disabled={revoke.isPending}
            onClick={() => {
              setErrorKey(null);
              revoke.mutate(i.id, { onError: fail });
            }}
          >
            {t('platform.team.cancelInvite')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <div>
        <Button variant="primary" onClick={() => setInviting(true)}>
          {t('platform.team.invite')}
        </Button>
      </div>
      {errorKey && <Notice tone="error">{t(errorKey)}</Notice>}

      <Section title={t('platform.team.logins')}>
        {team.length === 0 ? (
          <p className={`${styles.muted} ${styles.emptyCard}`}>{t('platform.team.noLogins')}</p>
        ) : (
          <DataTable
            ariaLabel={t('platform.team.loginsTable')}
            columns={loginColumns}
            rows={team}
            rowKey={(m) => m.id}
          />
        )}
      </Section>

      <Section title={t('platform.team.pending')}>
        {invites.length === 0 ? (
          <p className={`${styles.muted} ${styles.emptyCard}`}>{t('platform.team.noInvites')}</p>
        ) : (
          <DataTable
            ariaLabel={t('platform.team.invitesTable')}
            columns={inviteColumns}
            rows={invites}
            rowKey={(i) => i.id}
          />
        )}
      </Section>

      {inviting && (
        <InviteDialog
          publisherId={publisher.id}
          onClose={() => setInviting(false)}
          onIssued={(next) => {
            setInviting(false);
            setIssued(next);
          }}
        />
      )}
      {issued && <InviteLinkDialog issued={issued} onClose={() => setIssued(null)} />}
      {suspending && (
        <Dialog
          open
          onOpenChange={(open) => !open && setSuspending(null)}
          title={t('platform.team.suspendTitle', { email: suspending.email })}
          description={t('platform.team.suspendBody')}
          actions={
            <>
              <Button onClick={() => setSuspending(null)}>{t('platform.cancel')}</Button>
              <Button
                variant="danger"
                loading={userStatus.isPending}
                onClick={() => setStatus(suspending, 'suspended')}
              >
                {t('platform.team.suspend')}
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      )}
    </div>
  );
}
