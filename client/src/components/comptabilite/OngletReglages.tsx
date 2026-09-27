import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, AlertTriangle, Save, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button, Card, CardBody, CardHeader, CardTitle, LoadingInline } from '@/components/ui'
import { comptaApi, MOTIFS, type DroitsCompta, type Motif, type ReglagesCompta } from '@/lib/comptabilite'
import { cn } from '@/lib/utils'

const CLASSE_CHAMP =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100'
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

const message = (e: any, repli: string) => e?.response?.data?.message ?? repli

function Champ({ id, libelle, aide, children }: { id: string; libelle: string; aide?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {libelle}
      </label>
      {children}
      {aide && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{aide}</p>}
    </div>
  )
}

export default function OngletReglages({ droits, colonnes }: { droits: DroitsCompta; colonnes: Record<string, string> }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['comptabilite', 'reglages'], queryFn: comptaApi.reglages })
  const [r, setR] = useState<ReglagesCompta | null>(null)
  useEffect(() => {
    if (data) setR(data.reglages)
  }, [data])

  const enregistrer = useMutation({
    mutationFn: () => comptaApi.enregistrerReglages(r!),
    onSuccess: (reglages) => {
      setR(reglages)
      toast.success('Réglages enregistrés')
      queryClient.invalidateQueries({ queryKey: ['comptabilite'] })
    },
    onError: (e) => toast.error(message(e, 'Enregistrement impossible')),
  })
  const tester = useMutation({
    mutationFn: comptaApi.testerEnvoi,
    onSuccess: (res) =>
      res.erreurs.length ? toast.error(res.erreurs.join(' — ')) : toast.success('Fichier d’essai envoyé : vérifiez sa réception'),
    onError: (e) => toast.error(message(e, 'Essai impossible')),
  })

  if (isLoading || !r || !data) return <LoadingInline />
  const lectureSeule = !droits.regler
  const majEnvoi = (champs: Partial<ReglagesCompta['envoi']>) => setR({ ...r, envoi: { ...r.envoi, ...champs } })
  const majFormat = (champs: Partial<ReglagesCompta['format']>) => setR({ ...r, format: { ...r.format, ...champs } })
  const deplacer = (i: number, sens: -1 | 1) => {
    const liste = [...r.format.colonnes]
    const j = i + sens
    if (j < 0 || j >= liste.length) return
    ;[liste[i], liste[j]] = [liste[j], liste[i]]
    majFormat({ colonnes: liste })
  }
  const basculerColonne = (cle: string) =>
    majFormat({ colonnes: r.format.colonnes.includes(cle) ? r.format.colonnes.filter((c) => c !== cle) : [...r.format.colonnes, cle] })

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        enregistrer.mutate()
      }}
    >
      {lectureSeule && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          Ces réglages sont affichés pour information : les modifier demande le droit « Régler le module ».
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Envoi à la compta</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Les sorties ne partent pas une par une : elles sont regroupées et envoyées ensemble, dans un seul fichier. Dix objets
            sortis dans la journée font un seul mail.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Champ id="envoi-frequence" libelle="Fréquence">
              <select
                id="envoi-frequence"
                disabled={lectureSeule}
                className={CLASSE_CHAMP}
                value={r.envoi.frequence}
                onChange={(e) => majEnvoi({ frequence: e.target.value as ReglagesCompta['envoi']['frequence'] })}
              >
                <option value="quotidien">Une fois par jour</option>
                <option value="hebdomadaire">Une fois par semaine</option>
                <option value="manuel">Seulement à la main</option>
              </select>
            </Champ>
            {r.envoi.frequence === 'hebdomadaire' && (
              <Champ id="envoi-jour" libelle="Jour">
                <select id="envoi-jour" disabled={lectureSeule} className={CLASSE_CHAMP} value={r.envoi.jour} onChange={(e) => majEnvoi({ jour: Number(e.target.value) })}>
                  {JOURS.map((j, i) => (
                    <option key={j} value={i + 1}>
                      {j}
                    </option>
                  ))}
                </select>
              </Champ>
            )}
            {r.envoi.frequence !== 'manuel' && (
              <Champ id="envoi-heure" libelle="Heure" aide="Rien n’est envoyé s’il n’y a aucune sortie.">
                <select id="envoi-heure" disabled={lectureSeule} className={CLASSE_CHAMP} value={r.envoi.heure} onChange={(e) => majEnvoi({ heure: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')} h
                    </option>
                  ))}
                </select>
              </Champ>
            )}
          </div>

          <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <legend className="px-1 text-sm font-medium text-gray-900 dark:text-gray-100">Dépôt sur Nextcloud</legend>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                disabled={lectureSeule}
                checked={r.envoi.nextcloud.actif}
                onChange={(e) => majEnvoi({ nextcloud: { ...r.envoi.nextcloud, actif: e.target.checked } })}
              />
              Déposer le fichier dans un dossier partagé avec la compta
            </label>
            {r.envoi.nextcloud.actif && (
              <>
                <Champ id="envoi-dossier" libelle="Dossier" aide="Créé s’il n’existe pas.">
                  <input
                    id="envoi-dossier"
                    disabled={lectureSeule}
                    className={CLASSE_CHAMP}
                    value={r.envoi.nextcloud.dossier}
                    onChange={(e) => majEnvoi({ nextcloud: { ...r.envoi.nextcloud, dossier: e.target.value } })}
                  />
                </Champ>
                {!data.nextcloudConfigure && (
                  <p className="flex items-center gap-1 text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4" aria-hidden /> Nextcloud n’est pas configuré :{' '}
                    <Link to="/settings/nextcloud" className="underline">
                      Paramètres › Nextcloud
                    </Link>
                  </p>
                )}
              </>
            )}
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <legend className="px-1 text-sm font-medium text-gray-900 dark:text-gray-100">Mail avec le fichier joint</legend>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                disabled={lectureSeule}
                checked={r.envoi.mail.actif}
                onChange={(e) => majEnvoi({ mail: { ...r.envoi.mail, actif: e.target.checked } })}
              />
              Envoyer un mail avec le fichier en pièce jointe
            </label>
            {r.envoi.mail.actif && (
              <>
                <Champ
                  id="envoi-adresses"
                  libelle="Adresses du service comptable"
                  aide="Séparées par des virgules. Les comptes dont la case « Reçoit le lot par mail » est cochée dans leurs droits le reçoivent aussi."
                >
                  <input
                    id="envoi-adresses"
                    disabled={lectureSeule}
                    className={CLASSE_CHAMP}
                    value={r.envoi.mail.adresses}
                    placeholder="comptabilite@mairie.fr"
                    onChange={(e) => majEnvoi({ mail: { ...r.envoi.mail, adresses: e.target.value } })}
                  />
                </Champ>
                {!data.smtpConfigure && (
                  <p className="flex items-center gap-1 text-sm text-amber-800 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4" aria-hidden /> Aucun serveur de courrier actif :{' '}
                    <Link to="/settings/email" className="underline">
                      Paramètres › E-mails
                    </Link>
                  </p>
                )}
              </>
            )}
          </fieldset>

          {droits.regler && (r.envoi.nextcloud.actif || r.envoi.mail.actif) && (
            <Button type="button" variant="outline" onClick={() => tester.mutate()} disabled={tester.isPending}>
              <Send className="mr-2 h-4 w-4" aria-hidden /> {tester.isPending ? 'Envoi de l’essai…' : 'Tester l’envoi (enregistrez d’abord)'}
            </Button>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fichier des sorties</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Réglez le fichier pour qu’il s’importe tel quel dans Ciril Finance. En cas de doute, demandez à la compta le modèle
            d’import des sorties d’immobilisations.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Champ id="format-extension" libelle="Format">
              <select id="format-extension" disabled={lectureSeule} className={CLASSE_CHAMP} value={r.format.extension} onChange={(e) => majFormat({ extension: e.target.value as 'csv' | 'xlsx' })}>
                <option value="csv">CSV</option>
                <option value="xlsx">Excel (.xlsx)</option>
              </select>
            </Champ>
            {r.format.extension === 'csv' && (
              <>
                <Champ id="format-separateur" libelle="Séparateur">
                  <select id="format-separateur" disabled={lectureSeule} className={CLASSE_CHAMP} value={r.format.separateur} onChange={(e) => majFormat({ separateur: e.target.value as ';' })}>
                    <option value=";">Point-virgule ;</option>
                    <option value=",">Virgule ,</option>
                    <option value={'\t'}>Tabulation</option>
                  </select>
                </Champ>
                <Champ id="format-encodage" libelle="Encodage">
                  <select id="format-encodage" disabled={lectureSeule} className={CLASSE_CHAMP} value={r.format.encodage} onChange={(e) => majFormat({ encodage: e.target.value as 'utf8' })}>
                    <option value="windows-1252">Windows (ANSI)</option>
                    <option value="utf8">UTF-8</option>
                  </select>
                </Champ>
              </>
            )}
            <Champ id="format-date" libelle="Dates">
              <select id="format-date" disabled={lectureSeule} className={CLASSE_CHAMP} value={r.format.formatDate} onChange={(e) => majFormat({ formatDate: e.target.value as 'jj/mm/aaaa' })}>
                <option value="jj/mm/aaaa">27/09/2026</option>
                <option value="aaaa-mm-jj">2026-09-27</option>
              </select>
            </Champ>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Colonnes, dans l’ordre du fichier</h3>
            <ol className="space-y-1">
              {r.format.colonnes.map((c, i) => (
                <li key={c} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-sm dark:bg-gray-700/50">
                  <span className="w-6 text-gray-500">{i + 1}.</span>
                  <span className="flex-1 text-gray-900 dark:text-gray-100">{colonnes[c] ?? c}</span>
                  {!lectureSeule && (
                    <>
                      <button type="button" aria-label={`Monter ${colonnes[c]}`} onClick={() => deplacer(i, -1)} disabled={i === 0} className="rounded p-1 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-600">
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label={`Descendre ${colonnes[c]}`} onClick={() => deplacer(i, 1)} disabled={i === r.format.colonnes.length - 1} className="rounded p-1 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-600">
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      {c !== 'numero' && (
                        <button type="button" onClick={() => basculerColonne(c)} className="rounded px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30">
                          Retirer
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ol>
            {!lectureSeule && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(colonnes)
                  .filter(([cle]) => !r.format.colonnes.includes(cle))
                  .map(([cle, libelle]) => (
                    <button
                      key={cle}
                      type="button"
                      onClick={() => basculerColonne(cle)}
                      className="rounded-full border border-dashed border-gray-300 px-2.5 py-0.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      + {libelle}
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Code de chaque motif dans Ciril</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(Object.keys(MOTIFS) as Motif[]).map((m) => (
                <Champ key={m} id={`motif-${m}`} libelle={MOTIFS[m]}>
                  <input
                    id={`motif-${m}`}
                    disabled={lectureSeule}
                    className={cn(CLASSE_CHAMP, 'font-mono')}
                    value={r.format.codesMotif[m] ?? ''}
                    onChange={(e) => majFormat({ codesMotif: { ...r.format.codesMotif, [m]: e.target.value } })}
                  />
                </Champ>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tableau de suivi</CardTitle>
        </CardHeader>
        <CardBody>
          <Champ id="seuil" libelle="Signaler en retard après (jours)" aide="Au-delà, la carte correspondante passe au rouge.">
            <input
              id="seuil"
              type="number"
              min={1}
              max={365}
              disabled={lectureSeule}
              className={cn(CLASSE_CHAMP, 'w-32')}
              value={r.seuilRetardJours}
              onChange={(e) => setR({ ...r, seuilRetardJours: Number(e.target.value) || 1 })}
            />
          </Champ>
        </CardBody>
      </Card>

      {droits.regler && (
        <div className="flex justify-end">
          <Button type="submit" disabled={enregistrer.isPending}>
            <Save className="mr-2 h-4 w-4" aria-hidden /> {enregistrer.isPending ? 'Enregistrement…' : 'Enregistrer les réglages'}
          </Button>
        </div>
      )}
    </form>
  )
}
