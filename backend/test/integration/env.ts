/**
 * Test environment defaults. Imported first by harness.ts so these are set
 * before src/config/env.ts is evaluated (imports run in order; dotenv never
 * overrides variables that are already set).
 */
process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB ??= 'libraria_test';
process.env.BCRYPT_ROUNDS ??= '10';
process.env.PAYMENTS_MODE ??= 'simulated';
process.env.LOG_LEVEL ??= 'error';
