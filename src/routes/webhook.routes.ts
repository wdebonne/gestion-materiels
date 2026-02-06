import { Router, Response } from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import { logService } from '../services/log.service';

const router = Router();

// GET /api/webhooks - Récupérer tous les webhooks
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const webhooks = await db.query(`
      SELECT * FROM webhooks 
      ORDER BY created_at DESC
    `);
    
    res.json({ success: true, webhooks });
  } catch (error: any) {
    console.error('Erreur get webhooks:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/webhooks/:id - Récupérer un webhook par ID
router.get('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const webhook = await db.queryOne('SELECT * FROM webhooks WHERE id = ?', [id]);
    
    if (!webhook) {
      return res.status(404).json({ success: false, message: 'Webhook non trouvé' });
    }
    
    res.json({ success: true, webhook });
  } catch (error: any) {
    console.error('Erreur get webhook:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/webhooks - Créer un nouveau webhook
router.post('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, url, events, headers, is_active, secret } = req.body;
    
    if (!name || !url) {
      return res.status(400).json({ success: false, message: 'Nom et URL requis' });
    }
    
    // Valider l'URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ success: false, message: 'URL invalide' });
    }
    
    const result = await db.execute(
      `INSERT INTO webhooks (name, url, events, headers, is_active, secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        name,
        url,
        JSON.stringify(events || []),
        JSON.stringify(headers || {}),
        is_active !== false ? 1 : 0,
        secret || null
      ]
    );
    
    const webhook = await db.queryOne('SELECT * FROM webhooks WHERE id = ?', [result.lastInsertRowid]);
    
    await logService.success('api', `Webhook créé: ${name}`, { webhookId: result.lastInsertRowid }, { userId: req.user?.userId });
    
    res.status(201).json({ success: true, webhook });
  } catch (error: any) {
    console.error('Erreur create webhook:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/webhooks/:id - Modifier un webhook
router.put('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, url, events, headers, is_active, secret } = req.body;
    
    const existing = await db.queryOne('SELECT * FROM webhooks WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Webhook non trouvé' });
    }
    
    if (url) {
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ success: false, message: 'URL invalide' });
      }
    }
    
    await db.execute(
      `UPDATE webhooks SET 
        name = COALESCE(?, name),
        url = COALESCE(?, url),
        events = COALESCE(?, events),
        headers = COALESCE(?, headers),
        is_active = COALESCE(?, is_active),
        secret = COALESCE(?, secret),
        updated_at = datetime('now')
       WHERE id = ?`,
      [
        name || null,
        url || null,
        events ? JSON.stringify(events) : null,
        headers ? JSON.stringify(headers) : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        secret !== undefined ? secret : null,
        id
      ]
    );
    
    const webhook = await db.queryOne('SELECT * FROM webhooks WHERE id = ?', [id]);
    
    await logService.info('api', `Webhook modifié: ${webhook.name}`, { webhookId: id }, { userId: req.user?.userId });
    
    res.json({ success: true, webhook });
  } catch (error: any) {
    console.error('Erreur update webhook:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/webhooks/:id - Supprimer un webhook
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const existing = await db.queryOne('SELECT * FROM webhooks WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Webhook non trouvé' });
    }
    
    await db.execute('DELETE FROM webhooks WHERE id = ?', [id]);
    
    await logService.warning('api', `Webhook supprimé: ${existing.name}`, { webhookId: id }, { userId: req.user?.userId });
    
    res.json({ success: true, message: 'Webhook supprimé' });
  } catch (error: any) {
    console.error('Erreur delete webhook:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/webhooks/:id/test - Tester un webhook
router.post('/:id/test', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const webhook = await db.queryOne('SELECT * FROM webhooks WHERE id = ?', [id]);
    if (!webhook) {
      return res.status(404).json({ success: false, message: 'Webhook non trouvé' });
    }
    
    // Préparer les données de test
    const testPayload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'Ceci est un test de webhook depuis Gestion Matériels',
        webhook_id: webhook.id,
        webhook_name: webhook.name
      }
    };
    
    // Préparer les headers
    let customHeaders: Record<string, string> = {};
    try {
      customHeaders = webhook.headers ? JSON.parse(webhook.headers) : {};
    } catch {
      customHeaders = {};
    }
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'GestionMateriels-Webhook/1.0',
      ...customHeaders
    };
    
    // Ajouter la signature si un secret est défini
    if (webhook.secret) {
      const crypto = await import('crypto');
      const signature = crypto.createHmac('sha256', webhook.secret)
        .update(JSON.stringify(testPayload))
        .digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
    }
    
    // Envoyer la requête
    const startTime = Date.now();
    let responseStatus = 0;
    let responseBody = '';
    let success = false;
    
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(testPayload),
        timeout: 10000 // 10 secondes timeout
      } as any);
      
      responseStatus = response.status;
      responseBody = await response.text();
      success = response.ok;
      
      // Mettre à jour les stats du webhook
      await db.execute(
        `UPDATE webhooks SET 
          last_triggered_at = datetime('now'),
          last_status = ?,
          last_response = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
        [responseStatus, responseBody.substring(0, 1000), id]
      );
      
    } catch (fetchError: any) {
      responseStatus = 0;
      responseBody = fetchError.message;
      success = false;
      
      await db.execute(
        `UPDATE webhooks SET 
          last_triggered_at = datetime('now'),
          last_status = 0,
          last_response = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
        [fetchError.message.substring(0, 1000), id]
      );
    }
    
    const duration = Date.now() - startTime;
    
    await logService.info('api', `Test webhook: ${webhook.name} - ${success ? 'Succès' : 'Échec'}`, {
      webhookId: id,
      status: responseStatus,
      duration
    }, { userId: req.user?.userId });
    
    res.json({
      success,
      status: responseStatus,
      response: responseBody.substring(0, 500),
      duration,
      message: success ? 'Webhook testé avec succès' : 'Échec du test du webhook'
    });
  } catch (error: any) {
    console.error('Erreur test webhook:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/webhooks/trigger - Déclencher tous les webhooks pour un événement (usage interne)
router.post('/trigger', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { event, data } = req.body;
    
    if (!event) {
      return res.status(400).json({ success: false, message: 'Événement requis' });
    }
    
    // Récupérer les webhooks actifs qui écoutent cet événement
    const webhooks = await db.query(
      `SELECT * FROM webhooks WHERE is_active = 1`
    );
    
    const results: Array<{ webhookId: number; success: boolean; status: number }> = [];
    
    for (const webhook of webhooks) {
      // Vérifier si le webhook écoute cet événement
      let events: string[] = [];
      try {
        events = webhook.events ? JSON.parse(webhook.events) : [];
      } catch {
        events = [];
      }
      
      // Si pas d'événements spécifiés ou l'événement est dans la liste
      if (events.length === 0 || events.includes(event) || events.includes('*')) {
        const payload = {
          event,
          timestamp: new Date().toISOString(),
          data
        };
        
        let customHeaders: Record<string, string> = {};
        try {
          customHeaders = webhook.headers ? JSON.parse(webhook.headers) : {};
        } catch {
          customHeaders = {};
        }
        
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'GestionMateriels-Webhook/1.0',
          ...customHeaders
        };
        
        if (webhook.secret) {
          const crypto = await import('crypto');
          const signature = crypto.createHmac('sha256', webhook.secret)
            .update(JSON.stringify(payload))
            .digest('hex');
          headers['X-Webhook-Signature'] = `sha256=${signature}`;
        }
        
        try {
          const response = await fetch(webhook.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            timeout: 10000
          } as any);
          
          const responseBody = await response.text();
          
          await db.execute(
            `UPDATE webhooks SET 
              last_triggered_at = datetime('now'),
              last_status = ?,
              last_response = ?,
              updated_at = datetime('now')
             WHERE id = ?`,
            [response.status, responseBody.substring(0, 1000), webhook.id]
          );
          
          results.push({ webhookId: webhook.id, success: response.ok, status: response.status });
        } catch (fetchError: any) {
          await db.execute(
            `UPDATE webhooks SET 
              last_triggered_at = datetime('now'),
              last_status = 0,
              last_response = ?,
              updated_at = datetime('now')
             WHERE id = ?`,
            [fetchError.message.substring(0, 1000), webhook.id]
          );
          
          results.push({ webhookId: webhook.id, success: false, status: 0 });
        }
      }
    }
    
    res.json({ success: true, results });
  } catch (error: any) {
    console.error('Erreur trigger webhooks:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
