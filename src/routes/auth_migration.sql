-- Run this once in Railway's SQL editor before setting up real login accounts.
-- Links a users row to the specific agent or tenant record it belongs to,
-- so an agent/tenant login lands on THEIR real data, not a placeholder.

ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;
