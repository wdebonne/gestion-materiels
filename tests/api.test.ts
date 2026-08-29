import request from 'supertest';
import express from 'express';

// Tests d'intégration basiques pour les routes API
// Ces tests utilisent un serveur Express minimal pour tester la structure des routes

describe('API Routes Structure', () => {
  describe('Health Check', () => {
    it('should respond to a basic express app', async () => {
      const app = express();
      app.get('/health', (_req, res) => res.json({ status: 'ok' }));

      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });
  });

  describe('QR Code Routes', () => {
    it('should import qrcode routes without errors', () => {
      expect(() => {
        require('../src/routes/qrcode.routes');
      }).not.toThrow();
    });
  });

  describe('Reservation Routes', () => {
    it('should import reservation routes without errors', () => {
      expect(() => {
        require('../src/routes/reservation.routes');
      }).not.toThrow();
    });
  });

  describe('Import/Export Routes', () => {
    it('should import importExport routes without errors', () => {
      expect(() => {
        require('../src/routes/importExport.routes');
      }).not.toThrow();
    });
  });
});

describe('Services', () => {
  describe('WebSocket Service', () => {
    it('should import websocket service without errors', () => {
      expect(() => {
        require('../src/services/websocket.service');
      }).not.toThrow();
    });

    it('should export emitToAll, emitToRole, emitToUser, emitAlert functions', () => {
      const ws = require('../src/services/websocket.service');
      expect(typeof ws.emitToAll).toBe('function');
      expect(typeof ws.emitToRole).toBe('function');
      expect(typeof ws.emitToUser).toBe('function');
      expect(typeof ws.emitAlert).toBe('function');
      expect(typeof ws.initWebSocket).toBe('function');
    });

    it('emitAlert should not throw when no server is initialized', () => {
      const { emitAlert } = require('../src/services/websocket.service');
      expect(() => emitAlert({ title: 'test', severity: 'info' })).not.toThrow();
    });
  });
});
