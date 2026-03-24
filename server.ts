import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join-room", (roomId) => {
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);
      
      // Get number of users in room
      const clients = io.sockets.adapter.rooms.get(roomId);
      const numClients = clients ? clients.size : 0;
      
      // Inform the user which player they are (1 or 2)
      socket.emit("player-assigned", numClients === 1 ? "black" : "white");
      
      if (numClients === 2) {
        io.to(roomId).emit("game-start");
      }
    });

    socket.on("make-move", ({ roomId, r, c, player }) => {
      socket.to(roomId).emit("move-made", { r, c, player });
    });

    socket.on("reset-game", (roomId) => {
      socket.to(roomId).emit("game-reset");
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
