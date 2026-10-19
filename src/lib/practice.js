// Practice areas as the province practice pages know them (/ontario/family-lawyers ...), and the cards on a firm's profile that link to them.
import { PRACTICE_PAGES } from './practice-pages.generated.js';

export const PRACTICE = {
  business: ['business-lawyers', 'Business / Corporate'],
  criminal: ['criminal-defence-lawyers', 'Criminal Defence'],
  traffic: ['traffic-ticket-lawyers', 'Traffic Tickets'],
  injury: ['personal-injury-lawyers', 'Personal Injury'],
  employment: ['employment-lawyers', 'Employment Law'],
  family: ['family-lawyers', 'Family Law / Divorce'],
  litigation: ['litigation-lawyers', 'Civil Litigation'],
  wills: ['wills-estate-lawyers', 'Wills & Estates'],
  immigration: ['immigration-lawyers', 'Immigration'],
  realestate: ['real-estate-lawyers', 'Real Estate'],
};
export const PROVINCE_PATH = { ON: 'ontario', QC: 'quebec', BC: 'british-columbia', AB: 'alberta', MB: 'manitoba' };

// The page for a case type in a province, or null when there is no such page (not every province has every practice page).
export function practicePath(province, caseType) {
  const p = PRACTICE[caseType];
  const dir = PROVINCE_PATH[province];
  return p && dir && PRACTICE_PAGES.includes(`${dir}/${p[0]}`) ? `/${dir}/${p[0]}` : null;
}
