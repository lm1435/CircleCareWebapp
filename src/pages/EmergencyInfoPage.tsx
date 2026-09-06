import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AdditionalDoctor, EmergencyContact, EmergencyInfo, InsurancePlan } from '@/api/emergencyInfo';
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
  RecipientHeader,
} from '@/components/emergency';
// Not (yet) re-exported from the barrel above — see EmergencySection.tsx.
import { EmergencyAccordionSection } from '@/components/emergency/EmergencySection';
import {
  filterOutIndex,
  toRequestContacts,
  toRequestPlans,
  useUpdateEmergencyInfo,
} from '@/hooks/useEmergencyInfo';
import {
  Button,
  CHIP_BASE,
  CHIP_UNSELECTED,
  Card,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  useAccordionGroup,
} from '@/components/ui';
import { PageMasthead, type MastheadAction } from '@/components/layout/PageMasthead';
import { HealthTabs } from '@/components/layout/HealthTabs';
import { useCircle } from '@/hooks/useCircle';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import { useCircles } from '@/hooks/useCircles';
import { useEmergencyInfo } from '@/hooks/useEmergencyInfo';
import { Analytics } from '@/lib/analytics';
import '@/styles/print.css';

// PHI page: never log the payload, never attach any of it to analytics.

// Advance directives are hidden for launch (mirror of mobile). Flip to true to
// surface the EditDirectivesModal + Edit affordance on the directives section.
const DIRECTIVES_EDIT_ENABLED = false;

const SKELETON_SECTIONS = [0, 1, 2];

// Section ids double as in-page nav anchors; order mirrors triage priority
// (this page is read under stress). Medical facts (blood type, allergies,
// conditions) live in the always-visible at-a-glance tiles, not a section
// (Round 7 merge — docs/plans/condition-tags.md R7-4).
const SECTIONS = [
  { id: 'doctors', key: 'doctors' },
  { id: 'contacts', key: 'contacts' },
  { id: 'insurance', key: 'insurance' },
  { id: 'directives', key: 'directives' },
] as const;

// The three sections that live inside collapsible accordions. Code Status
// ('directives') is intentionally excluded — it stays always-visible.
const COLLAPSIBLE_SECTION_IDS = ['doctors', 'contacts', 'insurance'];

// Print break-avoidance for one section inside the `.emergency-sections`
// masonry (spec §6.6). Applied on a plain wrapper div rather than
// `Accordion`'s own `<section>` (it has no `className` prop) — see
// `EmergencySection`'s own `className` prop for the one section this page
// owns directly.
const SECTION_WRAP_CLASS = 'mb-10 break-inside-avoid lg:mt-0';

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

// One row of the doctors accordion: the primary doctor (flat fields on
// `EmergencyInfo`, at most one) or an entry from `additional_doctors` (needs
// its array index for edit/delete). Unified so both can share one
// `EmergencyAccordionSection<DoctorRow>` instead of a special-cased primary
// slot outside the generic list.
type DoctorRow =
  | ({ kind: 'primary' } & Pick<
      EmergencyInfo,
      | 'primary_doctor_name'
      | 'primary_doctor_specialty'
      | 'primary_doctor_phone'
      | 'primary_doctor_country_code'
      | 'primary_doctor_address'
    >)
  | { kind: 'additional'; index: number; doctor: AdditionalDoctor };

// Conditions render only in the at-a-glance tiles (Round 7 merge), but they
// still count toward "has any data" — a conditions-only circle must get the
// full page, not the fully-empty CTA.
function hasConditions(info: EmergencyInfo): boolean {
  return (info.medical_conditions?.length ?? 0) > 0;
}

/**
 * Everything the at-a-glance tiles can render: conditions, blood type and both
 * allergy lists. This is the "is there anything medical here at all" test, and
 * it must stay in step with GlanceTiles — a fact shown there but missing here
 * is a fact a view-only member never sees.
 */
function hasCriticalInfo(info: EmergencyInfo): boolean {
  return (
    hasConditions(info) ||
    !!info.blood_type ||
    (info.medication_allergies?.length ?? 0) > 0 ||
    (info.allergies?.length ?? 0) > 0
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
 * A blank record for a circle whose emergency-info GET has SETTLED (not
 * loading, not errored) but resolved `emergency_info: null` — i.e. no row
 * exists yet (backend PGRST116). Passed to the edit modals instead of the raw
 * `null` so their `if (!props.info) return null` self-defense guard (which
 * exists to stop an unhydrated read-modify-write, see the mobile emergency
 * editors' history) doesn't ALSO block the legitimate first-ever add: without
 * this, `info` stays `null` forever for an empty circle, so "Add contact"
 * opened a modal that immediately rendered nothing — a silent no-op with no
 * error, no loading state, nothing to retry (WA1).
 */
function synthesizeEmptyEmergencyInfo(circleId: string): EmergencyInfo {
  return {
    id: '',
    circle_id: circleId,
    insurance_plans: [],
    additional_doctors: [],
    allergies: [],
    medication_allergies: [],
    medical_conditions: [],
    emergency_contacts: [],
    created_at: '',
    updated_at: '',
  };
}

/**
 * Shared masthead (spec §6.6): terracotta section eyebrow, the page title +
 * subtitle, `HealthTabs` (Emergency · Documents, below xl), and — only when
 * the requester can edit AND there is somewhere for the affordance to go
 * (the modals only mount past the loading/error states) — the "Edit medical
 * info" right action.
 */
function EmergencyMasthead({
  title,
  subtitle,
  rightAction,
  secondaryAction,
}: {
  title: string;
  subtitle: string;
  rightAction?: MastheadAction;
  secondaryAction?: MastheadAction;
}): ReactElement {
  const { t } = useTranslation('common');
  return (
    <PageMasthead
      section={t('nav.emergency')}
      tone="terracotta"
      title={title}
      subtitle={subtitle}
      rightAction={rightAction}
      secondaryAction={secondaryAction}
    >
      <HealthTabs />
    </PageMasthead>
  );
}

/**
 * Emergency Info page (plan Stage 4): sectioned layout with in-page nav, Print
 * button, per-section empty states. When the requester can edit, per-section
 * Add buttons + per-item MoreMenu (Edit/Delete) affordances drive the section
 * edit modals (all backed by the single partial-merge PUT). When the
 * requester cannot edit, the read-only view + download-app CTA is preserved.
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

  // Instrumented from day one (the vitals lesson) — ids only, never content.
  useEffect(() => {
    if (circleId) Analytics.emergencyInfoViewed(circleId);
  }, [circleId]);

  const openEditMedical = (): void => setOpenModal({ kind: 'medical' });

  const editMedicalAction: MastheadAction = {
    name: 'create-outline',
    label: t('edit.editMedicalInfo'),
    onClick: openEditMedical,
  };

  const printAction: MastheadAction = {
    name: 'print-outline',
    label: t('print'),
    onClick: () => window.print(),
  };

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
      <section className="mx-auto max-w-5xl pb-10">
        <EmergencyMasthead title={t('title')} subtitle={t('subtitle')} />
        <div role="status" aria-live="polite" className="mt-6 px-5">
          <span className="sr-only">{t('loadingLabel')}</span>
          <div className="grid gap-4">
            {SKELETON_SECTIONS.map((section) => (
              <Card key={section} padding="lg">
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
      <section className="mx-auto max-w-5xl pb-10">
        <EmergencyMasthead title={t('title')} subtitle={t('subtitle')} />
        <div className="px-5">
          <Card padding="lg" className="mt-6 text-center">
            <p className="m-0 font-medium text-ink">{t('errorTitle')}</p>
            <Button variant="ghost" className="mt-4" onClick={() => void refetch()}>
              {t('retry')}
            </Button>
          </Card>
        </div>
      </section>
    );
  }

  // Reached only once the GET has settled successfully (isLoading/isError both
  // returned above), so `info` being null here means "settled, no row yet" —
  // synthesize a blank record for the modals rather than passing null through.
  const infoForModals = info ?? synthesizeEmptyEmergencyInfo(circleId);

  const sectionHasData: Record<(typeof SECTIONS)[number]['key'], boolean> = info
    ? {
        doctors: hasDoctors(info),
        contacts: hasContacts(info),
        insurance: hasInsurance(info),
        directives: hasDirectives(info),
      }
    : { doctors: false, contacts: false, insurance: false, directives: false };

  // Header counts for the accordion meta slot (e.g. number of doctors).
  const doctorCount =
    (info?.primary_doctor_name ? 1 : 0) + (info?.additional_doctors?.length ?? 0);
  const contactCount = info?.emergency_contacts?.length ?? 0;
  const insuranceCount = info?.insurance_plans?.length ?? 0;

  // Items + renderItem for the three collapsible sections' shared
  // `EmergencyAccordionSection`. The primary doctor is prepended as its own
  // `DoctorRow` so it renders through the same list as `additional_doctors`.
  const doctorItems: DoctorRow[] = [
    ...(info?.primary_doctor_name
      ? [
          {
            kind: 'primary' as const,
            primary_doctor_name: info.primary_doctor_name,
            primary_doctor_specialty: info.primary_doctor_specialty,
            primary_doctor_phone: info.primary_doctor_phone,
            primary_doctor_country_code: info.primary_doctor_country_code,
            primary_doctor_address: info.primary_doctor_address,
          },
        ]
      : []),
    ...(info?.additional_doctors ?? []).map(
      (doctor, index): DoctorRow => ({ kind: 'additional', index, doctor })
    ),
  ];
  const renderDoctorRow = (row: DoctorRow): ReactNode =>
    row.kind === 'primary' ? (
      <DoctorCard
        name={row.primary_doctor_name as string}
        specialty={row.primary_doctor_specialty}
        phone={row.primary_doctor_phone}
        countryCode={row.primary_doctor_country_code}
        address={row.primary_doctor_address}
        isPrimary
        onEdit={canEdit ? () => setOpenModal({ kind: 'doctor', target: 'primary' }) : undefined}
        onDelete={canEdit ? () => setPendingDelete({ kind: 'doctor-primary' }) : undefined}
      />
    ) : (
      <DoctorCard
        name={row.doctor.name}
        specialty={row.doctor.specialty}
        phone={row.doctor.phone}
        countryCode={row.doctor.country_code}
        address={row.doctor.address}
        onEdit={canEdit ? () => setOpenModal({ kind: 'doctor', target: row.index }) : undefined}
        onDelete={canEdit ? () => setPendingDelete({ kind: 'doctor', index: row.index }) : undefined}
      />
    );

  const contactItems: EmergencyContact[] = info?.emergency_contacts ?? [];
  const renderContactRow = (contact: EmergencyContact, index: number): ReactNode => (
    <ContactCard
      name={contact.name}
      relationship={contact.relationship}
      phone={contact.phone}
      countryCode={contact.country_code}
      isPrimary={contact.is_primary}
      onEdit={canEdit ? () => setOpenModal({ kind: 'contact', index }) : undefined}
      onDelete={canEdit ? () => setPendingDelete({ kind: 'contact', index }) : undefined}
    />
  );

  const insuranceItems: InsurancePlan[] = info?.insurance_plans ?? [];
  const renderInsuranceRow = (plan: InsurancePlan, index: number): ReactNode => (
    <InsuranceCard
      plan={plan}
      onEdit={canEdit ? () => setOpenModal({ kind: 'insurance', index }) : undefined}
      onDelete={canEdit ? () => setPendingDelete({ kind: 'insurance', index }) : undefined}
    />
  );

  // BLOOD TYPE AND ALLERGIES COUNT AS DATA. They render in the at-a-glance tiles
  // (GlanceTiles) rather than in SECTIONS, so neither `sectionHasData` nor
  // `hasConditions` can see them. Leaving them out classified a circle that
  // holds only an allergy list as "fully empty" — and the branch below then
  // showed a VIEW-ONLY member the download CTA instead of "Penicillin". Editors
  // never saw it, because `&& !canEdit` falls through for them.
  const isFullyEmpty =
    !info ||
    (!hasCriticalInfo(info) && SECTIONS.every((section) => !sectionHasData[section.key]));

  // Fully-empty AND can't edit: one clear card with the download CTA. (When the
  // user CAN edit, fall through to the sectioned view so the Add buttons show.)
  if (isFullyEmpty && !canEdit) {
    return (
      <section className="mx-auto max-w-5xl pb-10">
        <EmergencyMasthead title={t('title')} subtitle={t('subtitle')} />
        <div className="px-5">
          <Card padding="lg" className="mt-6 border-dashed">
            <EmptyState
              tone="terracotta"
              icon="medical-outline"
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
        </div>
      </section>
    );
  }

  const generatedDate = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
    new Date()
  );

  return (
    <section className="mx-auto max-w-5xl pb-10">
      {/* Print-only header: whose info this is + when the sheet was generated. */}
      <div className="print-only print-header">
        <p className="text-lg font-semibold">{t('printHeading')}</p>
        {recipientName && <p>{t('preparedFor', { name: recipientName })}</p>}
        <p>{t('printedOn', { date: generatedDate })}</p>
      </div>

      <EmergencyMasthead
        title={t('title')}
        subtitle={t('subtitle')}
        rightAction={canEdit ? editMedicalAction : printAction}
        // Print rides beside Edit in the masthead's own action row (it was a
        // stranded row of its own under the title). Without edit rights Print
        // IS the right action, so nothing doubles up. The masthead marks both
        // slots `data-print-hide` (spec §6.6).
        secondaryAction={canEdit ? printAction : undefined}
      />

      <div className="px-5">
        {/* Section jump links as pills — the same hairline chip the filter rows
            use, not secondary buttons, so the row reads as navigation rather
            than five commands. */}
        <nav aria-label={t('onThisPage')} className="no-print mt-4">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={`${CHIP_BASE} ${CHIP_UNSELECTED} no-underline`}
                >
                  {t(`sections.${section.key}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Read-only notice only when the requester can't edit. */}
        {!canEdit && (
          <Card
            padding="lg"
            className="no-print mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1 bg-bg-2"
          >
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
            />
          )}

          {/* At-a-glance tiles absorb the former Medical Information section
              (Round 7 merge). The Edit affordance now lives in the masthead's
              right action, which keeps the add path reachable even when
              nothing medical is recorded yet (tiles absent). */}
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

          <div className="emergency-sections lg:columns-2 lg:gap-x-8">
            <div className={SECTION_WRAP_CLASS}>
              <EmergencyAccordionSection
                id="doctors"
                title={t('sections.doctors')}
                open={accordion.isOpen('doctors')}
                onToggle={accordion.toggle}
                count={doctorCount}
                items={doctorItems}
                renderItem={renderDoctorRow}
                canEdit={canEdit}
                onAdd={() => setOpenModal({ kind: 'doctor', target: undefined })}
                addLabel={t('edit.addDoctor')}
                emptyMessage={t('empty.doctors')}
              />
            </div>

            <div className={SECTION_WRAP_CLASS}>
              <EmergencyAccordionSection
                id="contacts"
                title={t('sections.contacts')}
                open={accordion.isOpen('contacts')}
                onToggle={accordion.toggle}
                count={contactCount}
                items={contactItems}
                renderItem={renderContactRow}
                canEdit={canEdit}
                onAdd={() => setOpenModal({ kind: 'contact' })}
                addLabel={t('edit.addContact')}
                emptyMessage={t('empty.contacts')}
              />
            </div>

            <div className={SECTION_WRAP_CLASS}>
              <EmergencyAccordionSection
                id="insurance"
                title={t('sections.insurance')}
                open={accordion.isOpen('insurance')}
                onToggle={accordion.toggle}
                count={insuranceCount}
                items={insuranceItems}
                renderItem={renderInsuranceRow}
                canEdit={canEdit}
                onAdd={() => setOpenModal({ kind: 'insurance' })}
                addLabel={t('edit.addInsurance')}
                emptyMessage={t('empty.insurance')}
              />
            </div>

            <EmergencySection
              id="directives"
              title={t('sections.directives')}
              className={SECTION_WRAP_CLASS}
            >
              {sectionHasData.directives && info ? (
                <DirectivesCard hasDnr={!!info.has_dnr} directives={info.advance_directives} />
              ) : (
                <EmptySection message={t('empty.directives')} />
              )}
            </EmergencySection>
          </div>
        </div>
      </div>

      {/* ── Section edit modals (gated on canEdit at the call sites). ── */}
      {openModal?.kind === 'medical' && (
        <EditMedicalInfoModal
          circleId={circleId}
          info={infoForModals}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal?.kind === 'doctor' && (
        <EditDoctorModal
          circleId={circleId}
          info={infoForModals}
          target={openModal.target}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal?.kind === 'contact' && (
        <EditContactModal
          circleId={circleId}
          info={infoForModals}
          index={openModal.index}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal?.kind === 'insurance' && (
        <EditInsuranceModal
          circleId={circleId}
          info={infoForModals}
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
