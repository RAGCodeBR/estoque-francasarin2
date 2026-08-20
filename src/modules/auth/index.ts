export {
  getCurrentAuthContext,
  parseAssignedRoles,
  signInWithPassword,
  signOut,
} from './application/auth-service';
export {
  APP_PERMISSIONS,
  APP_ROLES,
  hasPermission,
  isAppRole,
  permissionsForRoles,
} from './domain/roles';
export type { AuthContext, SignInResult } from './application/auth-service';
export type { AppPermission, AppRole } from './domain/roles';
