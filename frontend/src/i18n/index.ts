import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommon from './locales/en/common';
import koCommon from './locales/ko/common';

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon },
    ko: { common: koCommon },
  },
  supportedLngs: ['en', 'ko'],
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
