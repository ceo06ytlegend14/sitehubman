// Jest setup — keep minimal. Per-test mocks live next to the tests.
// Prevent the real Firebase app from initialising if a test imports it transitively.
jest.mock('./src/services/firebaseClient', () => ({
  db: {},
  auth: {},
}));
