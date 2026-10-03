import { Inject } from '@nestjs/common';
import { ObjectLiteral } from 'typeorm';
import { EntityClass } from '../repository/entity-class';
import { getTenantRepositoryToken } from './tokens';

/**
 * Injects the `TenantRepository` of an entity registered with `TenantGuardModule.forFeature`:
 *
 * ```ts
 * constructor(@InjectTenantRepository(Invoice) private readonly invoices: TenantRepository<Invoice>) {}
 * ```
 */
export function InjectTenantRepository(entity: EntityClass<ObjectLiteral>): ParameterDecorator {
  return Inject(getTenantRepositoryToken(entity));
}
