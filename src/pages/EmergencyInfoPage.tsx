import { useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import {
  ContactCard,
  DirectivesCard,
  DoctorCard,
  EditContactModal,
  EditDoctorModal,
  EditInsuranceModal,
  EditMedicalInfoModal,
  EmergencySection,
  EmptySection,
  GlanceTiles,
  InsuranceCard,
  MedicalInfoCard,
  RecipientHeader,
} from '@/components/emergency';
import {
  filterOutIndex,
  toRequestContacts,
  toRequestPlans,
  useUpdateEmergencyInfo,
} from '@/hooks/useEmergencyInfo';
import {
  Accordion,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  useAccordionGroup,
} from '@/components/ui';
import { EmergencyIcon } from '@/components/ui/emptyStateIcons';
import { useCircle } from '@/hooks/useCircle';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { useCircles } from '@/hooks/useCircles';
import { useEmergencyInfo } from '@/hooks/useEmergencyInfo';
import '@/styles/print.css';

// PHI page: never log the payload, never attach any of it to analytics.

// Advance directives are hidden for launch (mirror of mobile). Flip to true to
// surface the EditDirectivesModal + Edit affordance on the directives section.
const DIRECTIVES_EDIT_ENABLED = false;

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

// The four sections that live inside collapsible accordions. Code Status
// ('directives') is intentionally excluded — it stays always-visible.
const COLLAPSIBLE_SECTION_IDS = ['medical-info', 'doctors', 'contacts', 'insurance'];

// Open-modal descriptor. `target` is the doctor target ('primary' | index |
// undefined-for-add) or the array index for contacts/insurance.
type OpenModal =
  | { kind: 'doctor'; target: 'primary' | number | undefined }
  | { kind: 'contact'; index?: number }
  | { kind: 'insurance'; index?: number }
  | { kind: 'medical' };

// Pending delete descriptor (per-item, confirmed via ConfirmDialog).
type PendingDelete =
  | { kind: 'doctor-primary' }
  | { kind: 'doctor'; index: number }
  | { kind: 'contact'; index: number }
  | { kind: 'insurance'; index: number };

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
  return info.has_dnr !== null && info.has_dnr !== undefined ? true : !!info.advance_directives;
}

/**
 * Emergency Info page (plan Stage 4): sectioned layout with in-page nav, Print
 * button, per-section empty states. When the requester can edit, per-section
 * Add buttons + per-item Edit/Delete affordances drive the section edit modals
 * (all backed by the single partial-merge PUT). When the requester cannot edit,
 * the read-only view + download-app CTA is preserved.
 */
export default function EmergencyInfoPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t, i18n } = useTranslation(['emergency', 'common']);
  const { data: info, isLoading, isError, refetch } = useEmergencyInfo(circleId);
  const { data: circles } = useCircles();
  // Circle detail carries the recipient's photo, DOB, and conditions — the
  // GET /circles list does NOT. (verified: src/api/circleMembers.ts)
  const { data: circleDetail } = useCircleMembers(circleId);
  const { canEdit } = useCircle(circleId);
  const update = useUpdateEmergencyInfo(circleId);

  const [openModal, setOpenModal] = useState<OpenModal | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  // Collapsible (accordion) sections — expanded by default. Code Status stays
  // always-visible, so it's NOT in this group. The at-a-glance summary + the
  // recipient header are always visible too.
  const accordion = useAccordionGroup(COLLAPSIBLE_SECTION_IDS, { defaultOpen: true });

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

  const confirmDelete = (): void => {
    if (!pendingDelete) return;
    const onSuccess = () => setPendingDelete(null);
    switch (pendingDelete.kind) {
      case 'doctor-primary':
        update.mutate(
          {
            primary_doctor_name: null,
            primary_doctor_specialty: null,
            primary_doctor_phone: null,
            primary_doctor_address: null,
          },
          { onSuccess }
        );
        break;
      case 'doctor':
        update.mutate(
          {
            additional_doctors: filterOutIndex(
              info?.additional_doctors ?? [],
              pendingDelete.index
            ),
          },
          { onSuccess }
        );
        break;
      case 'contact':
        update.mutate(
          {
            emergency_contacts: toRequestContacts(
              filterOutIndex(info?.emergency_contacts ?? [], pendingDelete.index)
            ),
          },
          { onSuccess }
        );
        break;
      case 'insurance':
        update.mutate(
          {
            insurance_plans: toRequestPlans(
              filterOutIndex(info?.insurance_plans ?? [], pendingDelete.index)
            ),
          },
          { onSuccess }
        );
        break;
    }
  };

  const deleteCopy: Record<PendingDelete['kind'], { title: string; message: string }> = {
    'doctor-primary': {
      title: t('edit.doctor.removePrimaryTitle'),
      message: t('edit.doctor.removePrimaryMessage'),
    },
    doctor: { title: t('edit.doctor.removeTitle'), message: t('edit.doctor.removeMessage') },
    contact: { title: t('edit.contact.removeTitle'), message: t('edit.contact.removeMessage') },
    insurance: {
      title: t('edit.insurance.removeTitle'),
      message: t('edit.insurance.removeMessage'),
    },
  };

  if (isLoading) {
    return (
      <section className="mx-auto max-w-5xl p-6 md:p-8">
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
      <section className="mx-auto max-w-5xl p-6 md:p-8">
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

  // Header counts for the accordion meta slot (e.g. number of doctors).
  const doctorCount =
    (info?.primary_doctor_name ? 1 : 0) + (info?.additional_doctors?.length ?? 0);
  const contactCount = info?.emergency_contacts?.length ?? 0;
  const insuranceCount = info?.insurance_plans?.length ?? 0;

  const isFullyEmpty = !info || SECTIONS.every((section) => !sectionHasData[section.key]);

  // Fully-empty AND can't edit: one clear card with the download CTA. (When the
  // user CAN edit, fall through to the sectioned view so the Add buttons show.)
  if (isFullyEmpty && !canEdit) {
    return (
      <section className="mx-auto max-w-5xl p-6 md:p-8">
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
    <section className="mx-auto max-w-5xl p-6 md:p-8">
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

      {/* Read-only notice only when the requester can't edit. */}
      {!canEdit && (
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
      )}

      <div className="emergency-content mt-8 flex flex-col gap-10">
        {circleDetail && (
          <RecipientHeader
            name={recipientName}
            photoUrl={circleDetail.recipient_photo_url}
            dob={circleDetail.recipient_dob}
            conditions={circleDetail.recipient_conditions}
          />
        )}

        {info && <GlanceTiles info={info} />}

        {/* Expand/Collapse all — controls only the collapsible sections below.
            Hidden in print (everything prints regardless). */}
        <div className="no-print -mb-4 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={accordion.allOpen}
            onClick={() => (accordion.allOpen ? accordion.collapseAll() : accordion.expandAll())}
          >
            {accordion.allOpen ? t('common:collapseAll') : t('common:expandAll')}
          </Button>
        </div>

        <div className="emergency-sections lg:columns-2 lg:gap-x-8 [&>section]:mb-10 [&>section]:break-inside-avoid lg:[&>section]:mt-0">
          <Accordion
            id="medical-info"
            title={t('sections.medicalInfo')}
            open={accordion.isOpen('medical-info')}
            onToggle={accordion.toggle}
          >
            {sectionHasData.medicalInfo && info ? (
              <>
                <MedicalInfoCard
                  bloodType={info.blood_type}
                  medicationAllergies={info.medication_allergies ?? []}
                  allergies={info.allergies ?? []}
                  conditions={info.medical_conditions ?? []}
                />
                {canEdit && (
                  <div className="no-print">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenModal({ kind: 'medical' })}
                    >
                      {t('edit.editMedicalInfo')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <EmptySection
                message={t('empty.medicalInfo')}
                action={
                  canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenModal({ kind: 'medical' })}
                    >
                      {t('edit.editMedicalInfo')}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Accordion>

          <Accordion
            id="doctors"
            title={t('sections.doctors')}
            open={accordion.isOpen('doctors')}
            onToggle={accordion.toggle}
            meta={doctorCount > 0 ? doctorCount : undefined}
          >
            {sectionHasData.doctors && info ? (
              <>
                {info.primary_doctor_name && (
                  <DoctorCard
                    name={info.primary_doctor_name}
                    specialty={info.primary_doctor_specialty}
                    phone={info.primary_doctor_phone}
                    countryCode={info.primary_doctor_country_code}
                    address={info.primary_doctor_address}
                    isPrimary
                    onEdit={
                      canEdit ? () => setOpenModal({ kind: 'doctor', target: 'primary' }) : undefined
                    }
                    onDelete={canEdit ? () => setPendingDelete({ kind: 'doctor-primary' }) : undefined}
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
                    onEdit={
                      canEdit ? () => setOpenModal({ kind: 'doctor', target: index }) : undefined
                    }
                    onDelete={canEdit ? () => setPendingDelete({ kind: 'doctor', index }) : undefined}
                  />
                ))}
                {canEdit && (
                  <div className="no-print">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenModal({ kind: 'doctor', target: undefined })}
                    >
                      {t('edit.addDoctor')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <EmptySection
                message={t('empty.doctors')}
                action={
                  canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenModal({ kind: 'doctor', target: undefined })}
                    >
                      {t('edit.addDoctor')}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Accordion>

          <Accordion
            id="contacts"
            title={t('sections.contacts')}
            open={accordion.isOpen('contacts')}
            onToggle={accordion.toggle}
            meta={contactCount > 0 ? contactCount : undefined}
          >
            {sectionHasData.contacts && info ? (
              <>
                {(info.emergency_contacts ?? []).map((contact, index) => (
                  <ContactCard
                    key={`${contact.name}-${index}`}
                    name={contact.name}
                    relationship={contact.relationship}
                    phone={contact.phone}
                    countryCode={contact.country_code}
                    isPrimary={contact.is_primary}
                    onEdit={
                      canEdit ? () => setOpenModal({ kind: 'contact', index }) : undefined
                    }
                    onDelete={canEdit ? () => setPendingDelete({ kind: 'contact', index }) : undefined}
                  />
                ))}
                {canEdit && (
                  <div className="no-print">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenModal({ kind: 'contact' })}
                    >
                      {t('edit.addContact')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <EmptySection
                message={t('empty.contacts')}
                action={
                  canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenModal({ kind: 'contact' })}
                    >
                      {t('edit.addContact')}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Accordion>

          <Accordion
            id="insurance"
            title={t('sections.insurance')}
            open={accordion.isOpen('insurance')}
            onToggle={accordion.toggle}
            meta={insuranceCount > 0 ? insuranceCount : undefined}
          >
            {sectionHasData.insurance && info ? (
              <>
                {(info.insurance_plans ?? []).map((plan, index) => (
                  <InsuranceCard
                    key={`${plan.carrier}-${index}`}
                    plan={plan}
                    onEdit={
                      canEdit ? () => setOpenModal({ kind: 'insurance', index }) : undefined
                    }
                    onDelete={
                      canEdit ? () => setPendingDelete({ kind: 'insurance', index }) : undefined
                    }
                  />
                ))}
                {canEdit && (
                  <div className="no-print">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenModal({ kind: 'insurance' })}
                    >
                      {t('edit.addInsurance')}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <EmptySection
                message={t('empty.insurance')}
                action={
                  canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenModal({ kind: 'insurance' })}
                    >
                      {t('edit.addInsurance')}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Accordion>

          <EmergencySection id="directives" title={t('sections.directives')}>
            {sectionHasData.directives && info ? (
              <DirectivesCard hasDnr={!!info.has_dnr} directives={info.advance_directives} />
            ) : (
              <EmptySection message={t('empty.directives')} />
            )}
          </EmergencySection>
        </div>
      </div>

      {/* ── Section edit modals (gated on canEdit at the call sites). ── */}
      {openModal?.kind === 'medical' && (
        <EditMedicalInfoModal
          circleId={circleId}
          info={info ?? null}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal?.kind === 'doctor' && (
        <EditDoctorModal
          circleId={circleId}
          info={info ?? null}
          target={openModal.target}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal?.kind === 'contact' && (
        <EditContactModal
          circleId={circleId}
          info={info ?? null}
          index={openModal.index}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal?.kind === 'insurance' && (
        <EditInsuranceModal
          circleId={circleId}
          info={info ?? null}
          index={openModal.index}
          onClose={() => setOpenModal(null)}
        />
      )}

      {/* DIRECTIVES_EDIT_ENABLED is false (hidden for launch, mirror of mobile).
          When flipped on, an Edit affordance + EditDirectivesModal mount here. */}
      {DIRECTIVES_EDIT_ENABLED && null}

      {/* ── Per-item delete confirmation. ── */}
      {pendingDelete && (
        <ConfirmDialog
          title={deleteCopy[pendingDelete.kind].title}
          message={deleteCopy[pendingDelete.kind].message}
          confirmLabel={t('edit.delete')}
          cancelLabel={t('edit.cancel')}
          destructive
          confirmDisabled={update.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
