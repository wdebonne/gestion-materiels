import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import fr from './locales/fr.json'
import en from './locales/en.json'

// La détection automatique de langue est désactivée volontairement :
// seul Layout.tsx utilise t(), le reste de l'application est écrit en
// français en dur. Un appareil configuré en anglais affichait donc un menu
// anglais sur une interface française, sans moyen d'en sortir.
i18n
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en }
    },
    lng: 'fr',
    fallbackLng: 'fr',
    interpolation: {
      escapeValue: false
    }
  })

export default i18n
