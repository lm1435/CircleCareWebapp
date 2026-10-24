import {
  isInvalidAssigneeError,
  isShiftAssignForbiddenError,
  isShiftDropForbiddenError,
  isShiftInvalidDateError,
  isShiftNotAssignedError,
  isShiftNotFoundError,
  isShiftTakenError,
  shiftTakenBy,
} from '@/api/shifts';
import { isPermissionDeniedError, isSubscriptionRequiredError } from '@/lib/apiErrors';

// ONE failure copy for every shift write, mirroring mobile's
// `utils/shiftErrors.ts` `describeShiftFailure` (same kinds, same keys, same
// words). A `specific` failure closes the dialog and toasts; an `other` one (a
// network or server failure) stays inline in the still-open dialog so the action
// can be retried.

export type ShiftFailureKind =
  | 'already_taken'
  | 'not_assigned'
  | 'drop_forbidden'
  | 'assign_forbidden'
  | 'invalid_assignee'
  | 'not_found'
  | 'permission'
  | 'subscription'
  | 'other';

export type ShiftVerb = 'take' | 'drop' | 'assign' | 'edit' | 'save' | 'delete';

export function classifyShiftFailure(err: unknown): ShiftFailureKind {
  if (isShiftTakenError(err)) return 'already_taken';
  if (isShiftNotAssignedError(err)) return 'not_assigned';
  if (isShiftDropForbiddenError(err)) return 'drop_forbidden';
  if (isShiftAssignForbiddenError(err)) return 'assign_forbidden';
  if (isInvalidAssigneeError(err)) return 'invalid_assignee';
  if (isShiftNotFoundError(err) || isShiftInvalidDateError(err)) return 'not_found';
  if (isSubscriptionRequiredError(err)) return 'subscription';
  if (isPermissionDeniedError(err)) return 'permission';
  return 'other';
}

/** `t` is bound to the `shifts` namespace (keys like `toast.notFound`). */
type ShiftsT = (key: string, opts?: Record<string, unknown>) => string;

export function describeShiftFailure(
  t: ShiftsT,
  err: unknown,
  verb: ShiftVerb
): { kind: ShiftFailureKind; message: string; specific: boolean } {
  const kind = classifyShiftFailure(err);
  switch (kind) {
    case 'already_taken': {
      const takenBy = shiftTakenBy(err);
      return {
        kind,
        specific: true,
        message: takenBy ? t('toast.alreadyTaken', { takenBy }) : t('toast.alreadyTakenUnknown'),
      };
    }
    case 'not_assigned':
      // Dropping what nobody holds = "already open"; any other action lost a race with a drop / assign.
      return {
        kind,
        specific: true,
        message: verb === 'drop' ? t('toast.alreadyOpen') : t('toast.notAssigned'),
      };
    case 'not_found':
      return { kind, specific: true, message: t('toast.notFound') };
    case 'drop_forbidden':
      return { kind, specific: true, message: t('error.dropForbidden') };
    case 'assign_forbidden':
      return { kind, specific: true, message: t('error.assignForbidden') };
    case 'invalid_assignee':
      return { kind, specific: true, message: t('error.invalidAssignee') };
    case 'permission':
      return { kind, specific: true, message: t('error.permissionDenied') };
    case 'subscription':
      // The paywall / owner notice is the feedback; no toast.
      return { kind, specific: false, message: '' };
    default:
      return {
        kind,
        specific: false,
        message:
          verb === 'take'
            ? t('error.take')
            : verb === 'drop'
              ? t('error.drop')
              : verb === 'assign'
                ? t('error.assign')
                : verb === 'delete'
                  ? t('error.delete')
                  : t('error.save'),
      };
  }
}
