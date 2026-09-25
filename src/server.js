require('dotenv').config();
const express = require('express');
const cors = require('cors');

const propertiesRouter = require('./routes/properties');
const tenantsRouter = require('./routes/tenants');
const paymentsRouter = require('./routes/payments');
const agentsRouter = require('./routes/agents');
const shortletRouter = require('./routes/shortlet');
const complaintsRouter = require('./routes/complaints');
const financeRouter = require('./routes/finance');
const authRouter = require('./routes/auth');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/properties', propertiesRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/shortlet', shortletRouter);
app.use('/api/complaints', complaintsRouter);
app.use('/api/finance', financeRouter);
app.use('/api/auth', authRouter);

app.get('/', (req, res) => res.send('PropertyPro API is running'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`PropertyPro API running on port ${PORT}`));
