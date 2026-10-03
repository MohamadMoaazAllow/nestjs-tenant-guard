import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TenantScoped } from 'nestjs-tenant-guard';

/** Tenant-scoped: every row belongs to exactly one tenant. */
@TenantScoped({ column: 'tenantId' })
@Entity()
export class Invoice {
  @PrimaryGeneratedColumn()
  id!: number;

  // Stamped automatically on insert; never set it by hand.
  @Column({ type: 'varchar' })
  tenantId!: string;

  @Column({ type: 'varchar' })
  title!: string;
}
