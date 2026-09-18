const express = require('express');
const router = express.Router();
const pool = require('../db');

// Shapes a raw row into exactly what the frontend's ShortletItem expects
function toShortletItem(row) {
  return {
    id: row.id,
    name: row.name,
    property: row.property_name,
    nightlyRate: parseFloat(row.nightly_rate) || 0,
    status: row.status,
    currentGuest: row.current_guest || undefined,
    checkIn: row.check_in || undefined,
    checkOut: row.check_out || undefined,
    rating: parseFloat(row.rating) || 0,
    amenities: row.amenities || [],
  };
}

// Shapes a raw row into exactly what the frontend's ShortletBooking expects
function toShortletBooking(row) {
  return {
    id: row.id,
    villaId: row.shortlet_unit_id,
    villaName: row.villa_name,
    guestName: row.guest_name,
    guestEmail: row.guest_email || undefined,
    guestPhone: row.guest_phone || undefined,
    source: row.source,
    airbnbReservationCode: row.airbnb_reservation_code || undefined,
    syncMethod: row.sync_method,
    checkIn: row.check_in,
    checkOut: row.check_out,
    nights: Math.round(
      (new Date(row.check_out).getTime() - new Date(row.check_in).getTime()) / (1000 * 60 * 60 * 24)
    ),
    totalPayout: parseFloat(row.total_payout) || 0,
    hostFee: row.host_fee ? parseFloat(row.host_fee) : undefined,
    status: row.status,
  };
}

// GET all shortlet units — matches shortletService.getShortlets()
// Pulls in the current/next booking (if any) for currentGuest/checkIn/checkOut.
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.*,
        p.name AS property_name,
        current_booking.guest_name AS current_guest,
        current_booking.check_in,
        current_booking.check_out
      FROM shortlet_units s
      JOIN properties p ON p.id = s.property_id
      LEFT JOIN LATERAL (
        SELECT * FROM shortlet_bookings b
        WHERE b.shortlet_unit_id = s.id
          AND b.status IN ('Confirmed', 'Checked In', 'Upcoming')
        ORDER BY b.check_in ASC LIMIT 1
      ) current_booking ON true
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows.map(toShortletItem));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET all bookings — matches shortletService.getBookings()
router.get('/bookings', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, s.name AS villa_name
      FROM shortlet_bookings b
      JOIN shortlet_units s ON s.id = b.shortlet_unit_id
      ORDER BY b.check_in DESC
    `);
    res.json(result.rows.map(toShortletBooking));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new shortlet listing
router.post('/', async (req, res) => {
  try {
    const { property_id, name, nightly_rate, max_guests, amenities, listing_expires_on } = req.body;
    const result = await pool.query(
      `INSERT INTO shortlet_units (property_id, name, nightly_rate, max_guests, amenities, listing_expires_on)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [property_id, name, nightly_rate, max_guests || 2, amenities || [], listing_expires_on || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update a shortlet unit's status (Available, Occupied, Turnover)
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const result = await pool.query(
      'UPDATE shortlet_units SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Listing not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create a new booking
router.post('/bookings', async (req, res) => {
  try {
    const {
      shortlet_unit_id, guest_name, guest_email, guest_phone,
      source, airbnb_reservation_code, sync_method,
      check_in, check_out, total_payout, host_fee, status,
    } = req.body;
    const result = await pool.query(
      `INSERT INTO shortlet_bookings
       (shortlet_unit_id, guest_name, guest_email, guest_phone, source, airbnb_reservation_code,
        sync_method, check_in, check_out, total_payout, host_fee, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [shortlet_unit_id, guest_name, guest_email || null, guest_phone || null,
       source || 'DIRECT', airbnb_reservation_code || null, sync_method || 'Direct PropertyPro Pay',
       check_in, check_out, total_payout, host_fee || 0, status || 'Upcoming']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
