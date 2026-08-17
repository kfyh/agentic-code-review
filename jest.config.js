/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/main/**/*.ts', 'src/shared/**/*.ts', '!src/main/index.ts'],
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/mocks/electronMock.js',
  },
  clearMocks: true,
};
