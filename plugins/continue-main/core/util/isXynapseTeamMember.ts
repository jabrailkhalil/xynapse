/**
 * Utility to check if a user is a Xynapse team member
 */
export function isXynapseTeamMember(email?: string): boolean {
  if (!email) return false;
  return email.endsWith("@Xynapse.dev");
}
