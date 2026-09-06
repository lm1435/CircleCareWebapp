import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Eyebrow, Text } from '@/components/ui';
import type { CircleMember } from '@/api/circleMembers';

// Spec §6.3.1 — port of mobile CircleDetailScreen's hero
// (`styles.hero` / `avatarWrapper` / `dobEyebrow` / `heroName` /
// `caredForByRow`, CircleDetailScreen.tsx:1121-1157 + 1976-2037).
//
// Padding, ring, glow and the 12/6/6 vertical rhythm are mobile's numbers
// verbatim; the only translation is px→Tailwind (pt-6 = 24, px-7 = 28,
// pb-[18px] = 18, mb-3 = 12, mb-1.5 = 6).

/**
 * Age in whole years from a YYYY-MM-DD date of birth, computed in UTC.
 *
 * PORT of mobile's `computeAge` (CircleDetailScreen.tsx:~100) including its
 * UTC-only arithmetic: a birthday is a calendar fact, not an instant, so
 * reading it through the viewer's local zone can shift it a day and age the
 * person a year early or late on their birthday. Returns null for anything
 * that is not a real date, so a malformed value hides the eyebrow rather than
 * rendering "age NaN".
 */
export function computeAge(dob: string, now: Date = new Date()): number | null {
  const parsed = new Date(`${dob.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  let age = now.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - parsed.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < parsed.getUTCDate())) {
    age -= 1;
  }
  if (age < 0 || age > 130) return null;
  return age;
}

/** The recipient's DOB rendered in the viewer's locale, anchored at noon UTC. */
function formatDob(dob: string, locale: string): string | null {
  const parsed = new Date(`${dob.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return parsed.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dob.slice(0, 10);
  }
}

/** First name, falling back to the email — mobile's `caregiverFirstNames`. */
function firstNameOf(member: CircleMember): string {
  return member.first_name || member.email;
}

export interface HeroProps {
  recipientName: string;
  recipientPhotoUrl?: string | null;
  /** YYYY-MM-DD, or null when the circle has no date of birth on file. */
  recipientDob?: string | null;
  members: CircleMember[];
}

/**
 * The circle Home hero: avatar, DOB eyebrow, name, "Cared for by" row.
 *
 * SELF-CARE CIRCLES SHOW THE SAME NAME as everyone else. Mobile renders
 * `circle.recipient_name` unconditionally, and on a self-care circle that
 * field already holds the owner's own name — so there is no self-care branch
 * here either. Web's old "Your care space" title was a web-only invention.
 *
 * The caregiver list EXCLUDES the care recipient (they are not caring for
 * themselves in this row) and shows at most three names, mobile's cap.
 */
export function Hero({
  recipientName,
  recipientPhotoUrl,
  recipientDob,
  members,
}: HeroProps): ReactElement {
  const { t, i18n } = useTranslation('overview');

  const age = recipientDob ? computeAge(recipientDob) : null;
  const bornLabel = recipientDob ? formatDob(recipientDob, i18n.language) : null;
  const dobEyebrow =
    bornLabel !== null && age !== null ? t('hero.bornAge', { date: bornLabel, age }) : null;

  const caregiverNames = members.filter((m) => !m.is_care_recipient).map(firstNameOf);
  const shown = caregiverNames.slice(0, 3);
  const overflow = caregiverNames.length - shown.length;

  return (
    <header className="flex flex-col items-center px-7 pt-6 pb-[18px]">
      {/* 4px cream ring + moss glow, mobile `avatarWrapper`. The ring lives on
          the wrapper rather than the Avatar's own `bordered` (2px) because
          mobile's is 4. */}
      <div className="mb-3 rounded-full ring-4 ring-cream shadow-avatar-glow">
        <Avatar size="xl" name={recipientName} photoUrl={recipientPhotoUrl ?? null} />
      </div>

      {dobEyebrow ? (
        <Eyebrow color="ink-2" className="mb-1.5">
          {dobEyebrow}
        </Eyebrow>
      ) : null}

      <Text variant="heroName" className="mb-1.5">
        {recipientName}
      </Text>

      {shown.length > 0 ? (
        <p className="m-0 flex flex-wrap justify-center gap-x-1 text-sm text-ink-2">
          <span>{t('hero.caredForBy')}</span>
          {shown.map((name, i) => (
            <span key={name} className="font-semibold text-ink">
              {i < shown.length - 1 ? `${name},` : name}
            </span>
          ))}
          {overflow > 0 ? <span>{t('hero.andMore', { count: overflow })}</span> : null}
        </p>
      ) : null}
    </header>
  );
}

export default Hero;
