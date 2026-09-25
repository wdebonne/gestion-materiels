/**
 * Une couleur par nature de pièce, pour lire un plan d'un coup d'œil : les
 * salles d'une couleur, les bureaux d'une autre, les locaux techniques à part.
 *
 * Les natures sont libres (migration 037) : celles qu'on ne connaît pas
 * reçoivent une couleur tirée de leur nom, toujours la même pour un même nom.
 */
const CONNUES: Record<string, string> = {
  salle: '#2563eb',
  classe: '#0891b2',
  bureau: '#7c3aed',
  sanitaires: '#0d9488',
  'local technique': '#dc2626',
  rangement: '#d97706',
  circulation: '#64748b',
  cuisine: '#ea580c',
  hall: '#475569',
}

const PALETTE = ['#2563eb', '#16a34a', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#4f46e5', '#059669']

export function couleurDePiece(typeLieu: string | null | undefined): string {
  const cle = (typeLieu ?? '').trim().toLowerCase()
  if (!cle) return '#6b7280'
  if (CONNUES[cle]) return CONNUES[cle]
  let somme = 0
  for (const c of cle) somme = (somme * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[somme % PALETTE.length]
}

/** Les natures proposées d'emblée à la création d'une pièce ; une autre reste possible. */
export const NATURES_PIECE = ['Salle', 'Classe', 'Bureau', 'Sanitaires', 'Local technique', 'Rangement', 'Circulation', 'Cuisine', 'Hall']
