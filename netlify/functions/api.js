// netlify/functions/api.js — Netlify Serverless Entry Point
// Wraps our Express app.js inside serverless-http to run on Netlify Functions

const serverless = require('serverless-http');
const app = require('../../app');

module.exports.handler = serverless(app);
