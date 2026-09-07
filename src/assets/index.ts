import mark from './tecstellar-mark.png';
import wordmark from './tecstellar-wordmark.png';
import logoRealbroks from './logo-realbroks.png';
import logoIrondrobe from './logo-irondrobe.png';
import logoInflunet from './logo-influnet.png';
import logoVehigo from './logo-vehigo.png';
import type { AppId } from '../data/types';

export const TECSTELLAR_MARK = mark;
export const TECSTELLAR_WORDMARK = wordmark;

export const APP_LOGOS: Record<AppId, string> = {
  realbroks: logoRealbroks,
  irondrobe: logoIrondrobe,
  influnet: logoInflunet,
  vehigo: logoVehigo,
};
