/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest/presets/default-esm', // Menggunakan preset khusus ESM
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'], // Memberi tahu Jest bahwa .ts adalah modul modern
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true, // Memaksa ts-jest menerjemahkan menggunakan mode ESM
      },
    ],
  },
};