import type { Session, User } from '@supabase/supabase-js';

import { getSupabaseClient } from '../../../lib/supabase';
import { isAppRole, type AppRole } from '../domain/roles';

export interface AuthContext {
  user: User | null;
  roles: readonly AppRole[];
}

export interface SignInResult {
  user: User;
  session: Session;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractRoleCode(value: unknown): AppRole | null {
  if (Array.isArray(value)) {
    return value.map(extractRoleCode).find((role): role is AppRole => role !== null) ?? null;
  }
  if (!isRecord(value)) return null;
  return isAppRole(value.code) ? value.code : null;
}

export function parseAssignedRoles(payload: unknown): readonly AppRole[] {
  if (!Array.isArray(payload)) return [];
  const roles = payload
    .map((row) => (isRecord(row) ? extractRoleCode(row.role) : null))
    .filter((role): role is AppRole => role !== null);
  return [...new Set(roles)];
}

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !password) throw new Error('Email e senha são obrigatórios.');

  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
}

export async function getCurrentAuthContext(): Promise<AuthContext> {
  const client = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return { user: null, roles: [] };

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;

  const { data: roleData, error: roleError } = await client
    .from('user_roles')
    .select('role:roles!inner(code)')
    .eq('profile_id', userData.user.id);
  if (roleError) throw roleError;

  return { user: userData.user, roles: parseAssignedRoles(roleData) };
}
