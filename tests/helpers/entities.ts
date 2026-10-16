import {
  Column,
  DeleteDateColumn,
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TenantScoped } from '../../src';

@TenantScoped()
@Entity()
export class Invoice {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  tenantId!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'varchar', default: 'open' })
  status!: string;

  @Column({ type: 'integer', default: 0 })
  amount!: number;

  @OneToMany(() => Payment, (payment) => payment.invoice)
  payments!: Payment[];

  @DeleteDateColumn()
  deletedAt!: Date | null;
}

/** Tenant-scoped through a non-default column, to prove the column is configurable. */
@TenantScoped({ column: 'orgId' })
@Entity()
export class Note {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  orgId!: string;

  @Column({ type: 'varchar' })
  text!: string;
}

/** Global reference data: shared by all tenants, deliberately not tenant-scoped. */
@Entity()
export class Country {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  name!: string;
}

/** Tenant-scoped child of an invoice, to exercise relations and joins. */
@TenantScoped()
@Entity()
export class Payment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  tenantId!: string;

  @Column({ type: 'integer' })
  cents!: number;

  @ManyToOne(() => Invoice, (invoice) => invoice.payments)
  invoice!: Invoice;
}
