import type { InterceptorConfig } from '../config/config.js';
import type { Sf } from './sf.js';

export class ProductionGuardError extends Error {}

export interface GuardResult {
  orgId: string;
  instanceUrl: string;
  organizationType: string;
  isSandbox: boolean;
  username: string;
}

/**
 * Refuses to continue unless the alias points at the expected demo org:
 * same org ID, same instance URL, and an allowed organization type (Developer Edition by default).
 * Runs before every org operation.
 */
export async function guardDemoOrg(sf: Sf, config: InterceptorConfig): Promise<GuardResult> {
  const display = await sf.orgDisplay();
  const [org] = await sf.query<{ Id: string; IsSandbox: boolean; OrganizationType: string }>(
    'SELECT Id, IsSandbox, OrganizationType FROM Organization',
  );
  const problems: string[] = [];
  if (display.id !== config.org.expectedOrgId) problems.push(`org ID ${display.id} ≠ ${config.org.expectedOrgId}`);
  if (display.instanceUrl !== config.org.expectedInstanceUrl) {
    problems.push(`instance ${display.instanceUrl} ≠ ${config.org.expectedInstanceUrl}`);
  }
  if (!org || !config.org.allowedOrganizationTypes.includes(org.OrganizationType)) {
    problems.push(`organization type ${org?.OrganizationType ?? 'unknown'} is not allowed`);
  }
  if (problems.length) {
    throw new ProductionGuardError(
      `Refusing to run: alias "${config.org.alias}" is not the configured demo org (${problems.join('; ')}).`,
    );
  }
  return {
    orgId: display.id,
    instanceUrl: display.instanceUrl,
    organizationType: org!.OrganizationType,
    isSandbox: org!.IsSandbox,
    username: display.username,
  };
}
