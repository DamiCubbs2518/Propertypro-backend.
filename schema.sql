-- ==========================================================
-- PropertyPro / Rent Collection System — PostgreSQL Schema
-- (Agents + commission tracking restored)
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ----------------------------------------------------------
-- Users (owner/admin who logs into the dashboard)
-- ----------------------------------------------------------
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin', -- admin, agent
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Agents (manage properties, earn commission)
-- ----------------------------------------------------------
CREATE TABLE agents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID REFERENCES users(id) ON DELETE SET NULL, -- login account, if they have one
    name              TEXT NOT NULL,
    email             TEXT UNIQUE,
    phone             TEXT,
    commission_rate   NUMERIC(5,2) NOT NULL DEFAULT 10.00, -- percent
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Properties (PHC, Abuja, UK)
-- ----------------------------------------------------------
CREATE TABLE properties (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,           -- e.g. "14 Aba Road"
    address       TEXT NOT NULL,
    city          TEXT NOT NULL,           -- Port Harcourt, Abuja, London...
    country       TEXT NOT NULL DEFAULT 'Nigeria', -- Nigeria, UK
    currency      TEXT NOT NULL DEFAULT 'NGN',     -- NGN or GBP
    agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Tenants
-- ----------------------------------------------------------
CREATE TABLE tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    email               TEXT,
    phone               TEXT,
    rent_amount         NUMERIC(12,2) NOT NULL,   -- editable per dashboard
    rent_cycle          TEXT NOT NULL DEFAULT 'monthly', -- monthly, quarterly, yearly
    payment_link_token  TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Payments (each rent period's charge + status)
-- ----------------------------------------------------------
CREATE TABLE payments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    amount_due        NUMERIC(12,2) NOT NULL,
    amount_paid       NUMERIC(12,2) NOT NULL DEFAULT 0,
    period_start      DATE NOT NULL,
    period_end        DATE NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending', -- pending, paid, overdue
    paystack_ref      TEXT,          -- transaction reference from Paystack
    paid_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Commissions (agent earnings per payment, remit tracking)
-- ----------------------------------------------------------
CREATE TABLE commissions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    amount_owed   NUMERIC(12,2) NOT NULL,
    is_remitted   BOOLEAN NOT NULL DEFAULT FALSE, -- the checkbox on the dashboard
    remitted_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Shortlet units (short-term listings, separate from monthly rent)
-- ----------------------------------------------------------
CREATE TABLE shortlet_units (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,          -- e.g. "Marina View Studio"
    nightly_rate      NUMERIC(12,2) NOT NULL,
    max_guests        INTEGER NOT NULL DEFAULT 2,
    is_available      BOOLEAN NOT NULL DEFAULT TRUE,
    listing_expires_on DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Complaints / enquiries (tenant-raised, tied to a tenant)
-- ----------------------------------------------------------
CREATE TABLE complaints (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subject       TEXT NOT NULL,
    message       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'open', -- open, resolved
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Indexes for common dashboard queries
-- ----------------------------------------------------------
CREATE INDEX idx_tenants_property ON tenants(property_id);
CREATE INDEX idx_payments_tenant ON payments(tenant_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_commissions_agent ON commissions(agent_id);
CREATE INDEX idx_commissions_remitted ON commissions(is_remitted);
CREATE INDEX idx_properties_agent ON properties(agent_id);
CREATE INDEX idx_shortlet_property ON shortlet_units(property_id);
CREATE INDEX idx_complaints_tenant ON complaints(tenant_id);
