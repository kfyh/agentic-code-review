import { isError, isErrorWithMessage } from '../src/shared/typeGuards';

describe('typeGuards Module', () => {
  test('isError identifies Error instances correctly', () => {
    expect(isError(new Error('test'))).toBe(true);
    expect(isError(new TypeError('type error'))).toBe(true);
    expect(isError('just a string')).toBe(false);
    expect(isError({ message: 'fake error' })).toBe(false);
    expect(isError(null)).toBe(false);
    expect(isError(undefined)).toBe(false);
  });

  test('isErrorWithMessage identifies objects containing string message property', () => {
    expect(isErrorWithMessage({ message: 'Error occurred' })).toBe(true);
    expect(isErrorWithMessage({ message: 'Error', stderr: 'some stderr' })).toBe(true);
    expect(isErrorWithMessage(new Error('native error'))).toBe(true);
    expect(isErrorWithMessage({ message: 123 })).toBe(false);
    expect(isErrorWithMessage('plain text')).toBe(false);
    expect(isErrorWithMessage(null)).toBe(false);
    expect(isErrorWithMessage(undefined)).toBe(false);
  });
});
