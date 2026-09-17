import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCurrentUser,
  getUnitPreferences,
  updateProfile as updateProfileRequest,
  type NotificationPreferences,
  type UpdateProfileRequest,
} from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import { classifyFailureCode } from '@/lib/apiErrors';
import { getAnalyticsConsent } from '@/lib/analyticsConsent';
import { recordAnalyticsConsentDecision } from '@/lib/analyticsConsentDecision';
import { syncAnalyticsConsent } from '@/lib/analyticsConsentSync';
import { Analytics } from '@/lib/analytics';
import { normalizeTimeOfDay } from '@/utils/timezone';
import { useAuthStore } from '@/store/authStore';
import { supportedLanguages, type SupportedLanguage } from '@/i18n';
import {
  useUpdateProfile,
  useUpdateNotificationPrefs,
  useUpdateQuietHours,
  useUpdateUnitPrefs,
  useUpdateEmailDigest,
  useDeleteAccount,
} from '@/hooks/useProfile';
import { SubscriptionSection } from '@/components/profile/SubscriptionSection';
import { DataExportSection } from '@/components/profile/DataExportSection';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import {
  Button,
  Card,
  ConfirmDialog,
  Eyebrow,
  RadioGroup,
  Select,
  Sheet,
  SheetRow,
  Skeleton,
  Text,
  TextField,
  TimeField,
  Toggle,
  useToast,
  type SelectOption,
} from '@/components/ui';
import pkg from '../../package.json';

// Stage 7, Task 7.3 — Profile & settings page. Built only on Stage 0 primitives
// + the Stage 7 data layer (src/hooks/useProfile.ts + src/api/users.ts). Mirrors
// mobile/src/screens/profile/ProfileScreen.tsx field-for-field for the editable,
// non-mobile-only settings: name, time zone, language, notification prefs, quiet
// hours, units, email digest, and account deletion.
//
// The current user + unit prefs are read with direct useQuery calls keyed by the
// pre-mirrored queryKeys (the mutation hooks invalidate the same keys), since no
// shared read-hook exists yet for either.

// Mirror mobile TIMEZONES (ProfileScreen.tsx ~line 55). Labels come from i18n.
const TIMEZONE_VALUES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

// The 6 notification flags the mobile UI exposes (ProfileScreen.tsx ~line 851).
// `tips_and_suggestions` defaults ON when the key is absent.
const NOTIFICATION_KEYS: {
  key: keyof NotificationPreferences;
  label: string;
  desc: string;
  defaultOn?: boolean;
}[] = [
  {
    key: 'medication_confirmations',
    label: 'notifications.medicationConfirmations',
    desc: 'notifications.medicationConfirmationsDesc',
  },
  {
    key: 'missed_medications',
    label: 'notifications.missedMedications',
    desc: 'notifications.missedMedicationsDesc',
  },
  {
    key: 'task_assignments',
    label: 'notifications.taskAssignments',
    desc: 'notifications.taskAssignmentsDesc',
  },
  {
    key: 'appointment_reminders',
    label: 'notifications.appointmentReminders',
    desc: 'notifications.appointmentRemindersDesc',
  },
  { key: 'note_nudges', label: 'notifications.noteNudges', desc: 'notifications.noteNudgesDesc' },
  {
    key: 'tips_and_suggestions',
    label: 'notifications.tipsAndSuggestions',
    desc: 'notifications.tipsAndSuggestionsDesc',
    defaultOn: true,
  },
];

/** Card-shaped section (spec §6.7): editable, form-like settings. */
function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Card padding="lg" className="mt-6">
      <Text variant="h3" as="h2">
        {title}
      </Text>
      {description ? (
        <Text variant="caption" className="mt-1">
          {description}
        </Text>
      ) : null}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </Card>
  );
}

/** Sheet-shaped section (spec §6.7): grouped toggle/select rows. */
function SettingsSheetSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="mt-6">
      <Text variant="h3" as="h2">
        {title}
      </Text>
      {description ? (
        <Text variant="caption" className="mt-1">
          {description}
        </Text>
      ) : null}
      <Sheet padding="none" className="mt-3">
        {children}
      </Sheet>
    </div>
  );
}

export default function ProfilePage(): ReactElement {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const signOut = useAuthStore((s) => s.signOut);
  // Fallback for the analytics-consent sync below: userQuery may not have
  // resolved yet at the instant the toggle is flipped, but the auth store's
  // in-memory user is populated the moment a session exists.
  const authUserId = useAuthStore((s) => s.user?.id);

  const userQuery = useQuery({ queryKey: queryKeys.currentUser, queryFn: getCurrentUser });
  const unitsQuery = useQuery({
    queryKey: queryKeys.unitPreferences,
    queryFn: getUnitPreferences,
  });
  const user = userQuery.data;
  // Same cached query SubscriptionSection reads — no extra request.
  const { data: subscription } = useSubscriptionStatus();
  const isPremium = subscription?.tier === 'premium';

  const updateProfile = useUpdateProfile();
  const updateNotif = useUpdateNotificationPrefs();
  const updateQuiet = useUpdateQuietHours();
  const updateUnits = useUpdateUnitPrefs();
  const updateDigest = useUpdateEmailDigest();
  const deleteAccount = useDeleteAccount();
  const deleteGuard = useSubmitGuard();

  // ── Name (inline edit) ────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  // A FAILED NAME SAVE IS SHOWN INLINE IN THE FORM, NOT AS A TOAST.
  //
  // At 360x640 the name form's Save sits so low that, scrolled just far enough
  // to reach it, the "Manage subscription" button above the form is inside the
  // phone toast band (120-186px) — the error for this form's own submit covered
  // another control (e2e/unhappy/writes/toast-page-overlap.spec.ts). Inline,
  // `role="alert"`, it is announced without moving focus and sits next to the
  // Save the user retries with. Same copy as the toast it replaces
  // (common:errors.saveFailed). `useUpdateProfile` toasts on EVERY error at the
  // hook level, so this form uses its own mutation over the same request, the
  // same `currentUser` invalidation, and the same closed-set error report;
  // timezone and language keep the hook and its toast.
  const [nameError, setNameError] = useState<string | null>(null);
  const saveName = useMutation({
    mutationFn: (data: UpdateProfileRequest) => updateProfileRequest(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser });
    },
    onError: (error) => {
      Analytics.errorOccurred('profile', 'profile_mutation_error', {
        code: classifyFailureCode(error),
      });
    },
  });

  // ── Quiet hours local state (start/end live behind an enable toggle) ────
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');

  const [showDelete, setShowDelete] = useState(false);

  // Seed local state from the loaded user once.
  useEffect(() => {
    if (!user) return;
    setFirstName(user.first_name ?? '');
    setLastName(user.last_name ?? '');
    // quiet_hours_* are Postgres TIME columns — the API hands them back WITH
    // seconds ("22:00:00"). Normalize at this boundary so only canonical HH:MM
    // ever reaches local state: `<input type="time">` wants HH:MM, and editing
    // only ONE field ships the other straight back from this state.
    if (user.quiet_hours_start) setQuietStart(normalizeTimeOfDay(user.quiet_hours_start));
    if (user.quiet_hours_end) setQuietEnd(normalizeTimeOfDay(user.quiet_hours_end));
    // Depend on the FIELDS read, never on `user` itself. This effect calls four
    // setState functions, so an unstable `user` identity re-runs it on every
    // render and the component never settles — an infinite render loop that
    // hangs rather than errors. It is safe today only because React Query's
    // structural sharing happens to return the same object when the fetched
    // content is unchanged; a `select` transform, a manually-assembled user, or
    // structural sharing being turned off would each be enough to break that,
    // with no warning at the call site. Depending on the primitives makes the
    // effect insensitive to identity, and it also re-runs LESS: only when a
    // value this effect actually reads has changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.first_name, user?.last_name, user?.quiet_hours_start, user?.quiet_hours_end]);

  // MUST sit above the loading early-return below: a hook declared after a
  // conditional return runs on some renders and not others, which React
  // rejects outright ("Rendered more hooks than during the previous render").
  const [analyticsEnabled, setAnalyticsEnabledState] = useState<boolean>(() =>
    getAnalyticsConsent(),
  );

  if (userQuery.isLoading || !user) {
    return (
      <section className="mx-auto w-full max-w-2xl p-6 md:p-8">
        <Skeleton className="h-10 w-64" />
        <Card padding="lg" className="mt-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-4 h-11 w-full" />
          <Skeleton className="mt-3 h-11 w-full" />
        </Card>
      </section>
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSaveName = (): void => {
    if (saveName.isPending) return;
    // A retry replaces the previous failure; a new alert mounts (and is
    // announced again) if this attempt fails too.
    setNameError(null);
    saveName.mutate(
      { first_name: firstName.trim() || undefined, last_name: lastName.trim() || undefined },
      {
        onSuccess: () => {
          showToast(t('account.nameSuccess'), 'success');
          setEditingName(false);
        },
        onError: () => setNameError(t('common:errors.saveFailed')),
      }
    );
  };

  const handleTimezone = (tz: string): void => {
    updateProfile.mutate(
      { timezone: tz },
      {
        onSuccess: () => {
          Analytics.timezoneChanged(tz);
          showToast(t('account.timezoneSuccess'), 'success');
        },
      }
    );
  };

  const handleLanguage = (lang: string): void => {
    updateProfile.mutate(
      { language: lang as SupportedLanguage },
      {
        onSuccess: () => {
          Analytics.languageChanged(lang);
          showToast(t('language.success'), 'success');
        },
      }
    );
  };

  const handleNotif = (key: keyof NotificationPreferences, next: boolean): void => {
    updateNotif.mutate(
      { [key]: next },
      { onSuccess: () => showToast(t('notifications.success'), 'success') }
    );
  };

  const handleAnalyticsToggle = (next: boolean): void => {
    // The CLIENT half — tear down before persisting (PostHog batches, and the
    // queue built up before someone opts out is the worst possible one to
    // transmit), persist, then re-init and re-identify on an opt-in — now
    // lives in `recordAnalyticsConsentDecision`, shared with the signup
    // consent moment so the two surfaces cannot drift on a sequence whose
    // every failure is silent. The current user is passed so an opt-in
    // re-attaches the identity immediately: `identifyUser` runs from the auth
    // store on sign-in, which for a visitor who had analytics OFF was refused
    // by the `identifyAllowed` gate, and the teardown deliberately resets the
    // distinct id.
    const current = userQuery.data;
    recordAnalyticsConsentDecision(
      next,
      current?.id ? { id: current.id } : undefined
    );
    setAnalyticsEnabledState(next);
    // Tell the SERVER half of this decision too. Stopping local collection is
    // only half of honouring a withdrawal — the privacy policy promises that
    // turning analytics off "deletes the usage data previously collected from
    // you", and only the backend can do that (it stamps
    // `analytics_consent_withdrawn_at`, which also suppresses every
    // server-side capture, and deletes the PostHog person + events).
    // Fire-and-forget: the toggle above already reflects the choice, and
    // `syncAnalyticsConsent` persists a retry marker if this fails.
    const userId = userQuery.data?.id ?? authUserId;
    if (userId) void syncAnalyticsConsent(next, userId);
  };

  const handleQuietEnabledToggle = (next: boolean): void => {
    if (next) {
      updateQuiet.mutate(
        { quiet_hours_start: quietStart, quiet_hours_end: quietEnd },
        { onSuccess: () => showToast(t('quietHours.success'), 'success') }
      );
    } else {
      updateQuiet.mutate(
        { quiet_hours_start: null, quiet_hours_end: null },
        { onSuccess: () => showToast(t('quietHours.success'), 'success') }
      );
    }
  };

  const handleQuietTime = (start: string, end: string): void => {
    setQuietStart(start);
    setQuietEnd(end);
    updateQuiet.mutate(
      { quiet_hours_start: start, quiet_hours_end: end },
      { onSuccess: () => showToast(t('quietHours.success'), 'success') }
    );
  };

  const handleWeightUnit = (value: string): void => {
    updateUnits.mutate(
      { weight_unit: value as 'lbs' | 'kg' },
      { onSuccess: () => showToast(t('units.success'), 'success') }
    );
  };

  const handleGlucoseUnit = (value: string): void => {
    updateUnits.mutate(
      { glucose_unit: value as 'mg/dL' | 'mmol/L' },
      { onSuccess: () => showToast(t('units.success'), 'success') }
    );
  };

  const handleDigestEnabled = (next: boolean): void => {
    updateDigest.mutate(
      { enabled: next, day: user.email_digest_day ?? 0 },
      { onSuccess: () => showToast(t('emailDigest.success'), 'success') }
    );
  };

  const handleDigestDay = (day: number): void => {
    updateDigest.mutate(
      { enabled: true, day },
      { onSuccess: () => showToast(t('emailDigest.success'), 'success') }
    );
  };

  // Account deletion is irreversible, so the confirm button gets a real guard
  // and not just `confirmDisabled={deleteAccount.isPending}` — that state lands
  // a render after the press that would double-fire it (see
  // `useGuardedSubmit`). A second DELETE would land after the first has already
  // torn the account down and would leave the dialog showing an error for a
  // deletion that succeeded.
  const handleDeleteAccount = (): void => {
    if (deleteAccount.isPending || !deleteGuard.claim()) return;
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        // Best-effort: posthog-js batches captures, and signOut() below resets
        // analytics (clears the distinct id) — fire this FIRST so it has a
        // chance to be queued/flushed before that reset.
        Analytics.accountDeleted();
        showToast(t('delete.success'), 'success');
        setShowDelete(false);
        queryClient.clear();
        void signOut().finally(() => navigate('/login', { replace: true }));
      },
      // On error the dialog stays OPEN with the failure shown inline (plus the
      // hook's toast), so the failure is never silently swallowed.
      onSettled: () => deleteGuard.release(),
    });
  };

  // ── Derived display values ─────────────────────────────────────────────
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const quietEnabled = Boolean(user.quiet_hours_start && user.quiet_hours_end);
  const weightUnit = unitsQuery.data?.weight_unit ?? 'lbs';
  const glucoseUnit = unitsQuery.data?.glucose_unit ?? 'mg/dL';

  const timezoneOptions: SelectOption[] = TIMEZONE_VALUES.map((value) => ({
    value,
    label: t(`timezones.${value}`),
  }));

  const dayOptions: SelectOption[] = Array.from({ length: 7 }, (_, i) => ({
    value: String(i),
    label: t(`emailDigest.days.${i}`),
  }));

  return (
    <section className="mx-auto w-full max-w-2xl p-6 md:p-8">
      <Text variant="editorialTitle">{t('heading')}</Text>
      <p className="mt-3.5 text-md font-medium text-ink">{t('subheading')}</p>

      {/* ── Subscription ──────────────────────────────────────────────── */}
      <SubscriptionSection />

      {/* ── Account ───────────────────────────────────────────────────── */}
      <SettingsCard title={t('sections.account')}>
        <div>
          <p className="m-0 text-sm font-medium text-ink-2">{t('account.email')}</p>
          <p className="m-0 mt-1 text-base text-ink">{user.email}</p>
        </div>

        {editingName ? (
          <>
            <TextField
              id="profile-first-name"
              label={t('account.firstName')}
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={50}
            />
            <TextField
              id="profile-last-name"
              label={t('account.lastName')}
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={50}
            />
            {nameError ? (
              <p role="alert" className="m-0 text-sm text-terracotta-deep text-balance">
                {nameError}
              </p>
            ) : null}
            <div className="flex gap-3">
              <Button
                size="sm"
                onClick={handleSaveName}
                disabled={saveName.isPending || updateProfile.isPending}
              >
                {t('account.save')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFirstName(user.first_name ?? '');
                  setLastName(user.last_name ?? '');
                  setNameError(null);
                  setEditingName(false);
                }}
              >
                {t('account.cancel')}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="m-0 text-sm font-medium text-ink-2">{t('account.firstName')}</p>
              <p className="m-0 mt-1 truncate text-base text-ink">
                {fullName || t('account.namePlaceholder')}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditingName(true)}>
              {t('account.edit')}
            </Button>
          </div>
        )}

        <Select
          id="profile-timezone"
          label={t('account.timezone')}
          options={timezoneOptions}
          value={user.timezone ?? 'America/New_York'}
          onChange={(e) => handleTimezone(e.target.value)}
          disabled={updateProfile.isPending || saveName.isPending}
        />

        {/* Password changes happen through the sign-in reset flow — point there. */}
        <Text variant="caption">{t('account.changePasswordHint')}</Text>
      </SettingsCard>

      {/* ── Language ──────────────────────────────────────────────────── */}
      <SettingsCard title={t('sections.language')} description={t('language.description')}>
        <RadioGroup
          label={t('sections.language')}
          value={(user.language as SupportedLanguage) ?? 'en'}
          onChange={handleLanguage}
          disabled={updateProfile.isPending || saveName.isPending}
          options={(Object.keys(supportedLanguages) as SupportedLanguage[]).map((code) => ({
            value: code,
            label: t(`language.names.${code}`),
          }))}
        />
      </SettingsCard>

      {/* ── Notifications ─────────────────────────────────────────────── */}
      <SettingsSheetSection
        title={t('sections.notifications')}
        description={t('notifications.description')}
      >
        {NOTIFICATION_KEYS.map(({ key, label, desc, defaultOn }) => {
          const raw = user.notification_preferences?.[key];
          const checked = defaultOn ? raw !== false : raw === true;
          return (
            <SheetRow key={key}>
              <div className="w-full">
                <Toggle
                  checked={checked}
                  onChange={(next) => handleNotif(key, next)}
                  disabled={updateNotif.isPending}
                  label={t(label)}
                  hint={t(desc)}
                />
              </div>
            </SheetRow>
          );
        })}
      </SettingsSheetSection>

      {/* ── Quiet hours ───────────────────────────────────────────────── */}
      <SettingsSheetSection
        title={t('sections.quietHours')}
        description={t('quietHours.description')}
      >
        <SheetRow>
          <div className="w-full">
            <Toggle
              checked={quietEnabled}
              onChange={handleQuietEnabledToggle}
              disabled={updateQuiet.isPending}
              label={t('quietHours.enable')}
            />
          </div>
        </SheetRow>
        {quietEnabled ? (
          <SheetRow>
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <TimeField
                id="profile-quiet-start"
                label={t('quietHours.start')}
                value={quietStart}
                onChange={(e) => handleQuietTime(e.target.value, quietEnd)}
                disabled={updateQuiet.isPending}
              />
              <TimeField
                id="profile-quiet-end"
                label={t('quietHours.end')}
                value={quietEnd}
                onChange={(e) => handleQuietTime(quietStart, e.target.value)}
                disabled={updateQuiet.isPending}
              />
            </div>
          </SheetRow>
        ) : null}
      </SettingsSheetSection>

      {/* ── Units ─────────────────────────────────────────────────────── */}
      <SettingsCard title={t('sections.units')} description={t('units.description')}>
        <RadioGroup
          label={t('units.weight')}
          value={weightUnit}
          onChange={handleWeightUnit}
          disabled={updateUnits.isPending}
          options={[
            { value: 'lbs', label: t('units.lbs') },
            { value: 'kg', label: t('units.kg') },
          ]}
        />
        <RadioGroup
          label={t('units.glucose')}
          value={glucoseUnit}
          onChange={handleGlucoseUnit}
          disabled={updateUnits.isPending}
          options={[
            { value: 'mg/dL', label: t('units.mgdl') },
            { value: 'mmol/L', label: t('units.mmoll') },
          ]}
        />
      </SettingsCard>

      {/* ── Privacy ───────────────────────────────────────────────────── */}
      {/*
        The opt-in the privacy policy has always described, and the place to
        CHANGE an answer — the signup flow is where it is first asked
        (pages/SignUpPage.tsx). Both write through
        `recordAnalyticsConsentDecision`, so this toggle always reflects
        whatever the signup checkbox recorded. Defaults OFF: web does not
        grandfather an unasked visitor into full analytics — see
        `GRANDFATHER_UNASKED_WEB_USERS` in lib/analyticsMode.
      */}
      <SettingsSheetSection title={t('sections.privacy')} description={t('analytics.description')}>
        <SheetRow>
          <div className="w-full">
            <Toggle
              checked={analyticsEnabled}
              onChange={handleAnalyticsToggle}
              label={t('analytics.enable')}
              hint={t('analytics.hint')}
            />
          </div>
        </SheetRow>
      </SettingsSheetSection>

      {/* ── Email digest ──────────────────────────────────────────────── */}
      <SettingsSheetSection
        title={t('sections.emailDigest')}
        description={t('emailDigest.description')}
      >
        <SheetRow>
          <div className="w-full">
            <Toggle
              checked={Boolean(user.email_digest_enabled)}
              onChange={handleDigestEnabled}
              disabled={updateDigest.isPending}
              label={t('emailDigest.enable')}
              // Premium users already have the digest — only free users need the note.
              hint={isPremium ? undefined : t('emailDigest.premiumNote')}
            />
          </div>
        </SheetRow>
        {user.email_digest_enabled ? (
          <SheetRow>
            <div className="w-full">
              <Select
                id="profile-digest-day"
                label={t('emailDigest.day')}
                options={dayOptions}
                value={String(user.email_digest_day ?? 0)}
                onChange={(e) => handleDigestDay(Number(e.target.value))}
                disabled={updateDigest.isPending}
              />
            </div>
          </SheetRow>
        ) : null}
      </SettingsSheetSection>

      {/* ── Your data (GDPR export) ───────────────────────────────────── */}
      <DataExportSection />

      {/* ── Danger zone ───────────────────────────────────────────────── */}
      <Card variant="outlined" padding="lg" className="mt-6 border-terracotta-deep/30">
        <Text variant="h3" as="h2">
          {t('delete.title')}
        </Text>
        <Text variant="caption" className="mt-1">
          {t('delete.description')}
        </Text>
        <Button
          variant="danger"
          className="mt-5"
          onClick={() => {
            // Clear any stale error from a previous attempt before re-opening.
            deleteAccount.reset();
            setShowDelete(true);
          }}
          disabled={deleteAccount.isPending}
        >
          {t('delete.cta')}
        </Button>
      </Card>

      {showDelete ? (
        <ConfirmDialog
          title={t('delete.confirmTitle')}
          message={
            <>
              <p className="m-0">{t('delete.confirmBody')}</p>
              {deleteAccount.isError ? (
                <p role="alert" className="m-0 mt-3 text-sm font-medium text-terracotta-deep">
                  {t('delete.error')}
                </p>
              ) : null}
            </>
          }
          confirmLabel={t('delete.confirm')}
          cancelLabel={t('delete.keep')}
          destructive
          confirmDisabled={deleteAccount.isPending}
          onConfirm={handleDeleteAccount}
          onCancel={() => setShowDelete(false)}
        />
      ) : null}

      <Eyebrow as="p" className="mt-8 text-center">
        {t('footer.version', { version: pkg.version })}
      </Eyebrow>
    </section>
  );
}
