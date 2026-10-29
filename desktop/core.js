'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'];
const MAX_BODY = 64 * 1024;
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
function validEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e) || e.version !== 1) return false;
  const required = { id: 128, time: 64, source: 128, event: 128, session_id: 256, cwd: 1024 };
  for (const [k, max] of Object.entries(required)) if (typeof e[k] !== 'string' || e[k].length > max || (['id','time','source','event'].includes(k) && !e[k])) return false;
  if (Number.isNaN(Date.parse(e.time))) return false;
  for (const k of ['turn_id','tool_name']) if (e[k] !== undefined && (typeof e[k] !== 'string' || e[k].length > 256)) return false;
  return true;
}
function sanitize(e) { const result = {}; for (const k of ['version','id','time','source','event','session_id','cwd','turn_id','tool_name']) if (e[k] !== undefined) result[k] = e[k]; return result; }
function createReceiver({ getKey, accept, onError = console.error }) {
  return http.createServer((req, res) => {
    const reply = (status, value) => { if (!res.headersSent) { res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); } };
    const given = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from('Bearer ' + getKey());
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) { req.resume(); return reply(401, { error: 'unauthorized' }); }
    if (req.method !== 'POST' || req.url !== '/v1/events') { req.resume(); return reply(404, { error: 'not found' }); }
    let chunks = [], size = 0, rejected = false;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { rejected = true; chunks = []; reply(413, {error:'body too large'}); } else if (!rejected) chunks.push(chunk); });
    req.on('error', () => {});
    req.on('end', () => { if (rejected) return; let event; try { event = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, {error:'invalid JSON'}); }
      if (!validEvent(event)) return reply(400, {error:'invalid event'});
      try { const duplicate = accept(sanitize(event)); return reply(200, {accepted:true, duplicate:!!duplicate}); } catch (err) { onError(err); return reply(500, {error:'storage failure'}); }
    });
  });
}
function addRecord(records, event, limit = 500) { if (records.some(r => r.id === event.id)) return { records, duplicate: true }; return {records:[{...event, received_at:new Date().toISOString(), notification:'pending'}, ...records].slice(0,limit), duplicate:false}; }
module.exports = { EVENTS, MAX_BODY, atomicWrite, readJson, validEvent, createReceiver, addRecord };
