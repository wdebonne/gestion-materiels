import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { 
  Database, Server, ArrowRight, CheckCircle, 
  RefreshCw, Play, XCircle
} from 'lucide-react'
import { 
  Card, CardBody, CardHeader, CardTitle, Button, Input, Select,
  Modal, ModalBody, ModalFooter, LoadingInline, Alert
} from '@/components/ui'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function DatabasePage() {
  const [migrationModal, setMigrationModal] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  
  const [migrationConfig, setMigrationConfig] = useState({
    type: 'mysql',
    host: 'localhost',
    port: '3306',
    database: '',
    username: '',
    password: ''
  })

  // Récupérer les infos de la base de données actuelle
  const { data: dbInfo, isLoading, refetch } = useQuery({
    queryKey: ['database-info'],
    queryFn: async () => {
      const response = await api.get('/settings/database')
      return response.data.database
    }
  })

  // Mutation pour tester la connexion MySQL
  const testConnectionMutation = useMutation({
    mutationFn: async (config: typeof migrationConfig) => {
      return api.post('/settings/database/test-connection', config)
    },
    onSuccess: () => {
      setTestResult({ success: true, message: 'Connexion réussie !' })
    },
    onError: (err: any) => {
      setTestResult({ 
        success: false, 
        message: err.response?.data?.error || 'Impossible de se connecter à la base de données'
      })
    }
  })

  // Mutation pour lancer la migration
  const migrateMutation = useMutation({
    mutationFn: async (config: typeof migrationConfig) => {
      return api.post('/settings/database/migrate', config)
    },
    onSuccess: () => {
      toast.success('Migration réussie ! L\'application va redémarrer...')
      setMigrationModal(false)
      setTimeout(() => window.location.reload(), 3000)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Erreur lors de la migration')
    }
  })

  const handleTestConnection = () => {
    setTestResult(null)
    testConnectionMutation.mutate(migrationConfig)
  }

  const handleMigrate = () => {
    if (!testResult?.success) {
      toast.error('Veuillez d\'abord tester la connexion')
      return
    }
    migrateMutation.mutate(migrationConfig)
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Base de données</h1>
        <p className="text-gray-500 mt-1">Informations et migration de la base de données</p>
      </div>

      {/* Info base actuelle */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Base de données actuelle
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardBody>
          {isLoading ? (
            <LoadingInline />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 bg-gray-50 rounded-xl">
                <p className="text-sm text-gray-500">Type</p>
                <p className="text-lg font-semibold text-gray-900 mt-1 flex items-center gap-2">
                  <Database className="w-5 h-5 text-primary-600" />
                  {dbInfo?.type === 'sqlite' ? 'SQLite' : 'MySQL/MariaDB'}
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl">
                <p className="text-sm text-gray-500">Taille</p>
                <p className="text-lg font-semibold text-gray-900 mt-1">
                  {dbInfo?.sizeFormatted || dbInfo?.size || 'N/A'}
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl">
                <p className="text-sm text-gray-500">Tables</p>
                <p className="text-lg font-semibold text-gray-900 mt-1">
                  {dbInfo?.tableCount || 0} tables
                </p>
              </div>
            </div>
          )}

          {dbInfo?.type === 'sqlite' && (
            <div className="mt-4 p-4 bg-blue-50 rounded-xl">
              <p className="text-sm text-blue-700">
                <strong>Note :</strong> Vous utilisez SQLite qui est parfait pour le développement et les petites installations.
                Pour une utilisation en production avec plusieurs utilisateurs simultanés, envisagez de migrer vers MySQL/MariaDB.
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Migration */}
      {dbInfo?.type === 'sqlite' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRight className="w-5 h-5" />
              Migration vers MySQL/MariaDB
            </CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-gray-600 mb-4">
              Migrez vos données SQLite vers une base de données MySQL ou MariaDB pour de meilleures performances
              et une meilleure gestion de la concurrence.
            </p>
            
            <Alert type="warning" className="mb-4">
              <strong>Important :</strong> Effectuez une sauvegarde complète avant de procéder à la migration.
              Cette opération est irréversible.
            </Alert>

            <Button onClick={() => setMigrationModal(true)}>
              <Server className="w-4 h-4 mr-2" />
              Configurer la migration
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Stats de la base */}
      <Card>
        <CardHeader>
          <CardTitle>Statistiques par table</CardTitle>
        </CardHeader>
        <CardBody>
          {isLoading ? (
            <LoadingInline />
          ) : dbInfo?.tables && Object.keys(dbInfo.tables).length > 0 ? (
            <>
              <div className="mb-4 p-3 bg-primary-50 rounded-lg text-sm text-primary-700">
                <strong>{dbInfo.totalRecords?.toLocaleString() || 0}</strong> enregistrements au total
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {Object.entries(dbInfo.tables).map(([table, count]) => (
                  <div key={table} className="text-center p-4 bg-gray-50 rounded-lg">
                    <p className="text-2xl font-bold text-gray-900">{String(count)}</p>
                    <p className="text-sm text-gray-500 mt-1 capitalize">
                      {table.replace(/_/g, ' ')}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-gray-500 text-sm">Aucune statistique disponible</p>
          )}
        </CardBody>
      </Card>

      {/* Modal de migration */}
      <Modal
        isOpen={migrationModal}
        onClose={() => setMigrationModal(false)}
        title="Migration vers MySQL/MariaDB"
        size="lg"
      >
        <ModalBody className="space-y-4">
          <Alert type="warning">
            Assurez-vous d'avoir créé une sauvegarde avant de continuer.
          </Alert>

          <Select
            label="Type de base de données"
            value={migrationConfig.type}
            onChange={(e) => setMigrationConfig({ ...migrationConfig, type: e.target.value })}
            options={[
              { value: 'mysql', label: 'MySQL' },
              { value: 'mariadb', label: 'MariaDB' }
            ]}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Hôte"
              value={migrationConfig.host}
              onChange={(e) => setMigrationConfig({ ...migrationConfig, host: e.target.value })}
              placeholder="localhost"
            />
            <Input
              label="Port"
              value={migrationConfig.port}
              onChange={(e) => setMigrationConfig({ ...migrationConfig, port: e.target.value })}
              placeholder="3306"
            />
          </div>

          <Input
            label="Nom de la base de données"
            value={migrationConfig.database}
            onChange={(e) => setMigrationConfig({ ...migrationConfig, database: e.target.value })}
            placeholder="gestion_materiels"
            hint="La base de données doit être créée au préalable"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Utilisateur"
              value={migrationConfig.username}
              onChange={(e) => setMigrationConfig({ ...migrationConfig, username: e.target.value })}
              placeholder="root"
            />
            <Input
              label="Mot de passe"
              type="password"
              value={migrationConfig.password}
              onChange={(e) => setMigrationConfig({ ...migrationConfig, password: e.target.value })}
            />
          </div>

          {testResult && (
            <Alert type={testResult.success ? 'success' : 'error'}>
              <div className="flex items-center gap-2">
                {testResult.success ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
                {testResult.message}
              </div>
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setMigrationModal(false)}>
            Annuler
          </Button>
          <Button 
            variant="outline"
            onClick={handleTestConnection}
            loading={testConnectionMutation.isPending}
          >
            Tester la connexion
          </Button>
          <Button 
            onClick={handleMigrate}
            loading={migrateMutation.isPending}
            disabled={!testResult?.success}
          >
            <Play className="w-4 h-4 mr-2" />
            Lancer la migration
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
