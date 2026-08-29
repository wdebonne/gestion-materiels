import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/secrets';
import { notifierWebhooks } from './webhook.service';

let io: Server | null = null;

export function initWebSocket(server: HTTPServer): Server {
  io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' ? true : (process.env.CLIENT_URL || 'http://localhost:5173'),
      credentials: true
    },
    path: '/ws'
  });

  // Authentification par middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret());
      (socket as any).user = decoded;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user;
    console.log(`🔌 WebSocket: ${user?.email || 'unknown'} connecté`);

    // Rejoindre une room par rôle
    if (user?.role) {
      socket.join(`role:${user.role}`);
    }
    socket.join(`user:${user?.userId || user?.id}`);

    socket.on('disconnect', () => {
      console.log(`🔌 WebSocket: ${user?.email || 'unknown'} déconnecté`);
    });
  });

  console.log('✅ WebSocket initialisé');
  return io;
}

// Émettre un événement à tous les clients connectés
export function emitToAll(event: string, data: any): void {
  io?.emit(event, data);
}

// Émettre à un rôle spécifique
export function emitToRole(role: string, event: string, data: any): void {
  io?.to(`role:${role}`).emit(event, data);
}

// Émettre à un utilisateur spécifique
export function emitToUser(userId: number, event: string, data: any): void {
  io?.to(`user:${userId}`).emit(event, data);
}

// Émettre une notification d'alerte
export function emitAlert(alert: Record<string, any>): void {
  io?.emit('alert:new', alert);

  // Même signal, deux destinataires : l'interface via WebSocket, les services
  // externes via webhook. Les alertes naissent à cinq endroits différents ;
  // brancher ici évite d'en oublier un.
  notifierWebhooks('alert.created', alert);
}

// Émettre une mise à jour du compteur d'alertes
export function emitAlertCount(count: number): void {
  io?.emit('alert:count', { count });
}

export function getIO(): Server | null {
  return io;
}
