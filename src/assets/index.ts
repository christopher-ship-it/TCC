import mark from './tecstellar-mark.png';
import wordmark from './tecstellar-wordmark.png';
import logoRealbroks from './logo-realbroks.png';
import logoIrondrobe from './logo-irondrobe.png';
import logoInflunet from './logo-influnet.png';
import logoVehigo from './logo-vehigo.png';
import vanmohMark from './vanmoh-mark.png';
import vanmohWordmark from './vanmoh-wordmark.png';
import { BRAND } from '../brand';
import type { AppId } from '../data/types';

export const TECSTELLAR_MARK = mark;
export const TECSTELLAR_WORDMARK = wordmark;

/** The square mark of the brand this build is for (header, sign-in page). */
export const BRAND_MARK = BRAND.key === 'vanmoh' ? vanmohMark : mark;

export const APP_LOGOS: Record<AppId, string> = {
  realbroks: logoRealbroks,
  irondrobe: logoIrondrobe,
  influnet: logoInflunet,
  vehigo: logoVehigo,
  vanmoh: vanmohWordmark,
};
