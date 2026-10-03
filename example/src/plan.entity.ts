import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Global reference data shared by every tenant: deliberately NOT tenant-scoped. */
@Entity()
export class Plan {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar' })
  name!: string;
}
