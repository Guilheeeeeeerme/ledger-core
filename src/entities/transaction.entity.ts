import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'transactions' })
export class LedgerTransaction {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'source_account_id', type: 'uuid' })
  sourceAccountId: string;

  @Column({ name: 'destination_account_id', type: 'uuid' })
  destinationAccountId: string;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'text' })
  status: string;

  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
