-- ==========================================================
-- PropertyPro — Expanded PostgreSQL Schema
-- Now covers: multi-type properties (incl. farmland/agro-hub),
-- agents with specialty/status, tenant misconduct strikes,
-- maintenance complaints with priority, Airbnb-style shortlet
-- bookings, and property-level profit & loss overheads.
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------
-- Users (login accounts: admin, agent, or tenant)
-- ----------------------------------------------------------
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin', -- admin, agent, tenant
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Agents
-- ----------------------------------------------------------
CREATE TABLE agents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    name              TEXT NOT NULL,
    email             TEXT UNIQUE,
    phone             TEXT,
    specialty         TEXT,                     -- e.g. "Farmland", "Shortlet Villas"
    commission_rate   NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    status            TEXT NOT NULL DEFAULT 'Active', -- Active, On Leave
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Properties (now covers farmland, agro-hub, shortlet villas too)
-- ----------------------------------------------------------
CREATE TABLE properties (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    address         TEXT NOT NULL,
    city            TEXT NOT NULL,
    country         TEXT NOT NULL DEFAULT 'Nigeria',
    currency        TEXT NOT NULL DEFAULT 'NGN',
    type            TEXT NOT NULL DEFAULT 'Residential',
                    -- Farmland, Residential, Commercial, Commercial Agro-Hub, Shortlet Villa
    units           INTEGER NOT NULL DEFAULT 1,
    occupied_units  INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'Active', -- Active, Under Maintenance, Coming Soon
    agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
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
    rent_amount         NUMERIC(12,2) NOT NULL,
    rent_cycle          TEXT NOT NULL DEFAULT 'monthly',
    multi_year_eligible BOOLEAN NOT NULL DEFAULT FALSE, -- "ability to pay for more than a year"
    payment_link_token  TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Payments
-- ----------------------------------------------------------
CREATE TABLE payments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    amount_due        NUMERIC(12,2) NOT NULL,
    amount_paid       NUMERIC(12,2) NOT NULL DEFAULT 0,
    period_start      DATE NOT NULL,
    period_end        DATE NOT NULL,
    lease_period_label TEXT,               -- display label, e.g. "Jan – Mar 2027"
    status            TEXT NOT NULL DEFAULT 'pending', -- pending, paid, overdue
    receipt_number    TEXT,
    paystack_ref      TEXT,
    paid_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Commissions
-- ----------------------------------------------------------
CREATE TABLE commissions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    amount_owed   NUMERIC(12,2) NOT NULL,
    is_remitted   BOOLEAN NOT NULL DEFAULT FALSE,
    remitted_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Tenant misconduct strikes
-- ----------------------------------------------------------
CREATE TABLE misconduct_records (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    offense_title     TEXT NOT NULL,
    description       TEXT,
    penalty_amount    NUMERIC(12,2),
    proof_image_url   TEXT,
    occurred_at       DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Maintenance complaints (expanded from the earlier simple complaints table)
-- ----------------------------------------------------------
CREATE TABLE maintenance_complaints (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    property_id   UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    category      TEXT NOT NULL DEFAULT 'Other',
                  -- Plumbing, Electrical, Irrigation / Well, Structural, Gate & Security, Other
    description   TEXT NOT NULL,
    priority      TEXT NOT NULL DEFAULT 'Medium', -- Low, Medium, High, Emergency
    status        TEXT NOT NULL DEFAULT 'Submitted',
                  -- Submitted, In Review, Technician Assigned, Resolved
    submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Shortlet units (listings)
-- ----------------------------------------------------------
CREATE TABLE shortlet_units (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id         UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    nightly_rate        NUMERIC(12,2) NOT NULL,
    max_guests          INTEGER NOT NULL DEFAULT 2,
    rating              NUMERIC(2,1) DEFAULT 0,
    amenities           TEXT[],             -- e.g. {"WiFi","Pool","Generator"}
    status              TEXT NOT NULL DEFAULT 'Available', -- Available, Occupied, Turnover
    listing_expires_on  DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Shortlet bookings (Airbnb sync or direct)
-- ----------------------------------------------------------
CREATE TABLE shortlet_bookings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shortlet_unit_id        UUID NOT NULL REFERENCES shortlet_units(id) ON DELETE CASCADE,
    guest_name              TEXT NOT NULL,
    guest_email             TEXT,
    guest_phone             TEXT,
    source                  TEXT NOT NULL DEFAULT 'DIRECT', -- AIRBNB, DIRECT
    airbnb_reservation_code TEXT,
    sync_method             TEXT DEFAULT 'Direct PropertyPro Pay',
                            -- Airbnb API v2, iCal Sync, Direct PropertyPro Pay
    check_in                DATE NOT NULL,
    check_out               DATE NOT NULL,
    total_payout            NUMERIC(12,2) NOT NULL,
    host_fee                NUMERIC(12,2) DEFAULT 0,
    status                  TEXT NOT NULL DEFAULT 'Upcoming',
                            -- Confirmed, Checked In, Completed, Upcoming
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------
-- Property overheads (feeds the Profit & Loss breakdown)
-- One row per property per reporting month.
-- ----------------------------------------------------------
CREATE TABLE property_overheads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    period_month      DATE NOT NULL,          -- store as first-of-month, e.g. 2027-01-01
    maintenance       NUMERIC(12,2) NOT NULL DEFAULT 0,
    power             NUMERIC(12,2) NOT NULL DEFAULT 0,
    internet          NUMERIC(12,2) NOT NULL DEFAULT 0,
    cleaning_security NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (property_id, period_month)
);

-- ----------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------
CREATE INDEX idx_tenants_property ON tenants(property_id);
CREATE INDEX idx_payments_tenant ON payments(tenant_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_commissions_agent ON commissions(agent_id);
CREATE INDEX idx_commissions_remitted ON commissions(is_remitted);
CREATE INDEX idx_properties_agent ON properties(agent_id);
CREATE INDEX idx_shortlet_property ON shortlet_units(property_id);
CREATE INDEX idx_misconduct_tenant ON misconduct_records(tenant_id);
CREATE INDEX idx_maintenance_tenant ON maintenance_complaints(tenant_id);
CREATE INDEX idx_maintenance_property ON maintenance_complaints(property_id);
CREATE INDEX idx_bookings_unit ON shortlet_bookings(shortlet_unit_id);
CREATE INDEX idx_overheads_property ON property_overheads(property_id);

