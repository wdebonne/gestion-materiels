import { useSearchParams } from 'react-router-dom'
import { Mail, Server, FileText } from 'lucide-react'
import { Tabs, Tab } from '@/components/ui'
import SmtpSettingsPage from './SmtpSettingsPage'
import EmailTemplatesPage from './EmailTemplatesPage'

/**
 * Les emails d'un seul tenant : le serveur qui les envoie, et ce qu'ils disent.
 *
 * Les deux réglages étaient deux entrées de menu voisines, et pourtant on ne
 * touche jamais à l'une sans vérifier l'autre : un template mis au point sans
 * SMTP configuré ne part nulle part. L'onglet garde le lien sous les yeux.
 */

const ONGLETS = {
  smtp: {
    titre: 'Serveur SMTP',
    description: "Configurez l'envoi d'emails pour les notifications et alertes.",
  },
  templates: {
    titre: "Templates d'emails",
    description: "Personnalisez les emails envoyés par l'application.",
  },
} as const

type Onglet = keyof typeof ONGLETS

export default function EmailSettingsPage() {
  // L'onglet vit dans l'URL : un lien vers les templates reste un lien, et le
  // retour arrière du navigateur ramène là où on était.
  const [parametres, setParametres] = useSearchParams()
  const demande = parametres.get('onglet')
  const actif: Onglet = demande === 'templates' ? 'templates' : 'smtp'

  const changer = (onglet: string) => {
    setParametres(onglet === 'smtp' ? {} : { onglet }, { replace: true })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Mail className="w-7 h-7 text-primary-600" />
          Emails
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">{ONGLETS[actif].description}</p>
      </div>

      <Tabs value={actif} onChange={changer}>
        <Tab value="smtp" label="Serveur SMTP" icon={<Server className="w-4 h-4" />} />
        <Tab value="templates" label="Templates" icon={<FileText className="w-4 h-4" />} />
      </Tabs>

      <div className="mt-6">
        {actif === 'smtp' ? <SmtpSettingsPage /> : <EmailTemplatesPage />}
      </div>
    </div>
  )
}
