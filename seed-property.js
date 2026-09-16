// seed-property.js — adds one real property to your LIVE Railway backend
// so you can watch it appear in the frontend in real time.
//
// Run with: node seed-property.js

const BASE = 'https://propertypro-backend-production-ba1d.up.railway.app/api';

async function run() {
  const res = await fetch(`${BASE}/properties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '14 Aba Road',
      address: '14 Aba Road',
      city: 'Port Harcourt',
      country: 'Nigeria',
      currency: 'NGN',
      type: 'Residential',
      units: 3,
    }),
  });
  const data = await res.json();
  console.log('Created property on the LIVE backend:');
  console.log(JSON.stringify(data, null, 2));
}

run().catch(err => console.error('Failed:', err.message));
