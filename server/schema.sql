-- PC Assistant 데이터베이스 스키마
-- 실행: psql -U <user> -d <dbname> -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              VARCHAR(255) UNIQUE NOT NULL,
  password_hash      VARCHAR(255) NOT NULL,
  plan               VARCHAR(20) NOT NULL DEFAULT 'free',
  stripe_customer_id VARCHAR(255) UNIQUE,
  polar_customer_id  VARCHAR(255) UNIQUE,
  email_verified_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 이 컬럼을 처음 추가할 때만 기존 계정을 인증 완료 상태로 보존한다.
-- 이후 생성되는 계정은 이메일 인증 전까지 NULL을 유지한다.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ALTER COLUMN email_verified_at DROP DEFAULT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS polar_customer_id VARCHAR(255);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  provider               VARCHAR(20) NOT NULL DEFAULT 'legacy',
  provider_subscription_id VARCHAR(255) NOT NULL,
  provider_product_id    VARCHAR(255),
  provider_updated_at    TIMESTAMPTZ,
  status                 VARCHAR(50) NOT NULL,
  current_period_end     TIMESTAMPTZ NOT NULL,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기존 Stripe 명칭 컬럼은 과거 데이터 호환용으로 보존하고 결제 공급자 컬럼으로 이관한다.
ALTER TABLE subscriptions ALTER COLUMN stripe_subscription_id DROP NOT NULL;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'legacy';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_subscription_id VARCHAR(255);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_product_id VARCHAR(255);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS provider_updated_at TIMESTAMPTZ;
UPDATE subscriptions
   SET provider_subscription_id = stripe_subscription_id
 WHERE provider_subscription_id IS NULL;
ALTER TABLE subscriptions ALTER COLUMN provider_subscription_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash  VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts   INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE TABLE IF NOT EXISTS chat_usage (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date     DATE NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at
  ON email_verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_polar_customer_id
  ON users(polar_customer_id) WHERE polar_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_id
  ON subscriptions(provider, provider_subscription_id);
