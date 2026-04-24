// Manual mock for expo-sqlite (native module — not available in Jest environment)
const mockDb = {
  execAsync: jest.fn().mockResolvedValue(undefined),
  runAsync: jest.fn().mockResolvedValue(undefined),
  getFirstAsync: jest.fn().mockResolvedValue(null),
  getAllAsync: jest.fn().mockResolvedValue([]),
  prepareAsync: jest.fn().mockResolvedValue({
    executeAsync: jest.fn().mockResolvedValue(undefined),
    finalizeAsync: jest.fn().mockResolvedValue(undefined),
  }),
  withTransactionAsync: jest.fn((fn) => fn()),
  closeAsync: jest.fn().mockResolvedValue(undefined),
};

module.exports = {
  openDatabaseAsync: jest.fn().mockResolvedValue(mockDb),
  deleteDatabaseAsync: jest.fn().mockResolvedValue(undefined),
  SQLiteDatabase: jest.fn(),
};
