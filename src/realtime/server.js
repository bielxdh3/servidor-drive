const WebSocket = require("ws");

function parseBoundedNumber(name, fallback, minimum, maximum) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function createRealtimeServer({ server, getExpectedOrigin, parseCookies, authenticateRealtimeToken, loadCurrentUser }) {
  const REALTIME_MAX_PAYLOAD_BYTES = parseBoundedNumber("REALTIME_MAX_PAYLOAD_BYTES", 16 * 1024, 1024, 1024 * 1024);
  const REALTIME_MAX_BUFFERED_BYTES = parseBoundedNumber("REALTIME_MAX_BUFFERED_BYTES", 64 * 1024, 1024, 16 * 1024 * 1024);
  const REALTIME_MAX_MESSAGES_PER_WINDOW = parseBoundedNumber("REALTIME_MAX_MESSAGES_PER_WINDOW", 30, 1, 10_000);
  const REALTIME_RATE_WINDOW_MS = parseBoundedNumber("REALTIME_RATE_WINDOW_MS", 10 * 1000, 1000, 10 * 60 * 1000);
  const REALTIME_HEARTBEAT_MS = parseBoundedNumber("REALTIME_HEARTBEAT_MS", 30 * 1000, 1000, 10 * 60 * 1000);
  const REALTIME_IDLE_TIMEOUT_MS = parseBoundedNumber("REALTIME_IDLE_TIMEOUT_MS", 2 * REALTIME_HEARTBEAT_MS, REALTIME_HEARTBEAT_MS, 60 * 60 * 1000);
  const wss = new WebSocket.Server({ server, path: "/ws", maxPayload: REALTIME_MAX_PAYLOAD_BYTES, perMessageDeflate: false });

  function refreshRealtimeUser(socket) {
    if (!Number.isFinite(socket.user?.expiresAt) || Date.now() >= socket.user.expiresAt) {
      socket.close(1008, "Sessao expirada");
      return false;
    }
    const user = loadCurrentUser(socket.user?.username);
    if (user && !user.disabled && (user.sessionVersion || 0) === socket.user?.sessionVersion) return true;
    socket.close(1008, "Sessao revogada");
    return false;
  }

  function sendRealtime(socket, event, payload = {}) {
    if (socket.readyState !== WebSocket.OPEN || !refreshRealtimeUser(socket)) return;
    if (socket.bufferedAmount > REALTIME_MAX_BUFFERED_BYTES) return socket.close(1013, "Cliente lento");
    socket.send(JSON.stringify({ event, payload, timestamp: new Date().toISOString() }));
  }

  function broadcastRealtime(event, payload = {}) {
    for (const socket of wss.clients) sendRealtime(socket, event, payload);
  }

  const realtimeHeartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.isAlive === false || Date.now() - socket.lastActivityAt > REALTIME_IDLE_TIMEOUT_MS) socket.terminate();
      else { socket.isAlive = false; socket.ping(); }
    }
  }, REALTIME_HEARTBEAT_MS);
  server.once("close", () => clearInterval(realtimeHeartbeat));

  wss.on("connection", (socket, req) => {
    const origin = req.headers.origin;
    const expectedOrigin = getExpectedOrigin(req);
    const user = origin === expectedOrigin && authenticateRealtimeToken(parseCookies(req.headers.cookie).rootark_session);

    if (!user) {
      socket.close(1008, "Token invalido");
      return;
    }

    socket.user = user;
    socket.isAlive = true;
    socket.lastActivityAt = Date.now();
    socket.on("error", () => {});
    socket.on("pong", () => { socket.isAlive = true; socket.lastActivityAt = Date.now(); });
    socket.realtimeRate = { startedAt: Date.now(), count: 0 };
    sendRealtime(socket, "connected", { username: user.username });

    socket.on("message", (rawMessage, isBinary) => {
      socket.lastActivityAt = Date.now();
      if (!refreshRealtimeUser(socket)) return;
      if (isBinary) return socket.close(1003, "Quadro binario nao suportado");
      const now = Date.now();
      if (now - socket.realtimeRate.startedAt >= REALTIME_RATE_WINDOW_MS) socket.realtimeRate = { startedAt: now, count: 0 };
      socket.realtimeRate.count += 1;
      if (socket.realtimeRate.count > REALTIME_MAX_MESSAGES_PER_WINDOW) return socket.close(1008, "Limite de mensagens excedido");
      let message = {};
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        return;
      }

      if (message.event === "ping") sendRealtime(socket, "pong", {});
    });
  });

  return { broadcastRealtime };
}

module.exports = { createRealtimeServer };
