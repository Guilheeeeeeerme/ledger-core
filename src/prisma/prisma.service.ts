import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async ensureSchema() {
    await this.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await execFileAsync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
      env: process.env,
      cwd: process.cwd()
    });
    await this.account.createMany({
      data: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Alice Account',
          currency: 'BRL',
          balance: 100000n
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Bob Account',
          currency: 'BRL',
          balance: 50000n
        }
      ],
      skipDuplicates: true
    });
  }
}
