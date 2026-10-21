'use strict';

// Edge config agent.
//
// Feeds the edge proxy with the participant's mTLS material, which the
// mcm-agent owns: it creates the keys, exchanges certificates with the hub's
// connection manager and renews them. The mcm-agent hands that material only
// to clients of its control WebSocket (the same channel the SDK uses), so
// this agent connects as one more client and writes the six PEM files the
// edge needs:
//
//   inbound-cert.pem / inbound-key.pem   server certificate presented to the hub
//   inbound-ca.pem                       CA that validates the hub's client certificate
//   outbound-cert.pem / outbound-key.pem client certificate presented to the hub
//   outbound-ca.pem                      CA chain that validates the hub's server certificate
//
// Files are swapped atomically (Kubernetes-secret layout: a `..data` symlink
// to a timestamped directory, stable symlinks pointing through it), so the
// proxy, watching CERT_DIR, never reads a certificate with a mismatched key.
//
// Tracked exception to "no in-house code": remove once the mcm-agent can
// write this material itself.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const MGMT_API_WS_URL = process.env.MGMT_API_WS_URL || 'ws://mcm-agent:4004';
const CERT_DIR = process.env.CERT_DIR || '/certs';
// The control server pings every 30 s; no ping for this long means the
// connection is dead even if the socket has not noticed.
const PING_TIMEOUT_MS = Number(process.env.PING_TIMEOUT_MS || 75000);
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const FILES = {
    'inbound-cert.pem': ['inbound', 'cert'],
    'inbound-key.pem': ['inbound', 'key'],
    'inbound-ca.pem': ['inbound', 'ca'],
    'outbound-cert.pem': ['outbound', 'cert'],
    'outbound-key.pem': ['outbound', 'key'],
    'outbound-ca.pem': ['outbound', 'ca'],
};
const DATA_LINK = '..data';

const log = (level, msg, fields = {}) => {
    process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })}\n`);
};

// Same reviver as the control server's deserialise(): Buffers travel as
// { type: 'Buffer', data: [...] }.
const reviver = (k, v) => (
    v !== null && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)
        ? Buffer.from(v.data)
        : v
);

const toPem = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : v);

// Pick the six values out of a full connector configuration. Returns the
// file contents, or the list of missing paths.
const extract = (config) => {
    const files = {};
    const missing = [];
    for (const [name, [direction, field]] of Object.entries(FILES)) {
        const value = toPem(config?.[direction]?.tls?.creds?.[field]);
        if (typeof value === 'string' && value.includes('-----BEGIN')) {
            files[name] = value.endsWith('\n') ? value : `${value}\n`;
        } else {
            missing.push(`${direction}.tls.creds.${field}`);
        }
    }
    return missing.length ? { missing } : { files };
};

const describe = (pem) => {
    const cert = new crypto.X509Certificate(pem);
    return { subject: cert.subject.replace(/\n/g, ', '), validTo: cert.validTo, sha256: cert.fingerprint256 };
};

// Reject material the proxy could not use, so a bad update never replaces
// a working one.
const validate = (files) => {
    const summary = {};
    for (const direction of ['inbound', 'outbound']) {
        const certPem = files[`${direction}-cert.pem`];
        const cert = new crypto.X509Certificate(certPem);
        const key = crypto.createPrivateKey(files[`${direction}-key.pem`]);
        if (!cert.checkPrivateKey(key)) {
            throw new Error(`${direction} certificate does not match its private key`);
        }
        summary[direction] = { cert: describe(certPem), ca: describe(files[`${direction}-ca.pem`]) };
    }
    return summary;
};

const digestOf = (files) => {
    const hash = crypto.createHash('sha256');
    for (const name of Object.keys(FILES)) {
        hash.update(name).update('\0').update(files[name]).update('\0');
    }
    return hash.digest('hex');
};

const readCurrent = () => {
    try {
        const files = {};
        for (const name of Object.keys(FILES)) {
            files[name] = fs.readFileSync(path.join(CERT_DIR, name), 'utf8');
        }
        return digestOf(files);
    } catch {
        return undefined;
    }
};

let currentDigest = readCurrent();

const write = (files) => {
    const digest = digestOf(files);
    if (digest === currentDigest) {
        return false;
    }
    const dataDir = `..${new Date().toISOString().replace(/[-:.]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
    fs.mkdirSync(path.join(CERT_DIR, dataDir), { mode: 0o700 });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(CERT_DIR, dataDir, name), content, { mode: 0o400 });
    }
    const tmpLink = path.join(CERT_DIR, `${DATA_LINK}_tmp`);
    fs.rmSync(tmpLink, { force: true });
    fs.symlinkSync(dataDir, tmpLink);
    fs.renameSync(tmpLink, path.join(CERT_DIR, DATA_LINK));
    for (const name of Object.keys(FILES)) {
        const target = path.join(DATA_LINK, name);
        const link = path.join(CERT_DIR, name);
        let current;
        try {
            current = fs.readlinkSync(link);
        } catch {
            // missing, or not a symlink
        }
        if (current !== target) {
            fs.rmSync(link, { force: true });
            fs.symlinkSync(target, link);
        }
    }
    for (const entry of fs.readdirSync(CERT_DIR)) {
        if (entry.startsWith('..') && entry !== DATA_LINK && entry !== dataDir) {
            fs.rmSync(path.join(CERT_DIR, entry), { recursive: true, force: true });
        }
    }
    currentDigest = digest;
    return true;
};

const apply = (config) => {
    const { files, missing } = extract(config);
    if (missing) {
        log('warn', 'Configuration has no complete TLS material yet; keeping current files', { missing });
        return;
    }
    let summary;
    try {
        summary = validate(files);
    } catch (err) {
        log('error', 'Rejected TLS material; keeping current files', { error: err.message });
        return;
    }
    if (write(files)) {
        log('info', 'Edge TLS material updated', summary);
    } else {
        log('debug', 'Edge TLS material unchanged');
    }
};

let backoff = RECONNECT_MIN_MS;
let socket;
let stopping = false;

const connect = () => {
    log('info', 'Connecting to control server', { url: MGMT_API_WS_URL });
    socket = new WebSocket(MGMT_API_WS_URL);
    let pingTimer;
    const armPingTimer = () => {
        clearTimeout(pingTimer);
        pingTimer = setTimeout(() => {
            log('warn', 'No ping from control server; reconnecting');
            socket.terminate();
        }, PING_TIMEOUT_MS);
    };

    socket.on('open', () => {
        backoff = RECONNECT_MIN_MS;
        armPingTimer();
        // The control server answers a READ by broadcasting the configuration
        // to every client, and the SDK (v24.19.6) rebuilds its control client
        // on any broadcast, which starts a reconnect loop. So only ask when the
        // edge has nothing to serve; otherwise listen: renewals and every SDK
        // connection broadcast the full configuration anyway.
        if (currentDigest) {
            log('info', 'Connected; listening for configuration updates');
            return;
        }
        log('info', 'Connected; no TLS material yet, requesting configuration');
        socket.send(JSON.stringify({
            verb: 'READ', msg: 'CONFIGURATION', data: {}, id: crypto.randomUUID(),
        }));
    });
    socket.on('ping', armPingTimer);
    socket.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString(), reviver);
        } catch {
            log('warn', 'Ignoring a message that is not JSON');
            return;
        }
        if (msg.msg === 'CONFIGURATION' && msg.verb === 'NOTIFY') {
            apply(msg.data);
        } else if (msg.msg === 'ERROR') {
            log('warn', 'Control server returned an error', { error: msg.data, id: msg.id });
        }
    });
    socket.on('error', (err) => log('warn', 'Control connection error', { error: err.message }));
    socket.on('close', (code) => {
        clearTimeout(pingTimer);
        if (stopping) {
            return;
        }
        log('warn', 'Control connection closed; reconnecting', { code, inMs: backoff });
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    });
};

const stop = () => {
    stopping = true;
    socket?.close();
    process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

if (require.main === module) {
    connect();
}

module.exports = { extract, validate, write, digestOf };
