import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import Handlebars from 'handlebars';

const router = Router();

// GET /api/email-templates - Liste des templates
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const templates = await db.query('SELECT * FROM email_templates ORDER BY name');

    res.json({
      success: true,
      templates: templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        subject: t.subject,
        body: t.body,
        variables: t.variables ? JSON.parse(t.variables) : [],
        description: t.description,
        isActive: !!t.is_active,
        createdAt: t.created_at,
        updatedAt: t.updated_at
      }))
    });
  } catch (error: any) {
    console.error('Erreur get email templates:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// GET /api/email-templates/:id - Détail d'un template
router.get('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const template = await db.queryOne('SELECT * FROM email_templates WHERE id = ?', [id]);

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template non trouvé' });
    }

    res.json({
      success: true,
      template: {
        id: template.id,
        name: template.name,
        subject: template.subject,
        body: template.body,
        variables: template.variables ? JSON.parse(template.variables) : [],
        description: template.description,
        isActive: !!template.is_active,
        createdAt: template.created_at,
        updatedAt: template.updated_at
      }
    });
  } catch (error: any) {
    console.error('Erreur get email template:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/email-templates - Créer un template
router.post('/', authenticateToken, requireAdmin, [
  body('name').notEmpty().trim().withMessage('Nom requis'),
  body('subject').notEmpty().trim().withMessage('Sujet requis'),
  body('body').notEmpty().withMessage('Corps requis')
], async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, subject, body: templateBody, variables, description } = req.body;

    // Vérifier l'unicité du nom
    const existing = await db.queryOne('SELECT id FROM email_templates WHERE name = ?', [name]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Un template avec ce nom existe déjà' });
    }

    const result = await db.execute(
      'INSERT INTO email_templates (name, subject, body, variables, description) VALUES (?, ?, ?, ?, ?)',
      [name, subject, templateBody, JSON.stringify(variables || []), description]
    );

    res.status(201).json({
      success: true,
      message: 'Template créé',
      templateId: result.lastInsertRowid
    });
  } catch (error: any) {
    console.error('Erreur create email template:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// PUT /api/email-templates/:id - Modifier un template
router.put('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, subject, body: templateBody, variables, description, isActive } = req.body;

    const template = await db.queryOne('SELECT id FROM email_templates WHERE id = ?', [id]);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template non trouvé' });
    }

    let updateFields = [];
    let values = [];

    if (name) {
      const existing = await db.queryOne('SELECT id FROM email_templates WHERE name = ? AND id != ?', [name, id]);
      if (existing) {
        return res.status(400).json({ success: false, message: 'Un template avec ce nom existe déjà' });
      }
      updateFields.push('name = ?');
      values.push(name);
    }

    if (subject) {
      updateFields.push('subject = ?');
      values.push(subject);
    }

    if (templateBody) {
      updateFields.push('body = ?');
      values.push(templateBody);
    }

    if (variables !== undefined) {
      updateFields.push('variables = ?');
      values.push(JSON.stringify(variables));
    }

    if (description !== undefined) {
      updateFields.push('description = ?');
      values.push(description);
    }

    if (isActive !== undefined) {
      updateFields.push('is_active = ?');
      values.push(isActive ? 1 : 0);
    }

    updateFields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    await db.execute(
      `UPDATE email_templates SET ${updateFields.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ success: true, message: 'Template mis à jour' });
  } catch (error: any) {
    console.error('Erreur update email template:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// DELETE /api/email-templates/:id - Supprimer un template
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await db.execute('DELETE FROM email_templates WHERE id = ?', [id]);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Template non trouvé' });
    }

    res.json({ success: true, message: 'Template supprimé' });
  } catch (error: any) {
    console.error('Erreur delete email template:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// POST /api/email-templates/:id/preview - Prévisualiser un template
router.post('/:id/preview', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { testData } = req.body;

    const template = await db.queryOne('SELECT * FROM email_templates WHERE id = ?', [id]);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template non trouvé' });
    }

    // Récupérer les paramètres du site pour les variables par défaut
    const siteNameSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_name'");
    const siteUrlSetting = await db.queryOne("SELECT setting_value FROM settings WHERE setting_key = 'site_url'");

    const defaultData = {
      site_name: siteNameSetting?.setting_value || 'Gestion Matériels',
      site_url: siteUrlSetting?.setting_value || 'http://localhost:3000',
      year: new Date().getFullYear(),
      first_name: 'Jean',
      last_name: 'Dupont',
      email: 'jean.dupont@example.com',
      role: 'Utilisateur',
      reset_link: `${siteUrlSetting?.setting_value || 'http://localhost:3000'}/reset-password/token123`,
      expiry_hours: '1',
      alert_title: 'Exemple d\'alerte',
      alert_message: 'Ceci est un message d\'alerte de test',
      object_name: 'Véhicule Test',
      object_id: '1',
      due_date: new Date().toLocaleDateString('fr-FR'),
      maintenance_type: 'Vidange',
      scheduled_date: new Date().toLocaleDateString('fr-FR'),
      scheduled_mileage: '50000',
      ...testData
    };

    // Compiler le template
    const compiledSubject = Handlebars.compile(template.subject)(defaultData);
    const compiledBody = Handlebars.compile(template.body)(defaultData);

    res.json({
      success: true,
      preview: {
        subject: compiledSubject,
        body: compiledBody
      }
    });
  } catch (error: any) {
    console.error('Erreur preview template:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/email-templates/variables/list - Liste des variables disponibles
router.get('/variables/list', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const variables = [
      { name: 'site_name', description: 'Nom du site', example: 'Gestion Matériels' },
      { name: 'site_url', description: 'URL du site', example: 'http://localhost:3000' },
      { name: 'year', description: 'Année actuelle', example: '2024' },
      { name: 'first_name', description: 'Prénom de l\'utilisateur', example: 'Jean' },
      { name: 'last_name', description: 'Nom de l\'utilisateur', example: 'Dupont' },
      { name: 'email', description: 'Email de l\'utilisateur', example: 'jean.dupont@example.com' },
      { name: 'role', description: 'Rôle de l\'utilisateur', example: 'Utilisateur' },
      { name: 'reset_link', description: 'Lien de réinitialisation du mot de passe', example: 'http://localhost:3000/reset-password/token' },
      { name: 'expiry_hours', description: 'Heures avant expiration', example: '1' },
      { name: 'alert_title', description: 'Titre de l\'alerte', example: 'Contrôle technique' },
      { name: 'alert_message', description: 'Message de l\'alerte', example: 'Le contrôle technique expire bientôt' },
      { name: 'object_name', description: 'Nom de l\'objet/véhicule', example: 'Peugeot 308' },
      { name: 'object_id', description: 'ID de l\'objet', example: '1' },
      { name: 'due_date', description: 'Date d\'échéance', example: '15/03/2024' },
      { name: 'maintenance_type', description: 'Type de maintenance', example: 'Vidange' },
      { name: 'scheduled_date', description: 'Date prévue', example: '01/04/2024' },
      { name: 'scheduled_mileage', description: 'Kilométrage prévu', example: '50000' }
    ];

    res.json({ success: true, variables });
  } catch (error: any) {
    console.error('Erreur get variables:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

export default router;
