import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddDeletionColumnsToUsers1689907200001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('users', [
      new TableColumn({
        name: 'deletion_requested_at',
        type: 'timestamp with time zone',
        isNullable: true,
      }),
      new TableColumn({
        name: 'deletion_anonymized_at',
        type: 'timestamp with time zone',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'deletion_requested_at');
    await queryRunner.dropColumn('users', 'deletion_anonymized_at');
  }
}
