-- CreateTable
CREATE TABLE "event_logs" (
    "id" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledgers" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "debit" DECIMAL(18,4),
    "credit" DECIMAL(18,4),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "event_logs_idempotencyKey_key" ON "event_logs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "event_logs_aggregateId_version_idx" ON "event_logs"("aggregateId", "version");

-- CreateIndex
CREATE INDEX "event_logs_eventType_idx" ON "event_logs"("eventType");

-- CreateIndex
CREATE INDEX "event_logs_timestamp_idx" ON "event_logs"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "event_logs_aggregateId_version_key" ON "event_logs"("aggregateId", "version");
