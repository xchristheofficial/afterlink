// Wake-ups only: actual data is always fetched through the normal access checks.
export function installLiveEvents(app, session) {
  const clients = new Map();
  app.get("/api/feed/live", (req, res) => {
    const uid = res.locals.uid,
      set = clients.get(uid) || new Set();
    if (set.size >= 4) return res.sendStatus(429);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 2000\n: ready\n\n");
    const client = { res, valid: () => session(req)?.id === uid };
    set.add(client);
    clients.set(uid, set);
    const pulse = setInterval(() => {
      if (!client.valid()) res.end();
      else res.write(": heartbeat\n\n");
    }, 20000);
    res.on("close", () => {
      clearInterval(pulse);
      set.delete(client);
      if (!set.size) clients.delete(uid);
    });
  });
  return (type, ...users) => {
    for (const uid of new Set(users))
      for (const c of clients.get(uid) || []) {
        if (!c.valid() || c.res.writableLength > 8192) c.res.end();
        else c.res.write(`event: ${type}\ndata: {}\n\n`);
      }
  };
}
