import { messageProcessor } from '../services/messageProcessor.js';
import { jest } from '@jest/globals';

// Mock the config module to isolate from real config
jest.unstable_mockModule('../config/index.js', () => ({
  MESSAGE_CONFIG: {
    FILTERED_WORDS: ['damn', 'hell', 'shit'],
    HISTORY_LIMIT: 50
  }
}));

describe('MessageProcessor', () => {
  describe('filterMessage', () => {
    test('filters profanity from message', () => {
      const input = 'This damn message has shit in it';
      const result = messageProcessor.filterMessage(input);
      expect(result).toBe('This **** message has **** in it');
    });

    test('handles case insensitive filtering', () => {
      const input = 'This DAMN message has SHIT in it';
      const result = messageProcessor.filterMessage(input);
      expect(result).toBe('This **** message has **** in it');
    });

    test('handles word boundaries correctly', () => {
      const input = 'damn helloworld';
      const result = messageProcessor.filterMessage(input);
      expect(result).toBe('**** helloworld'); // damn is filtered, but hello is not hell
    });

    test('returns original message if no profanity', () => {
      const input = 'This is a clean message';
      const result = messageProcessor.filterMessage(input);
      expect(result).toBe(input);
    });

    test('handles null/undefined input', () => {
      expect(messageProcessor.filterMessage(null)).toBe(null);
      expect(messageProcessor.filterMessage(undefined)).toBe(undefined);
    });

    test('handles non-string input', () => {
      expect(messageProcessor.filterMessage(123)).toBe(123);
      expect(messageProcessor.filterMessage({})).toEqual({});
    });
  });

  describe('validateMessage', () => {
    test('validates chat message successfully', () => {
      const input = {
        type: 'chat',
        username: 'testuser',
        message: 'Hello world!'
      };

      const result = messageProcessor.validateMessage(input);

      expect(result).toEqual({
        type: 'chat',
        username: 'testuser',
        message: 'Hello world!'
      });
    });

    test('throws error for invalid message data', () => {
      expect(() => messageProcessor.validateMessage(null)).toThrow('Invalid message data');
      expect(() => messageProcessor.validateMessage('string')).toThrow('Invalid message data');
    });

    test('throws error for missing type', () => {
      const input = { username: 'user', message: 'msg' };
      expect(() => messageProcessor.validateMessage(input)).toThrow('Invalid message type');
    });

    test('throws error for invalid type', () => {
      const input = { type: 'invalid', data: 'something' };
      expect(() => messageProcessor.validateMessage(input)).toThrow('Unknown message type: invalid');
    });

    test('validates chat message - missing username', () => {
      const input = { type: 'chat', message: 'Hello!' };
      expect(() => messageProcessor.validateMessage(input)).toThrow('Invalid username');
    });

    test('validates chat message - empty username', () => {
      const input = { type: 'chat', username: '', message: 'Hello!' };
      expect(() => messageProcessor.validateMessage(input)).toThrow('Invalid username');
    });

    test('validates chat message - whitespace username', () => {
      const input = { type: 'chat', username: '   ', message: 'Hello!' };
      expect(() => messageProcessor.validateMessage(input)).toThrow('Invalid username');
    });

    test('validates chat message - missing message', () => {
      const input = { type: 'chat', username: 'user' };
      expect(() => messageProcessor.validateMessage(input)).toThrow('Invalid message content');
    });

    test('validates chat message - empty message', () => {
      const input = { type: 'chat', username: 'user', message: '' };
      expect(() => messageProcessor.validateMessage(input)).toThrow('Invalid message content');
    });

    test('sanitizes and limits chat message', () => {
      const longMessage = 'a'.repeat(2000);
      const input = {
        type: 'chat',
        username: '  testuser  ',
        message: longMessage
      };

      const result = messageProcessor.validateMessage(input);

      expect(result.username).toBe('testuser'); // trimmed
      expect(result.message.length).toBe(1000); // limited
    });

    test('validates load_more message successfully', () => {
      const input = {
        type: 'load_more',
        before: '2024-01-01T00:00:00.000Z',
        limit: 25
      };

      const result = messageProcessor.validateMessage(input);

      expect(result.type).toBe('load_more');
      expect(result.before).toBeInstanceOf(Date);
      expect(result.limit).toBe(25);
    });

    test('validates load_more message with defaults', () => {
      const input = { type: 'load_more' };

      const result = messageProcessor.validateMessage(input);

      expect(result.type).toBe('load_more');
      expect(result.before).toBeInstanceOf(Date);
      expect(result.limit).toBe(50); // default from MESSAGE_CONFIG
    });

    test('validates load_more - invalid before timestamp', () => {
      const input = { type: 'load_more', before: 'invalid-date' };
      expect(() => messageProcessor.validateMessage(input)).toThrow('Invalid before timestamp');
    });

    test('validates load_more - invalid limit', () => {
      expect(() => messageProcessor.validateMessage({
        type: 'load_more', limit: 0
      })).toThrow('Invalid limit parameter');

      expect(() => messageProcessor.validateMessage({
        type: 'load_more', limit: 101
      })).toThrow('Invalid limit parameter');

      expect(() => messageProcessor.validateMessage({
        type: 'load_more', limit: 'not-a-number'
      })).toThrow('Invalid limit parameter');
    });
  });

  describe('processChatMessage', () => {
    test('processes valid chat message successfully', () => {
      const input = {
        type: 'chat',
        username: 'testuser',
        message: 'Hello damn world!'
      };
      const sourceId = 'server-123';

      const result = messageProcessor.processChatMessage(input, sourceId);

      expect(result).toEqual({
        type: 'chat',
        username: 'testuser',
        message: 'Hello **** world!', // filtered
        source: 'server-123',
        timestamp: expect.any(Number)
      });
    });

    test('throws error for invalid input', () => {
      expect(() => messageProcessor.processChatMessage(null, 'server'))
        .toThrow('Invalid message data');
    });
  });

  describe('createSystemMessage', () => {
    test('creates system message successfully', () => {
      const result = messageProcessor.createSystemMessage('User joined');

      expect(result).toEqual({
        type: 'system',
        message: 'User joined',
        timestamp: expect.any(Number)
      });
    });

    test('trims message content', () => {
      const result = messageProcessor.createSystemMessage('  User joined  ');

      expect(result.message).toBe('User joined');
    });

    test('throws error for invalid input', () => {
      expect(() => messageProcessor.createSystemMessage(null)).toThrow('Invalid system message');
      expect(() => messageProcessor.createSystemMessage(123)).toThrow('Invalid system message');
    });
  });

  describe('createHistoryEndMessage', () => {
    test('creates history end message', () => {
      const result = messageProcessor.createHistoryEndMessage();

      expect(result).toEqual({
        type: 'history_end',
        timestamp: expect.any(Number)
      });
    });
  });

  describe('formatHistoryMessage', () => {
    test('formats database message for history', () => {
      const dbMessage = {
        username: 'user1',
        content: 'Hello world',
        timestamp: '2024-01-01T12:00:00.000Z'
      };

      const result = messageProcessor.formatHistoryMessage(dbMessage);

      expect(result).toEqual({
        type: 'history',
        username: 'user1',
        message: 'Hello world',
        timestamp: 1704110400000 // converted to number
      });
    });

    test('handles null timestamp', () => {
      const dbMessage = {
        username: 'user1',
        content: 'Hello world',
        timestamp: null
      };

      const result = messageProcessor.formatHistoryMessage(dbMessage);

      expect(result.timestamp).toBe(Date.now()); // fallback to current time
    });
  });
});
