import type { HelpContent } from '../types';

/** Test fixture in the plan's HelpContent shape (content.json may not exist yet). */
export const HELP_FIXTURE: HelpContent = {
  generated: '2026-10-24',
  categories: [
    { id: 'getting-started', label: { en: 'Getting started', es: 'Primeros pasos' } },
    { id: 'care', label: { en: 'Daily care', es: 'Cuidado diario' } },
    { id: 'empty', label: { en: 'Empty', es: 'Vacía' } },
  ],
  popular: ['add-a-medication', 'invite-family', 'missing-slug'],
  articles: {
    en: [
      {
        slug: 'add-a-medication',
        category: 'care',
        title: 'Add a medication',
        summary: 'Add a medicine and its reminder times.',
        steps: ['Open Medications.', 'Tap Add.'],
        body: '## Good to know\n\n- Reminders follow the **recipient** time zone.\n\nSee [Invite family](/help/invite-family/) or [our site](https://circlecare.app/help/).',
        related: ['invite-family', 'missing-slug'],
        keywords: ['pill', 'dose'],
        video: { file: 'add-a-medication-en.mp4', durationSec: 42 },
        poster: 'add-a-medication-en.jpg',
      },
      {
        slug: 'invite-family',
        category: 'getting-started',
        title: 'Invite family',
        summary: 'Send an invite by email.',
        body: '1. Open Members.\n2. Tap Invite.',
        related: ['add-a-medication'],
      },
    ],
    es: [
      {
        slug: 'add-a-medication',
        category: 'care',
        title: 'Agregar un medicamento',
        summary: 'Agrega un medicamento y sus horarios.',
        body: 'Cuerpo en español.',
        related: [],
        keywords: ['medicación'],
        video: { file: 'add-a-medication-es.mp4', durationSec: 40 },
        poster: 'add-a-medication-es.jpg',
      },
      {
        slug: 'invite-family',
        category: 'getting-started',
        title: 'Invitar a la familia',
        summary: 'Envía una invitación por correo.',
        body: '',
        related: [],
      },
    ],
  },
};
