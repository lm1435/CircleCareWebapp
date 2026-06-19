import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/users.ts (subset needed by phase 1).
// The apiClient response interceptor already unwraps to the
// `{ success, data, error }` envelope, so `response.data.user` is the payload.

export interface NotificationPreferences {
  medication_confirmations: boolean;
  missed_medications: boolean;
  task_assignments: boolean;
  appointment_reminders: boolean;
  activity_updates: boolean;
  chat_messages: boolean;
  note_nudges: boolean;
}

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  timezone?: string;
  language?: string; // User's preferred language (en, es)
  notification_preferences: NotificationPreferences;
  created_at: string;
  updated_at: string;
}

export interface UpdateProfileRequest {
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  timezone?: string;
  language?: string;
}

interface UserEnvelope {
  success: boolean;
  data: { user: User };
}

export async function getCurrentUser(): Promise<User> {
  const response = (await apiClient.get('/users/me')) as unknown as UserEnvelope;
  return response.data.user;
}

export async function updateProfile(data: UpdateProfileRequest): Promise<User> {
  const response = (await apiClient.patch('/users/me', data)) as unknown as UserEnvelope;
  return response.data.user;
}
