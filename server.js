'use strict';
try { require('dotenv').config(); } catch(e) {}

const express = require('express');
const path    = require('path');
const app     = require('./app');

// Serve all static frontend files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for frontend routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start local server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 9jaCash Backend & Frontend Server running on port ${PORT}`);
  console.log(`🔒 Paystack Secret Key status: ${process.env.PAYSTACK_SECRET_KEY ? 'Loaded ✅' : 'MISSING ❌'}`);
});
