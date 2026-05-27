import type * as Party from "partykit/server";

type Msg =
  | { type: "draw"; op: unknown }
  | { type: "snapshot"; canvas: string; db: unknown }
  | { type: "end" };

export default class FastDrawServer implements Party.Server {
  canvas: string | null = null;
  db: unknown = null;

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    if (this.canvas) {
      conn.send(JSON.stringify({ type: "init", canvas: this.canvas, db: this.db }));
    }
    this.broadcastCount();
  }

  onClose() {
    this.broadcastCount();
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg = JSON.parse(message) as Msg;
    if (msg.type === "draw") {
      this.room.broadcast(message, [sender.id]);
    } else if (msg.type === "snapshot") {
      this.canvas = msg.canvas;
      this.db = msg.db;
    } else if (msg.type === "end") {
      this.canvas = null;
      this.db = null;
      this.room.broadcast(message, [sender.id]);
    }
  }

  broadcastCount() {
    const n = [...this.room.getConnections()].length;
    this.room.broadcast(JSON.stringify({ type: "count", n }));
  }
}
