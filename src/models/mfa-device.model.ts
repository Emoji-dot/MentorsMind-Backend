import { db } from '../config/database';

/**
 * MFA Device Model
 * Represents multi-factor authentication devices for users
 */
export interface MfaDevice {
  id: string;
  userId: string;
  deviceType: 'sms' | 'email' | 'totp' | 'hardware';
  deviceIdentifier: string; // phone number, email, or device ID
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt?: Date;
  verificationCode?: string;
  verificationExpiresAt?: Date;
}

/**
 * MFA Device Database Model
 */
export class MfaDeviceModel {
  /**
   * Create a new MFA device for a user
   */
  static async create(deviceData: Partial<MfaDevice>): Promise<MfaDevice> {
    const query = `
      INSERT INTO mfa_devices (
        user_id, device_type, device_identifier, 
        is_verified, is_active, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;
    
    const values = [
      deviceData.userId,
      deviceData.deviceType,
      deviceData.deviceIdentifier,
      deviceData.isVerified || false,
      deviceData.isActive || true,
    ];

    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Find MFA devices for a user
   */
  static async findByUserId(userId: string): Promise<MfaDevice[]> {
    const query = `
      SELECT * FROM mfa_devices 
      WHERE user_id = $1 AND is_active = true
      ORDER BY created_at DESC
    `;
    
    const result = await db.query(query, [userId]);
    return result.rows;
  }

  /**
   * Find a specific MFA device
   */
  static async findById(id: string): Promise<MfaDevice | null> {
    const query = `
      SELECT * FROM mfa_devices 
      WHERE id = $1 AND is_active = true
    `;
    
    const result = await db.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Update MFA device
   */
  static async update(id: string, updates: Partial<MfaDevice>): Promise<MfaDevice | null> {
    const setClause = Object.keys(updates)
      .map((key, index) => `${this.camelToSnake(key)} = $${index + 2}`)
      .join(', ');
    
    const query = `
      UPDATE mfa_devices 
      SET ${setClause}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    
    const values = [id, ...Object.values(updates)];
    const result = await db.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Delete (deactivate) MFA device
   */
  static async delete(id: string): Promise<boolean> {
    const query = `
      UPDATE mfa_devices 
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
    `;
    
    const result = await db.query(query, [id]);
    return result.rowCount > 0;
  }

  /**
   * Verify MFA device
   */
  static async verify(id: string): Promise<boolean> {
    const query = `
      UPDATE mfa_devices 
      SET is_verified = true, last_used_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `;
    
    const result = await db.query(query, [id]);
    return result.rowCount > 0;
  }

  /**
   * Helper method to convert camelCase to snake_case
   */
  private static camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}