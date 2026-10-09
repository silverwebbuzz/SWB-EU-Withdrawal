export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "mysql://swb:swb_dev_password@127.0.0.1:3307/swb_withdrawal_test";

export function assertTestDatabase(url: string) {
  // Guard against wiping a real database: tests truncate every table.
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Refusing to run tests against a non-test database: ${new URL(url).pathname}`);
  }
}
