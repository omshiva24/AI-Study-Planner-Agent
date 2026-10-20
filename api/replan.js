/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

// Vercel serverless function. POST /api/replan: evening check-in, re-plans what is left.
const { handlers } = require('../src/http');

module.exports = (req, res) => handlers().replan(req, res);
