import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingDown, DollarSign, AlertTriangle, Package } from 'lucide-react'
import { Card, CardBody, CardHeader, CardTitle, LoadingInline } from '@/components/ui'
import api from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

export default function DepreciationPage() {
  const [lifespan, setLifespan] = useState(5)

  const { data, isLoading } = useQuery({
    queryKey: ['depreciation', lifespan],
    queryFn: async () => {
      const res = await api.get(`/dashboard/depreciation?lifespan=${lifespan}`)
      return res.data
    }
  })

  const items = data?.data || []
  const summary = data?.summary || {}

  // Données pour le graphique de répartition
  const pieData = [
    { name: 'Valeur résiduelle', value: summary.totalResidualValue || 0 },
    { name: 'Amortissement', value: summary.totalDepreciation || 0 }
  ]

  // Top 10 matériels par valeur résiduelle
  const topByValue = [...items]
    .sort((a: any, b: any) => b.residualValue - a.residualValue)
    .slice(0, 10)
    .map((item: any) => ({
      name: item.name.length > 20 ? item.name.substring(0, 20) + '...' : item.name,
      'Valeur résiduelle': item.residualValue,
      'Amortissement': item.totalDepreciation
    }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <TrendingDown className="w-7 h-7 text-primary-600" />
            Amortissement
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Calcul de la dépréciation et valeur résiduelle des matériels</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-300">Durée d'amortissement :</label>
          <select
            value={lifespan}
            onChange={(e) => setLifespan(Number(e.target.value))}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value={3}>3 ans</option>
            <option value={5}>5 ans</option>
            <option value={7}>7 ans</option>
            <option value={10}>10 ans</option>
            <option value={15}>15 ans</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <LoadingInline />
      ) : (
        <>
          {/* Statistiques globales */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardBody>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
                    <Package className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Matériels suivis</p>
                    <p className="text-xl font-bold">{summary.totalItems || 0}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 dark:bg-green-900/40 rounded-lg">
                    <DollarSign className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Valeur d'achat totale</p>
                    <p className="text-xl font-bold">{formatCurrency(summary.totalPurchaseValue || 0)}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary-100 rounded-lg">
                    <TrendingDown className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Valeur résiduelle</p>
                    <p className="text-xl font-bold">{formatCurrency(summary.totalResidualValue || 0)}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Entièrement amortis</p>
                    <p className="text-xl font-bold">{summary.fullyDepreciatedCount || 0}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Graphiques */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Répartition de la valeur</CardTitle>
              </CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }: { name: string; percent: number }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                      {pieData.map((_, index) => (
                        <Cell key={index} fill={index === 0 ? '#0ea5e9' : '#cbd5e1'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top 10 - Valeur résiduelle</CardTitle>
              </CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={topByValue} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v: number) => `${v}€`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="Valeur résiduelle" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </div>

          {/* Tableau détaillé */}
          <Card>
            <CardHeader>
              <CardTitle>Détail par matériel</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b">
                      <th className="pb-3 font-medium">Matériel</th>
                      <th className="pb-3 font-medium">Catégorie</th>
                      <th className="pb-3 font-medium text-right">Prix d'achat</th>
                      <th className="pb-3 font-medium text-right">Âge</th>
                      <th className="pb-3 font-medium text-right">Valeur résiduelle</th>
                      <th className="pb-3 font-medium text-right">Amortissement</th>
                      <th className="pb-3 font-medium text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                          {item.reference && <div className="text-xs text-gray-600 dark:text-gray-300">{item.reference}</div>}
                        </td>
                        <td className="py-3 text-gray-600 dark:text-gray-300">{item.categoryName}</td>
                        <td className="py-3 text-right">{formatCurrency(item.purchasePrice)}</td>
                        <td className="py-3 text-right">{item.ageInYears} an(s)</td>
                        <td className="py-3 text-right font-medium">{formatCurrency(item.residualValue)}</td>
                        <td className="py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-primary-500 h-2 rounded-full"
                                style={{ width: `${Math.min(item.depreciationPercent, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right">{item.depreciationPercent}%</span>
                          </div>
                        </td>
                        <td className="py-3 text-center">
                          {item.isFullyDepreciated ? (
                            <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs rounded-full">Amorti</span>
                          ) : (
                            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs rounded-full">En cours</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
