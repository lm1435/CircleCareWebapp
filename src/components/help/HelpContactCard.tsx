import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text } from '@/components/ui';

/** "Still need help?" card with the support mailto, shared by the help home and category page. */
export function HelpContactCard({ className }: { className?: string }): ReactElement {
  const { t } = useTranslation('help');
  return (
    <Card variant="filled" padding="lg" className={className} data-testid="help-contact-card">
      <Text variant="h3" as="h2">
        {t('contact.title')}
      </Text>
      <Text variant="caption" className="mt-1">
        {t('contact.body')}
      </Text>
      <Button as="a" href={`mailto:${t('contact.email')}`} variant="primary" className="mt-4">
        {t('contact.cta')}
      </Button>
    </Card>
  );
}
