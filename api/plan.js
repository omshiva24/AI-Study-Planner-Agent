/*! AI Study Planner Agent · © 2026 P Om Shiva (M.Tech CSE, Pondicherry University). All rights reserved. Copying or reuse without written permission is not allowed. */
'use strict';

// Vercel serverless function. POST /api/plan: the agent builds a new study plan (PLAN → ACT → CHECK).
const { handlers } = require('../src/http');

module.exports = (req, res) => handlers().plan(req, res);
