import type { Role } from '../data/types';

/** Where each role lands after signing in. */
export function homeFor(role: Role): string {
  return role === 'agent' ? '/home' : role === 'supervisor' ? '/team' : '/overview';
}
