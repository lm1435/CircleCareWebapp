import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, useToast } from '@/components/ui';
import { updateUnitPreferences } from '@/api/users';
import { useUnitPreferences } from '@/hooks/useUnitPreferences';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { browserRegion } from '@/lib/regionResolver';
import { useAuthStore } from '@/store/authStore';
import {
  forgetVitalUnitsPrompt,
  markVitalUnitsPromptShown,
  recordVitalUnitsPromptOutcome,
  vitalUnitsPromptOffer,
  type VitalUnitsPromptOffer,
} from '@/lib/vitalUnitsPrompt';

/** Lets the page settle before asking (never the first thing it does). Mobile uses the same delay. */
export const VITAL_UNITS_PROMPT_DELAY_MS = 700;

/** Is any other dialog on screen (this page's add / edit / delete, or an app-level one)? */
function anotherDialogOpen(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.querySelector('[role="dialog"], [aria-modal="true"]');
  } catch {
    return false;
  }
}

/**
 * The one-time "Use kg and °C?" question on the Vitals page (lib/vitalUnitsPrompt). `busy` is the
 * page's own modal state; any open dialog in the document also holds it back. Mobile twin:
 * mobile/src/hooks/useVitalUnitsPrompt.ts.
 */
export function VitalUnitsPrompt({ busy }: { busy: boolean }): ReactElement | null {
  const { t } = useTranslation(['vitals', 'common']);
  const { showToast } = useToast();
  const userId = useAuthStore((s) => (s.isAuthenticated ? (s.user?.id ?? null) : null));
  const { data: prefs } = useUnitPreferences();
  const [offer, setOffer] = useState<VitalUnitsPromptOffer | null>(null);
  const [saving, setSaving] = useState(false);
  // At most one question per page visit (a failed switch forgets the flag; it asks NEXT visit).
  const askedRef = useRef(false);

  useEffect(() => {
    if (askedRef.current || offer || busy || !userId || !prefs) return;
    const timer = setTimeout(() => {
      if (anotherDialogOpen()) return;
      const next = vitalUnitsPromptOffer({ userId, region: browserRegion(), prefs });
      if (!next) return;
      askedRef.current = true;
      markVitalUnitsPromptShown(userId, next.group);
      setOffer(next);
    }, VITAL_UNITS_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [offer, busy, userId, prefs]);

  if (!offer || !userId) return null;
  const units = {
    weight: offer.target.weight_unit,
    temperature: offer.target.temperature_unit,
    glucose: offer.target.glucose_unit,
  };

  const close = (outcome: 'kept' | 'dismissed') => {
    recordVitalUnitsPromptOutcome(userId, offer.group, outcome);
    setOffer(null);
  };

  const handleSwitch = async () => {
    setSaving(true);
    try {
      const updated = await updateUnitPreferences(offer.target);
      queryClient.setQueryData(queryKeys.unitPreferences, updated);
      recordVitalUnitsPromptOutcome(userId, offer.group, 'switched');
    } catch {
      // They said yes: ask again next visit rather than strand them on lbs.
      forgetVitalUnitsPrompt(userId);
      showToast(t('common:errors.saveFailed'), 'error');
    } finally {
      setSaving(false);
      setOffer(null);
    }
  };

  return (
    <ConfirmDialog
      title={t('unitsPrompt.title', units)}
      message={
        offer.target.glucose_unit === 'mmol/L'
          ? t('unitsPrompt.messageGlucose', units)
          : t('unitsPrompt.message', units)
      }
      confirmLabel={t('unitsPrompt.switch')}
      cancelLabel={t('unitsPrompt.keep', { weight: 'lbs', temperature: '°F' })}
      // The × closes WITHOUT choosing (dismissed), so it must not read as "Keep".
      closeLabel={t('common:close')}
      offlineKind="change"
      loading={saving}
      onConfirm={handleSwitch}
      onCancel={() => close('kept')}
      onDismiss={() => close('dismissed')}
    />
  );
}
