import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, RadioGroup, Spinner, useToast, type RadioOption } from '@/components/ui';
import { useCircles } from '@/hooks/useCircles';
import { useSelectDowngradeCircle } from '@/hooks/useSubscriptionStatus';

/**
 * Downgrade circle-selection flow (web parity with mobile's CircleSelectionScreen).
 *
 * When a premium owner of 2+ circles downgrades, they must pick the ONE circle to
 * keep with free access; the rest become read-only. Two steps in one modal:
 * select → confirm (the choice is permanent until they re-subscribe). On success
 * the mutation invalidates subscription-status + circles, so the banner that
 * opened this modal auto-hides.
 */
export function CircleSelectionModal({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('freemium');
  const { showToast } = useToast();
  const { data: circles, isLoading } = useCircles();
  const select = useSelectDowngradeCircle();

  const owned = useMemo(() => (circles ?? []).filter((c) => c.role === 'owner'), [circles]);
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [selectedId, setSelectedId] = useState<string>('');

  const selectedCircle = owned.find((c) => c.id === selectedId);

  const options: RadioOption[] = owned.map((c) => ({
    value: c.id,
    label: c.name,
    hint: `${c.recipient_name} · ${t('circleSelection.memberCount', { count: c.member_count })}`,
  }));

  const handleKeep = (): void => {
    if (!selectedId) return;
    select.mutate(selectedId, {
      onSuccess: () => onClose(), // banner auto-hides once needsCircleSelection flips
      onError: () => showToast(t('circleSelection.error'), 'error'),
    });
  };

  return (
    <Modal
      title={t(step === 'select' ? 'circleSelection.title' : 'circleSelection.confirmTitle')}
      onClose={onClose}
      closeLabel={t('circleSelection.close')}
      closeOnBackdropClick={false}
      footer={
        step === 'select' ? (
          <div className="flex justify-end">
            <Button disabled={!selectedId} onClick={() => setStep('confirm')}>
              {t('circleSelection.confirmButton')}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <Button variant="ghost" disabled={select.isPending} onClick={() => setStep('select')}>
              {t('circleSelection.back')}
            </Button>
            <Button variant="terracotta" disabled={select.isPending} onClick={handleKeep}>
              {t('circleSelection.confirmKeep')}
            </Button>
          </div>
        )
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner size={28} />
        </div>
      ) : step === 'select' ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-ink-3">{t('circleSelection.subtitle')}</p>
          <RadioGroup
            label={t('circleSelection.title')}
            options={options}
            value={selectedId}
            onChange={setSelectedId}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-base font-semibold text-ink">{selectedCircle?.name}</p>
          <p className="m-0 text-sm text-ink-2">{t('circleSelection.confirmMessage')}</p>
        </div>
      )}
    </Modal>
  );
}
