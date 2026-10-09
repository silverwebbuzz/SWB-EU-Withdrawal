-- Separate database for the integration test suite so tests never touch dev data.
-- Prisma Migrate also needs CREATE/DROP rights for its temporary shadow database.
CREATE DATABASE IF NOT EXISTS swb_withdrawal_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON *.* TO 'swb'@'%';
FLUSH PRIVILEGES;
