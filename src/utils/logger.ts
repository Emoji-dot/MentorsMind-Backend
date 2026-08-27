/**
 * Simple Logger Utility
 * Provides consistent logging across services
 */

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  public info(message: string, ...args: any[]): void {
    console.log(`[INFO] [${this.context}] ${message}`, ...args);
  }

  public debug(message: string, ...args: any[]): void {
    console.log(`[DEBUG] [${this.context}] ${message}`, ...args);
  }

  public warn(message: string, ...args: any[]): void {
    console.warn(`[WARN] [${this.context}] ${message}`, ...args);
  }

  public error(message: string, ...args: any[]): void {
    console.error(`[ERROR] [${this.context}] ${message}`, ...args);
  }
}
