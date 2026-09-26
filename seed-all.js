// seed-all.js — populates real data across EVERY tab on your live Railway
// backend: properties, agents, tenants, misconduct, shortlet units,
// bookings, and overheads (for the finance/P&L view).
//
// Run with: node seed-all.js

const BASE = 'https://propertypro-backend-production-ba1d.up.railway.app/api';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function log(step, data) {
  console.log(`\n✅ ${step}`);
  console.log(JSON.stringify(data, null, 2));
}

async function run() {
  console.log('🏠 Seeding full demo data across every PropertyPro tab...\n');

  // --- Agents ---
  const agent1 = await post('/agents', {
    name: 'Ifeoma Chukwu', email: 'ifeoma@example.com', phone: '08012345678',
    specialty: 'Residential', commission_rate: 10, status: 'Active',
  });
  log('Created agent 1', agent1);

  const agent2 = await post('/agents', {
    name: 'Bassey Etim', email: 'bassey@example.com', phone: '08023456789',
    specialty: 'Commercial Agro-Hub', commission_rate: 8, status: 'Active',
  });
  log('Created agent 2', agent2);

  // --- Properties (using the different types) ---
  const property2 = await post('/properties', {
    name: 'Gwarinpa Close', address: 'Gwarinpa Close', city: 'Abuja',
    country: 'Nigeria', currency: 'NGN', type: 'Residential', units: 3,
    agent_id: agent1.id,
  });
  log('Created property 2 (Residential)', property2);

  const property3 = await post('/properties', {
    name: 'Elele Farm Estate', address: 'Elele Road', city: 'Port Harcourt',
    country: 'Nigeria', currency: 'NGN', type: 'Farmland', units: 1,
    agent_id: agent2.id,
  });
  log('Created property 3 (Farmland)', property3);

  const property4 = await post('/properties', {
    name: 'Marina View Villas', address: 'Marina Road', city: 'Port Harcourt',
    country: 'Nigeria', currency: 'NGN', type: 'Shortlet Villa', units: 2,
    agent_id: agent1.id,
  });
  log('Created property 4 (Shortlet Villa)', property4);

  // --- Tenants (in the residential property) ---
  const tenant1 = await post('/tenants', {
    property_id: property2.id, name: 'Tunde Bello', email: 'tunde@example.com',
    phone: '08087654321', rent_amount: 300000, rent_cycle: 'quarterly',
    multi_year_eligible: true,
  });
  log('Created tenant 1', tenant1);

  const tenant2 = await post('/tenants', {
    property_id: property2.id, name: 'Grace Effiong', email: 'grace@example.com',
    phone: '08098765432', rent_amount: 280000, rent_cycle: 'quarterly',
    multi_year_eligible: false,
  });
  log('Created tenant 2', tenant2);

  // --- A payment + mark it paid (triggers commission) ---
  const payment1 = await post('/payments', {
    tenant_id: tenant1.id, amount_due: 300000,
    period_start: '2027-01-01', period_end: '2027-03-31',
  });
  await post(`/payments/${payment1.id}/mark-paid`, {
    amount_paid: 300000, paystack_ref: 'demo_ref_002',
  });
  log('Tenant 1 payment marked paid (commission auto-created)', { payment1 });

  // --- A misconduct strike ---
  await post(`/tenants/${tenant2.id}/misconduct`, {
    offenseTitle: 'Noise complaint', description: 'Loud music past midnight, reported by neighbor.',
    penaltyAmount: 5000,
  });
  log('Added misconduct strike to tenant 2', { tenant: tenant2.name });

  // --- Shortlet unit + a booking ---
  const shortlet1 = await post('/shortlet', {
    property_id: property4.id, name: 'Marina View Studio', nightly_rate: 45000,
    max_guests: 2, amenities: ['WiFi', 'Generator', 'Pool'],
    listing_expires_on: '2027-12-31',
  });
  log('Created shortlet unit', shortlet1);

  await post('/shortlet/bookings', {
    shortlet_unit_id: shortlet1.id, guest_name: 'Michael Adeyemi',
    guest_email: 'michael@example.com', source: 'AIRBNB',
    airbnb_reservation_code: 'HMABC123', sync_method: 'Airbnb API v2',
    check_in: '2027-02-10', check_out: '2027-02-14',
    total_payout: 180000, host_fee: 9000, status: 'Confirmed',
  });
  log('Created a shortlet booking', { unit: shortlet1.name });

  // --- Overheads for the finance/P&L view ---
  await put(`/finance/overheads/${property2.id}`, {
    maintenance: 15000, power: 20000, internet: 8000, cleaningSecurity: 12000,
  });
  log('Set this month\'s overheads for Gwarinpa Close', {});

  console.log('\n🎉 Full demo data seeded across every tab:');
  console.log('   Properties (4 total, 3 types), Agents (2), Tenants (2, with 1 misconduct strike),');
  console.log('   a paid payment with auto-commission, a shortlet unit with an Airbnb booking,');
  console.log('   and this month\'s overheads for the P&L view.');
}

run().catch(err => {
  console.error('\n❌ Seed failed:', err.message);
});
