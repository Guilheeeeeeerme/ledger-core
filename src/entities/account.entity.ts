import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'accounts' })
export class Account {
  @PrimaryColumn('uuid')
  id: string;

  @Column('text')
  name: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ type: 'bigint' })
  balance: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
