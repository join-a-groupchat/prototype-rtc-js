import { LOG_CONFIG } from '../config/index.js';

class Logger {
  constructor() {
    this.colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      underscore: '\x1b[4m',
      blink: '\x1b[5m',
      reverse: '\x1b[7m',
      hidden: '\x1b[8m',
      black: '\x1b[30m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m',
      bgBlack: '\x1b[40m',
      bgRed: '\x1b[41m',
      bgGreen: '\x1b[42m',
      bgYellow: '\x1b[43m',
      bgBlue: '\x1b[44m',
      bgMagenta: '\x1b[45m',
      bgCyan: '\x1b[46m',
      bgWhite: '\x1b[47m'
    };
  }

  /**
   * Format a log message with timestamp and color
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {string} color - Color code
   * @returns {string} Formatted log message
   */
  formatMessage(level, message, color = this.colors.white) {
    const timestamp = new Date().toISOString();
    const prefix = LOG_CONFIG.COLORS ? `${color}[${timestamp}] [${level}]${this.colors.reset}` : `[${timestamp}] [${level}]`;
    return `${prefix} ${message}`;
  }

  /**
   * Log an info message
   * @param {string} message - The message to log
   */
  info(message) {
    if (LOG_CONFIG.LEVEL === 'info' || LOG_CONFIG.LEVEL === 'debug') {
      console.log(this.formatMessage('INFO', message, this.colors.cyan));
    }
  }

  /**
   * Log a success message
   * @param {string} message - The message to log
   */
  success(message) {
    console.log(this.formatMessage('SUCCESS', message, this.colors.green));
  }

  /**
   * Log a warning message
   * @param {string} message - The message to log
   */
  warn(message) {
    console.warn(this.formatMessage('WARN', message, this.colors.yellow));
  }

  /**
   * Log an error message
   * @param {string} message - The message to log
   */
  error(message) {
    console.error(this.formatMessage('ERROR', message, this.colors.red));
  }

  /**
   * Log a debug message
   * @param {string} message - The message to log
   */
  debug(message) {
    if (LOG_CONFIG.LEVEL === 'debug') {
      console.log(this.formatMessage('DEBUG', message, this.colors.dim));
    }
  }

  /**
   * Log a chat message
   * @param {string} username - Username
   * @param {string} message - The message content
   */
  chat(username, message) {
    console.log(this.formatMessage('CHAT', `${username}: ${message}`, this.colors.blue));
  }

  /**
   * Log a system message
   * @param {string} message - The system message
   */
  system(message) {
    console.log(this.formatMessage('SYSTEM', message, this.colors.magenta));
  }
}

// Create and export a singleton instance
export const logger = new Logger();

export default logger;
