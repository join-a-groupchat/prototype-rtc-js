/**
 * Utility functions for the consumer application
 * Contains helper functions and common utilities
 */

/**
 * Chunk an array into smaller arrays of specified size
 * @param {Array} arr - Array to chunk
 * @param {number} size - Size of each chunk
 * @returns {Array} Array of chunks
 */
export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Normalize message format from Redis stream
 * @param {Object|Array} message - Raw message from Redis
 * @returns {Object} Normalized message object
 */
export function normalizeMessage(message) {
  const id = message.id ?? message[0];
  let fields = message.message ?? message[1] ?? {};
  
  if (Array.isArray(fields)) {
    fields = Object.fromEntries(chunkArray(fields, 2));
  }
  
  return { id, fields };
}

/**
 * Extract message content with fallbacks
 * @param {Object} fields - Message fields
 * @returns {Object} Extracted content
 */
export function extractMessageContent(fields) {
  return {
    username: fields.user ?? fields.username ?? null,
    content: fields.message ?? fields.content ?? null,
    timestamp: fields.timestamp 
      ? new Date(Number(fields.timestamp)) 
      : new Date()
  };
}

/**
 * Create a delay promise
 * @param {number} ms - Delay in milliseconds
 * @returns {Promise} Promise that resolves after the delay
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format bytes to human readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Human readable size
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get current timestamp in ISO format
 * @returns {string} ISO timestamp string
 */
export function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * Validate if a value is a valid message ID
 * @param {string} id - Message ID to validate
 * @returns {boolean} True if valid message ID
 */
export function isValidMessageId(id) {
  if (!id || typeof id !== 'string') return false;
  
  // Redis stream IDs are in format "timestamp-sequence"
  const idPattern = /^\d+-\d+$/;
  return idPattern.test(id);
}

/**
 * Create a structured log entry
 * @param {string} level - Log level (info, warn, error, debug)
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 * @returns {Object} Structured log entry
 */
export function createLogEntry(level, message, meta = {}) {
  return {
    timestamp: getCurrentTimestamp(),
    level,
    message,
    ...meta
  };
}

/**
 * Safe JSON stringify that handles circular references
 * @param {Object} obj - Object to stringify
 * @param {number} spaces - Number of spaces for indentation
 * @returns {string} JSON string
 */
export function safeStringify(obj, spaces = 2) {
  const seen = new WeakSet();
  
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  }, spaces);
}
