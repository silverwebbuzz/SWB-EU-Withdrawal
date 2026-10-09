-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `scope` TEXT NULL,
    `expires` DATETIME(3) NULL,
    `accessToken` TEXT NOT NULL,
    `userId` BIGINT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `accountOwner` BOOLEAN NOT NULL DEFAULT false,
    `locale` VARCHAR(191) NULL,
    `collaborator` BOOLEAN NULL DEFAULT false,
    `emailVerified` BOOLEAN NULL DEFAULT false,
    `refreshToken` TEXT NULL,
    `refreshTokenExpires` DATETIME(3) NULL,

    INDEX `Session_shop_idx`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shop` (
    `id` VARCHAR(191) NOT NULL,
    `shopDomain` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `ianaTimezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `currencyCode` VARCHAR(191) NULL,
    `installedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `uninstalledAt` DATETIME(3) NULL,
    `requestCounter` INTEGER NOT NULL DEFAULT 0,
    `proxyLastSeenAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Shop_shopDomain_key`(`shopDomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopSettings` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `timezoneOverride` VARCHAR(191) NULL,
    `defaultLocale` VARCHAR(191) NOT NULL DEFAULT 'en',
    `defaultFormId` VARCHAR(191) NULL,
    `buttonLabel` VARCHAR(191) NOT NULL DEFAULT 'Withdraw from contract',
    `buttonHelpText` TEXT NULL,
    `buttonBgColor` VARCHAR(191) NOT NULL DEFAULT '#1a1a1a',
    `buttonTextColor` VARCHAR(191) NOT NULL DEFAULT '#ffffff',
    `merchantNotificationEmails` TEXT NULL,
    `replyToEmail` VARCHAR(191) NULL,
    `sendStatusChangeEmails` BOOLEAN NOT NULL DEFAULT false,
    `withdrawalPeriodDays` INTEGER NOT NULL DEFAULT 14,
    `withdrawalPeriodNote` TEXT NULL,
    `orderLookupEnabled` BOOLEAN NOT NULL DEFAULT false,
    `orderTaggingEnabled` BOOLEAN NOT NULL DEFAULT false,
    `orderTag` VARCHAR(191) NOT NULL DEFAULT 'withdrawal-requested',
    `rateLimitPerHour` INTEGER NOT NULL DEFAULT 5,
    `minFillSeconds` INTEGER NOT NULL DEFAULT 3,
    `retentionDays` INTEGER NOT NULL DEFAULT 0,
    `setupBlockConfirmed` BOOLEAN NOT NULL DEFAULT false,
    `setupLegalReviewed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShopSettings_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Form` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `draftSchema` JSON NOT NULL,
    `draftUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedVersionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Form_publishedVersionId_key`(`publishedVersionId`),
    INDEX `Form_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FormVersion` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `formId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `schema` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FormVersion_shopId_idx`(`shopId`),
    UNIQUE INDEX `FormVersion_formId_version_key`(`formId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WithdrawalRequest` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `requestNumber` VARCHAR(191) NOT NULL,
    `formVersionId` VARCHAR(191) NULL,
    `status` ENUM('REQUESTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED') NOT NULL DEFAULT 'REQUESTED',
    `customerName` VARCHAR(191) NULL,
    `customerEmail` VARCHAR(191) NOT NULL,
    `customerEmailNorm` VARCHAR(191) NOT NULL,
    `orderReference` VARCHAR(191) NULL,
    `orderVerification` ENUM('VERIFIED', 'UNVERIFIED', 'NOT_FOUND') NOT NULL DEFAULT 'UNVERIFIED',
    `shopifyOrderId` VARCHAR(191) NULL,
    `shopifyCustomerId` VARCHAR(191) NULL,
    `orderProcessedAt` DATETIME(3) NULL,
    `locale` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `archivedAt` DATETIME(3) NULL,
    `orderTaggedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WithdrawalRequest_shopId_status_archivedAt_idx`(`shopId`, `status`, `archivedAt`),
    INDEX `WithdrawalRequest_shopId_submittedAt_idx`(`shopId`, `submittedAt`),
    INDEX `WithdrawalRequest_shopId_customerEmailNorm_idx`(`shopId`, `customerEmailNorm`),
    INDEX `WithdrawalRequest_shopId_orderReference_idx`(`shopId`, `orderReference`),
    UNIQUE INDEX `WithdrawalRequest_shopId_requestNumber_key`(`shopId`, `requestNumber`),
    UNIQUE INDEX `WithdrawalRequest_shopId_idempotencyKey_key`(`shopId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WithdrawalAnswer` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `fieldId` VARCHAR(191) NOT NULL,
    `fieldType` VARCHAR(191) NOT NULL,
    `label` TEXT NOT NULL,
    `value` JSON NOT NULL,
    `adminOnly` BOOLEAN NOT NULL DEFAULT false,
    `position` INTEGER NOT NULL,

    INDEX `WithdrawalAnswer_shopId_idx`(`shopId`),
    UNIQUE INDEX `WithdrawalAnswer_requestId_fieldId_key`(`requestId`, `fieldId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequestStatusHistory` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `fromStatus` ENUM('REQUESTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED') NULL,
    `toStatus` ENUM('REQUESTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED') NULL,
    `actor` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RequestStatusHistory_shopId_requestId_idx`(`shopId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InternalNote` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `author` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InternalNote_shopId_requestId_idx`(`shopId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `kind` ENUM('CUSTOMER_CONFIRMATION', 'MERCHANT_NOTIFICATION', 'STATUS_CHANGE') NOT NULL,
    `subject` TEXT NOT NULL,
    `body` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmailTemplate_shopId_kind_key`(`shopId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailLog` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `toAddress` TEXT NOT NULL,
    `replyTo` VARCHAR(191) NULL,
    `subject` TEXT NOT NULL,
    `bodyText` TEXT NOT NULL,
    `bodyHtml` TEXT NOT NULL,
    `status` ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastError` TEXT NULL,
    `providerId` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `EmailLog_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `EmailLog_shopId_requestId_idx`(`shopId`, `requestId`),
    UNIQUE INDEX `EmailLog_shopId_dedupeKey_key`(`shopId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RateLimitHit` (
    `id` VARCHAR(191) NOT NULL,
    `keyHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RateLimitHit_keyHash_createdAt_idx`(`keyHash`, `createdAt`),
    INDEX `RateLimitHit_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProcessedWebhook` (
    `webhookId` VARCHAR(191) NOT NULL,
    `shopDomain` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(191) NOT NULL,
    `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProcessedWebhook_processedAt_idx`(`processedAt`),
    PRIMARY KEY (`webhookId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrivacyDataRequest` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `customerEmail` VARCHAR(191) NULL,
    `shopifyCustomerId` VARCHAR(191) NULL,
    `requestCount` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PrivacyDataRequest_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ShopSettings` ADD CONSTRAINT `ShopSettings_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Form` ADD CONSTRAINT `Form_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Form` ADD CONSTRAINT `Form_publishedVersionId_fkey` FOREIGN KEY (`publishedVersionId`) REFERENCES `FormVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FormVersion` ADD CONSTRAINT `FormVersion_formId_fkey` FOREIGN KEY (`formId`) REFERENCES `Form`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WithdrawalRequest` ADD CONSTRAINT `WithdrawalRequest_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WithdrawalRequest` ADD CONSTRAINT `WithdrawalRequest_formVersionId_fkey` FOREIGN KEY (`formVersionId`) REFERENCES `FormVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WithdrawalAnswer` ADD CONSTRAINT `WithdrawalAnswer_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `WithdrawalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestStatusHistory` ADD CONSTRAINT `RequestStatusHistory_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestStatusHistory` ADD CONSTRAINT `RequestStatusHistory_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `WithdrawalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalNote` ADD CONSTRAINT `InternalNote_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InternalNote` ADD CONSTRAINT `InternalNote_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `WithdrawalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailTemplate` ADD CONSTRAINT `EmailTemplate_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailLog` ADD CONSTRAINT `EmailLog_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmailLog` ADD CONSTRAINT `EmailLog_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `WithdrawalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrivacyDataRequest` ADD CONSTRAINT `PrivacyDataRequest_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

