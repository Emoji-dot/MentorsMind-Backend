import { logger } from '../utils/logger.utils';

/**
 * SMS Service Interface
 */
export interface SmsMessage {
  to: string;
  body: string;
  from?: string;
}

/**
 * SMS Service Response
 */
export interface SmsResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * SMS Service Configuration
 */
export interface SmsConfig {
  provider: 'twilio' | 'aws' | 'mock';
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  region?: string;
}

/**
 * SMS Service
 * Handles sending SMS messages for notifications and MFA
 */
export class SmsService {
  private config: SmsConfig;

  constructor(config: SmsConfig) {
    this.config = config;
  }

  /**
   * Send SMS message
   */
  async sendSms(message: SmsMessage): Promise<SmsResponse> {
    try {
      logger.info('SMS Service: Sending SMS', {
        to: message.to,
        bodyLength: message.body.length,
        provider: this.config.provider,
      });

      switch (this.config.provider) {
        case 'twilio':
          return this.sendViaTwilio(message);
        case 'aws':
          return this.sendViaAWS(message);
        case 'mock':
          return this.sendViaMock(message);
        default:
          throw new Error(`Unsupported SMS provider: ${this.config.provider}`);
      }
    } catch (error) {
      logger.error('SMS Service: Failed to send SMS', { error, message });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send SMS via Twilio
   */
  private async sendViaTwilio(message: SmsMessage): Promise<SmsResponse> {
    // Twilio implementation would go here
    // For now, return mock response
    logger.info('SMS Service: Twilio provider not yet implemented, using mock');
    return this.sendViaMock(message);
  }

  /**
   * Send SMS via AWS SNS
   */
  private async sendViaAWS(message: SmsMessage): Promise<SmsResponse> {
    // AWS SNS implementation would go here
    // For now, return mock response
    logger.info('SMS Service: AWS provider not yet implemented, using mock');
    return this.sendViaMock(message);
  }

  /**
   * Send SMS via Mock (for testing)
   */
  private async sendViaMock(message: SmsMessage): Promise<SmsResponse> {
    logger.info('SMS Service: Mock SMS sent', {
      to: message.to,
      body: message.body.substring(0, 50) + '...',
    });

    return {
      success: true,
      messageId: `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };
  }

  /**
   * Send MFA verification code via SMS
   */
  async sendMfaCode(phoneNumber: string, code: string): Promise<SmsResponse> {
    const message: SmsMessage = {
      to: phoneNumber,
      body: `Your MentorMinds verification code is: ${code}. This code will expire in 10 minutes.`,
      from: this.config.fromNumber,
    };

    return this.sendSms(message);
  }

  /**
   * Send notification SMS
   */
  async sendNotification(phoneNumber: string, message: string): Promise<SmsResponse> {
    const smsMessage: SmsMessage = {
      to: phoneNumber,
      body: message,
      from: this.config.fromNumber,
    };

    return this.sendSms(smsMessage);
  }

  /**
   * Validate phone number format
   */
  static validatePhoneNumber(phoneNumber: string): boolean {
    // Basic E.164 format validation
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber);
  }

  /**
   * Format phone number to E.164
   */
  static formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-digit characters
    const digits = phoneNumber.replace(/\D/g, '');
    
    // Add + prefix if not present
    if (!phoneNumber.startsWith('+')) {
      // Assume US number if 10 digits, otherwise add +
      if (digits.length === 10) {
        return `+1${digits}`;
      } else {
        return `+${digits}`;
      }
    }
    
    return phoneNumber;
  }
}

/**
 * Default SMS Service instance
 */
export const smsService = new SmsService({
  provider: process.env.SMS_PROVIDER as any || 'mock',
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumber: process.env.TWILIO_FROM_NUMBER,
  region: process.env.AWS_REGION,
});