import { assertTestDatabase, TEST_DATABASE_URL } from "./test-env";

assertTestDatabase(TEST_DATABASE_URL);
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  SHOPIFY_API_KEY: "test-api-key",
  SHOPIFY_API_SECRET: "test-api-secret-0123456789",
  SHOPIFY_APP_URL: "https://app.example.test",
  SCOPES: "",
  APP_SIGNING_SECRET: "test-signing-secret-0123456789abcdef",
  EMAIL_PROVIDER: "log",
  RUN_JOBS_IN_PROCESS: "false",
});
