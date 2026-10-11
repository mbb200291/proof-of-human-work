#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { verifyReplayReceipt } = require('../out/replay-proof.js');
(async () => {
  const [root, receiptFile, keyFile, journal] = process.argv.slice(2);
  if (!root || !receiptFile || !keyFile || !journal || process.argv.length !== 6) {
    throw new Error('Usage: node scripts/verify-event-log.cjs <repository> <receipt.json> <public-key.pem> <events.jsonl>');
  }
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  const key = fs.readFileSync(keyFile, 'utf8');
  const report = await verifyReplayReceipt(path.resolve(root), receipt, key, journal);
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(`PoHW replay verification FAILED: ${error.message}`); process.exitCode = 1; });
