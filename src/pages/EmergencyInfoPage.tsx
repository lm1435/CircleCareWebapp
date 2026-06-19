import { useEffect, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import {
  ContactCard,
  DirectivesCard,
  DoctorCard,
  EmergencySection,
  EmptySection,
  GlanceTiles,
  InsuranceCard,
  MedicalInfoCard,
  RecipientHeader,
} from '@/components/emergency';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { EmergencyIcon } from '@/components/ui/emptyStateIcons';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { useCircles } from '@/hooks/useCircles';
import { useEmergencyInfo } from '@/hooks/useEmergencyInfo';
import '@/styles/print.css';

// PHI page: never log the payload, never attach any of it to analytics.

const SKELETON_SECTIONS = [0, 1, 2];

// Section ids double as in-page nav anchors; order mirrors triage priority
// (medical facts first — this page is read under stress).
const SECTIONS = [
  { id: 'medical-info', key: 'medicalInfo' },
  { id: 'doctors', key: 'doctors' },
  { id: 'contacts', key: 'contacts' },
  { id: 'insurance', key: 'insurance' },
  { id: 'directives', key: 'directives' },
] as const;

function hasMedicalInfo(info: EmergencyInfo): boolean {
  return !!(
    info.blood_type ||
    (info.medication_allergies?.length ?? 0) > 0 ||
    (info.allergies?.length ?? 0) > 0 ||
    (info.medical_conditions?.length ?? 0) > 0
  );
}

function hasDoctors(info: EmergencyInfo): boolean {
  return !!info.primary_doctor_name || (info.additional_doctors?.length ?? 0) > 0;
}

function hasContacts(info: EmergencyInfo): boolean {
  return (info.emergency_contacts?.length ?? 0) > 0;
}

function hasInsurance(info: EmergencyInfo): boolean {
  return (info.insurance_plans?.length ?? 0) > 0;
}

function hasDirectives(info: EmergencyInfo): boolean {
  return info.has_dnr !== null && info.has_dnr !== undefined
    ? true
    : !!info.advance_directives;
}

/**
 * Emergency Info page (plan Tasks 28 + 31): sectioned read-only layout with
 * in-page nav, Print button (window.print), per-section empty states, and a
 * print-only header naming whose information this is.
 */
export default function EmergencyInfoPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation('emergency');
  const { data: info, isLoading, isError, refetch } = useEmergencyInfo(circleId);
  const { data: circles } = useCircles();
  // Circle detail carries the recipient's photo, DOB, and conditions — the
  // GET /circles list does NOT. (verified: src/api/circleMembers.ts)
  const { data: circleDetail } = useCircleMembers(circleId);

  const recipientName =
    circles?.find((circle) => circle.id === circleId)?.recipient_name ??
    circleDetail?.recipient_name ??
    '';

  // Scope print.css rules to this page only (see src/styles/print.css).
  useEffect(() => {
    document.body.classList.add('emergency-print-scope');
    return () => {
      document.body.classList.remove('emergency-print-scope');
    };
  }, []);

  if (isLoading) {
    return (
      <section className="mx-auto max-w-3xl p-6 md:p-8">
        <h1 className="serif m-0 text-xl text-ink">{t('title')}</h1>
        <div role="status" aria-live="polite" className="mt-6">
          <span className="sr-only">{t('loadingLabel')}</span>
          <div className="grid gap-4">
            {SKELETON_SECTIONS.map((section) => (
              <Card key={section}>
                <Skeleton className="h-5 w-1/3 max-w-48" />
                <Skeleton className="mt-3 h-4 w-2/3 max-w-80" />
                <Skeleton className="mt-2 h-4 w-1/2 max-w-64" />
              </Card>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="mx-auto max-w-3xl p-6 md:p-8">
        <h1 className="serif m-0 text-xl text-ink">{t('title')}</h1>
        <Card className="mt-6 text-center">
          <p className="m-0 font-medium text-ink">{t('errorTitle')}</p>
          <Button variant="ghost" className="mt-4" onClick={() => void refetch()}>
            {t('retry')}
          </Button>
        </Card>
      </section>
    );
  }

  const sectionHasData: Record<(typeof SECTIONS)[number]['key'], boolean> = info
    ? {
        medicalInfo: hasMedicalInfo(info),
        doctors: hasDoctors(info),
        contacts: hasContacts(info),
        insurance: hasInsurance(info),
        directives: hasDirectives(info),
      }
    : { medicalInfo: false, doctors: false, contacts: false, insurance: false, directives: false };

  const isFullyEmpty = !info || SECTIONS.every((section) => !sectionHasData[section.key]);

  // Fully-empty state: one clear card instead of five empty sections.
  if (isFullyEmpty) {
    return (
      <section className="mx-auto max-w-3xl p-6 md:p-8">
        <h1 className="serif m-0 text-xl text-ink">{t('title')}</h1>
        <Card className="mt-6 border-dashed p-8">
          <EmptyState
            tone="terracotta"
            icon={<EmergencyIcon />}
            title={t('emptyTitle')}
            description={t('emptyHint')}
          >
            <a
              href="https://circlecare.app"
              className="font-medium text-terracotta-deep underline underline-offset-2 hover:text-ink"
            >
              {t('downloadCta')}
            </a>
          </EmptyState>
        </Card>
      </section>
    );
  }

  const generatedDate = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
    new Date()
  );

  return (
    <section className="mx-auto max-w-3xl p-6 md:p-8">
      {/* Print-only header: whose info this is + when the sheet was generated. */}
      <div className="print-only print-header">
        <p className="text-lg font-semibold">{t('printHeading')}</p>
        {recipientName && <p>{t('preparedFor', { name: recipientName })}</p>}
        <p>{t('printedOn', { date: generatedDate })}</p>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="serif m-0 text-xl text-ink">{t('title')}</h1>
          <p className="m-0 mt-1 text-sm text-ink-3">{t('subtitle')}</p>
        </div>
        <Button variant="ghost" className="no-print" onClick={() => window.print()}>
          {t('print')}
        </Button>
      </header>

      <nav aria-label={t('onThisPage')} className="no-print mt-6">
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="text-sm font-medium text-ink-2 underline underline-offset-4 hover:text-ink"
              >
                {t(`sections.${section.key}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Read-only on web — editing lives in the mobile app. */}
      <Card className="no-print mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 bg-bg-2 p-4">
        <p className="m-0 text-sm font-medium text-ink">{t('readOnlyNotice')}</p>
        <p className="m-0 text-sm text-ink-3">
          {t('downloadToEdit')}{' '}
          <a
            href="https://circlecare.app"
            className="font-medium text-terracotta-deep underline underline-offset-2 hover:text-ink"
          >
            {t('downloadCta')}
          </a>
        </p>
      </Card>

      <div className="emergency-content mt-8 grid gap-10">
        {circleDetail && (
          <RecipientHeader
            name={recipientName}
            photoUrl={circleDetail.recipient_photo_url}
            dob={circleDetail.recipient_dob}
            conditions={circleDetail.recipient_conditions}
          />
        )}

        <GlanceTiles info={info} />

        <EmergencySection id="medical-info" title={t('sections.medicalInfo')}>
          {sectionHasData.medicalInfo ? (
            <MedicalInfoCard
              bloodType={info.blood_type}
              medicationAllergies={info.medication_allergies ?? []}
              allergies={info.allergies ?? []}
              conditions={info.medical_conditions ?? []}
            />
          ) : (
            <EmptySection message={t('empty.medicalInfo')} />
          )}
        </EmergencySection>

        <EmergencySection id="doctors" title={t('sections.doctors')}>
          {sectionHasData.doctors ? (
            <>
              {info.primary_doctor_name && (
                <DoctorCard
                  name={info.primary_doctor_name}
                  specialty={info.primary_doctor_specialty}
                  phone={info.primary_doctor_phone}
                  countryCode={info.primary_doctor_country_code}
                  address={info.primary_doctor_address}
                  isPrimary
                />
              )}
              {(info.additional_doctors ?? []).map((doctor, index) => (
                <DoctorCard
                  key={`${doctor.name}-${index}`}
                  name={doctor.name}
                  specialty={doctor.specialty}
                  phone={doctor.phone}
                  countryCode={doctor.country_code}
                  address={doctor.address}
                />
              ))}
            </>
          ) : (
            <EmptySection message={t('empty.doctors')} />
          )}
        </EmergencySection>

        <EmergencySection id="contacts" title={t('sections.contacts')}>
          {sectionHasData.contacts ? (
            (info.emergency_contacts ?? []).map((contact, index) => (
              <ContactCard
                key={`${contact.name}-${index}`}
                name={contact.name}
                relationship={contact.relationship}
                phone={contact.phone}
                countryCode={contact.country_code}
                isPrimary={contact.is_primary}
              />
            ))
          ) : (
            <EmptySection message={t('empty.contacts')} />
          )}
        </EmergencySection>

        <EmergencySection id="insurance" title={t('sections.insurance')}>
          {sectionHasData.insurance ? (
            (info.insurance_plans ?? []).map((plan, index) => (
              <InsuranceCard key={`${plan.carrier}-${index}`} plan={plan} />
            ))
          ) : (
            <EmptySection message={t('empty.insurance')} />
          )}
        </EmergencySection>

        <EmergencySection id="directives" title={t('sections.directives')}>
          {sectionHasData.directives ? (
            <DirectivesCard hasDnr={!!info.has_dnr} directives={info.advance_directives} />
          ) : (
            <EmptySection message={t('empty.directives')} />
          )}
        </EmergencySection>
      </div>
    </section>
  );
}
