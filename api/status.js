/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

// Vercel serverless function. GET /api/status: whether the AI is switched on (never the key).
const { handlers } = require('../src/http');

module.exports = (req, res) => handlers().status(req, res);
