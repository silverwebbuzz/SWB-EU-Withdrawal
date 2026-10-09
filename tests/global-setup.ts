import { execSync } from "node:child_process";
import { assertTestDatabase, TEST_DATABASE_URL } from "./test-env";

export default function setup() {
  assertTestDatabase(TEST_DATABASE_URL);
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
