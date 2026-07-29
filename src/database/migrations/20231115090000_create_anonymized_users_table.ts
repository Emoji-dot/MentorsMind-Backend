import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

export class CreateAnonymizedUsersTable20231115090000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'anonymized_users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'original_user_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'anonymized_id',
            type: 'varchar',
            isUnique: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      })
    );
    await queryRunner.createForeignKey(
      'anonymized_users',
      new TableForeignKey({
        columnNames: ['original_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('anonymized_users');
    if (table) {
      const fk = table.foreignKeys.find((fk) => fk.columnNames.includes('original_user_id'));
      if (fk) await queryRunner.dropForeignKey('anonymized_users', fk);
    }
    await queryRunner.dropTable('anonymized_users');
  }
}
