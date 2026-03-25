-- PC Assistant 데이터베이스 스키마
-- 실행: psql -U <user> -d <dbname> -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              VARCHAR(255) UNIQUE NOT NULL,
  password_hash      VARCHAR(255) NOT NULL,
  plan               VARCHAR(20) NOT NULL DEFAULT 'free',
  stripe_customer_id VARCHAR(255) UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
  status                 VARCHAR(50) NOT NULL,
  current_period_end     TIMESTAMPTZ NOT NULL,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_usage (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date     DATE NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
