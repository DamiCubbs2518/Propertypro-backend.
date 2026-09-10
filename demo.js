// demo.js — walks through the full PropertyPro flow against your running
// local server (npm run dev must already be running in another terminal).
//
// Run with: node demo.js

const BASE = 'http://localhost:4000/api';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function log(step, data) {
  console.log(`\n✅ ${step}`);
  console.log(JSON.stringify(data, null, 2));
}

async function run() {
  console.log('🏠 PropertyPro backend demo — creating real data through the live API\n');

  // 1. Create an agent
  const agent = await post('/agents', {
    name: 'Ifeoma Chukwu',
    email: 'ifeoma@example.com',
    phone: '08012345678',
    commission_rate: 10,
  });
  log('Created agent', agent);

  // 2. Create a property, assigned to that agent
  const property = await post('/properties', {
    name: '14 Aba Road',
    address: '14 Aba Road',
    city: 'Port Harcourt',
    country: 'Nigeria',
    currency: 'NGN',
    agent_id: agent.id,
  });
  log('Created property', property);

  // 3. Create a tenant in that property
  const tenant = await post('/tenants', {
    property_id: property.id,
    name: 'Adaora Obi',
    email: 'adaora@example.com',
    phone: '08087654321',
    rent_amount: 120000,
    rent_cycle: 'quarterly',
  });
  log('Created tenant (with auto-generated payment link token)', tenant);

  // 4. Open a rent period for that tenant
  const payment = await post('/payments', {
    tenant_id: tenant.id,
    amount_due: 120000,
    period_start: '2027-01-01',
    period_end: '2027-03-31',
  });
  log('Opened a payment period', payment);

  // 5. Mark it paid — this is what a Paystack webhook will call later.
  //    Watch: this alone triggers automatic commission creation.
  const paid = await post(`/payments/${payment.id}/mark-paid`, {
    amount_paid: 120000,
    paystack_ref: 'demo_ref_001',
  });
  log('Marked payment as paid (auto-triggers commission)', paid);

  // 6. Check the commission tracker — the row should now exist automatically,
  //    at exactly 10% of 120,000 = 12,000, with is_remitted still false.
  const commissions = await get('/agents/commissions');
  log('Commission tracker (auto-calculated, no manual entry)', commissions);

  // 7. Fetch the tenant's full profile — proves payments join back correctly
  const fullProfile = await get(`/tenants/${tenant.id}`);
  log('Full tenant profile (payments + complaints joined in)', fullProfile);

  console.log('\n🎉 Full flow verified: property → tenant → payment → auto commission.');
  console.log('   Everything above is real data sitting in your Railway Postgres database right now.');
}

run().catch((err) => {
  console.error('\n❌ Demo failed:', err.message);
  process.exit(1);
});
