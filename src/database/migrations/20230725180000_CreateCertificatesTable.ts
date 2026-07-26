import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateCertificatesTable1689907200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'certificates',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'booking_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 's3_key',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'stellar_tx_hash',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'verification_hash',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'issued_at',
            type: 'timestamp with time zone',
            default: 'now()',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['booking_id'],
            referencedTableName: 'bookings',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
        indices: [
          { columnNames: ['user_id'] },
          { columnNames: ['stellar_tx_hash'] },
        ],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('certificates');
  }
}
