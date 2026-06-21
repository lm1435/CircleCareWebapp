import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCurrentUser,
  getUnitPreferences,
  type NotificationPreferences,
} from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
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
import {
  Button,
  Card,
  ConfirmDialog,
  RadioGroup,
  Select,
  Skeleton,
  TextField,
  TimeField,
  Toggle,
  useToast,
  type SelectOption,
} from '@/components/ui';

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

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <Card className="mt-6">
      <h2 className="m-0 text-lg font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-1 text-sm text-ink-3">{description}</p> : null}
      <div className="mt-5 flex flex-col gap-5">{children}</div>
    </Card>
  );
}

export default function ProfilePage(): ReactElement {
  const { t } = useTranslation('profile');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const signOut = useAuthStore((s) => s.signOut);

  const userQuery = useQuery({ queryKey: queryKeys.currentUser, queryFn: getCurrentUser });
  const unitsQuery = useQuery({
    queryKey: queryKeys.unitPreferences,
    queryFn: getUnitPreferences,
  });
  const user = userQuery.data;

  const updateProfile = useUpdateProfile();
  const updateNotif = useUpdateNotificationPrefs();
  const updateQuiet = useUpdateQuietHours();
  const updateUnits = useUpdateUnitPrefs();
  const updateDigest = useUpdateEmailDigest();
  const deleteAccount = useDeleteAccount();

  // ── Name (inline edit) ────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  // ── Quiet hours local state (start/end live behind an enable toggle) ────
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');

  const [showDelete, setShowDelete] = useState(false);

  // Seed local state from the loaded user once.
  useEffect(() => {
    if (!user) return;
    setFirstName(user.first_name ?? '');
    setLastName(user.last_name ?? '');
    if (user.quiet_hours_start) setQuietStart(user.quiet_hours_start);
    if (user.quiet_hours_end) setQuietEnd(user.quiet_hours_end);
  }, [user]);

  if (userQuery.isLoading || !user) {
    return (
      <section className="mx-auto w-full max-w-2xl p-6 md:p-8">
        <Skeleton className="h-8 w-56" />
        <Card className="mt-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-4 h-11 w-full" />
          <Skeleton className="mt-3 h-11 w-full" />
        </Card>
      </section>
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSaveName = (): void => {
    updateProfile.mutate(
      { first_name: firstName.trim() || undefined, last_name: lastName.trim() || undefined },
      {
        onSuccess: () => {
          showToast(t('account.nameSuccess'), 'success');
          setEditingName(false);
        },
      }
    );
  };

  const handleTimezone = (tz: string): void => {
    updateProfile.mutate(
      { timezone: tz },
      { onSuccess: () => showToast(t('account.timezoneSuccess'), 'success') }
    );
  };

  const handleLanguage = (lang: string): void => {
    updateProfile.mutate(
      { language: lang as SupportedLanguage },
      { onSuccess: () => showToast(t('language.success'), 'success') }
    );
  };

  const handleNotif = (key: keyof NotificationPreferences, next: boolean): void => {
    updateNotif.mutate(
      { [key]: next },
      { onSuccess: () => showToast(t('notifications.success'), 'success') }
    );
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

  const handleDeleteAccount = (): void => {
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        showToast(t('delete.success'), 'success');
        setShowDelete(false);
        queryClient.clear();
        void signOut().finally(() => navigate('/login', { replace: true }));
      },
      onError: () => setShowDelete(false),
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
      <h1 className="serif m-0 text-xl text-ink">{t('heading')}</h1>
      <p className="mt-2 text-ink-3">{t('subheading')}</p>

      {/* ── Subscription ──────────────────────────────────────────────── */}
      <SubscriptionSection />

      {/* ── Account ───────────────────────────────────────────────────── */}
      <SectionCard title={t('sections.account')}>
        <div>
          <p className="m-0 text-sm font-medium text-ink-2">{t('account.email')}</p>
          <p className="m-0 mt-1 text-base text-ink">{user.email}</p>
        </div>

        {editingName ? (
          <>
            <TextField
              id="profile-first-name"
              label={t('account.firstName')}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={50}
            />
            <TextField
              id="profile-last-name"
              label={t('account.lastName')}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={50}
            />
            <div className="flex gap-3">
              <Button size="sm" onClick={handleSaveName} disabled={updateProfile.isPending}>
                {t('account.save')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFirstName(user.first_name ?? '');
                  setLastName(user.last_name ?? '');
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
          disabled={updateProfile.isPending}
        />
      </SectionCard>

      {/* ── Language ──────────────────────────────────────────────────── */}
      <SectionCard title={t('sections.language')} description={t('language.description')}>
        <RadioGroup
          label={t('sections.language')}
          value={(user.language as SupportedLanguage) ?? 'en'}
          onChange={handleLanguage}
          disabled={updateProfile.isPending}
          options={(Object.keys(supportedLanguages) as SupportedLanguage[]).map((code) => ({
            value: code,
            label: t(`language.names.${code}`),
          }))}
        />
      </SectionCard>

      {/* ── Notifications ─────────────────────────────────────────────── */}
      <SectionCard title={t('sections.notifications')} description={t('notifications.description')}>
        {NOTIFICATION_KEYS.map(({ key, label, desc, defaultOn }) => {
          const raw = user.notification_preferences?.[key];
          const checked = defaultOn ? raw !== false : raw === true;
          return (
            <Toggle
              key={key}
              checked={checked}
              onChange={(next) => handleNotif(key, next)}
              disabled={updateNotif.isPending}
              label={t(label)}
              hint={t(desc)}
            />
          );
        })}
      </SectionCard>

      {/* ── Quiet hours ───────────────────────────────────────────────── */}
      <SectionCard title={t('sections.quietHours')} description={t('quietHours.description')}>
        <Toggle
          checked={quietEnabled}
          onChange={handleQuietEnabledToggle}
          disabled={updateQuiet.isPending}
          label={t('quietHours.enable')}
        />
        {quietEnabled ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        ) : (
          <></>
        )}
      </SectionCard>

      {/* ── Units ─────────────────────────────────────────────────────── */}
      <SectionCard title={t('sections.units')} description={t('units.description')}>
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
      </SectionCard>

      {/* ── Email digest ──────────────────────────────────────────────── */}
      <SectionCard title={t('sections.emailDigest')} description={t('emailDigest.description')}>
        <Toggle
          checked={Boolean(user.email_digest_enabled)}
          onChange={handleDigestEnabled}
          disabled={updateDigest.isPending}
          label={t('emailDigest.enable')}
          hint={t('emailDigest.premiumNote')}
        />
        {user.email_digest_enabled ? (
          <Select
            id="profile-digest-day"
            label={t('emailDigest.day')}
            options={dayOptions}
            value={String(user.email_digest_day ?? 0)}
            onChange={(e) => handleDigestDay(Number(e.target.value))}
            disabled={updateDigest.isPending}
          />
        ) : (
          <></>
        )}
      </SectionCard>

      {/* ── Danger zone ───────────────────────────────────────────────── */}
      <Card className="mt-6 border-terracotta-deep">
        <h2 className="m-0 text-lg font-semibold text-ink">{t('delete.title')}</h2>
        <p className="mt-1 text-sm text-ink-3">{t('delete.description')}</p>
        <Button
          variant="terracotta"
          className="mt-5"
          onClick={() => setShowDelete(true)}
          disabled={deleteAccount.isPending}
        >
          {t('delete.cta')}
        </Button>
      </Card>

      {showDelete ? (
        <ConfirmDialog
          title={t('delete.confirmTitle')}
          message={t('delete.confirmBody')}
          confirmLabel={t('delete.confirm')}
          cancelLabel={t('delete.keep')}
          destructive
          confirmDisabled={deleteAccount.isPending}
          onConfirm={handleDeleteAccount}
          onCancel={() => setShowDelete(false)}
        />
      ) : null}
    </section>
  );
}
