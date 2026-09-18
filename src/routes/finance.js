const express = require('express');
const router = express.Router();
const pool = require('../db');

// Shapes a raw row into exactly what the frontend's ProfitLossBreakdown expects
function toProfitLossBreakdown(row) {
  const gross = parseFloat(row.gross_revenue) || 0;
  const overheads = {
    maintenance: parseFloat(row.maintenance) || 0,
    power: parseFloat(row.power) || 0,
    internet: parseFloat(row.internet) || 0,
    cleaningSecurity: parseFloat(row.cleaning_security) || 0,
  };
  const totalOverheads = overheads.maintenance + overheads.power + overheads.internet + overheads.cleaningSecurity;
  const netProfit = gross - totalOverheads;
  const netMargin = gross > 0 ? (netProfit / gross) * 100 : 0;

  return {
    estateId: row.id,
    estateName: row.name,
    type: row.type,
    grossRevenue: gross,
    overheads,
    netProfit,
    netMargin: parseFloat(netMargin.toFixed(2)),
  };
}

// GET profit & loss breakdown per property, for the current month —
// matches financeService.getProfitLossData()
router.get('/profit-loss', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id, p.name, p.type,
        COALESCE((
          SELECT SUM(t.rent_amount) FROM tenants t WHERE t.property_id = p.id
        ), 0) AS gross_revenue,
        COALESCE(po.maintenance, 0) AS maintenance,
        COALESCE(po.power, 0) AS power,
        COALESCE(po.internet, 0) AS internet,
        COALESCE(po.cleaning_security, 0) AS cleaning_security
      FROM properties p
      LEFT JOIN property_overheads po
        ON po.property_id = p.id
        AND po.period_month = date_trunc('month', CURRENT_DATE)::date
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows.map(toProfitLossBreakdown));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT set/update this month's overheads for a property (owner enters these manually)
router.put('/overheads/:propertyId', async (req, res) => {
  try {
    const { maintenance, power, internet, cleaningSecurity } = req.body;
    const result = await pool.query(`
      INSERT INTO property_overheads (property_id, period_month, maintenance, power, internet, cleaning_security)
      VALUES ($1, date_trunc('month', CURRENT_DATE)::date, $2, $3, $4, $5)
      ON CONFLICT (property_id, period_month)
      DO UPDATE SET maintenance = $2, power = $3, internet = $4, cleaning_security = $5
      RETURNING *
    `, [req.params.propertyId, maintenance || 0, power || 0, internet || 0, cleaningSecurity || 0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
