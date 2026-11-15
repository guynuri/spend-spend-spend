import { createContext } from 'react';
import { ADMIN_ITEM, MORE_ITEMS, TAB_ITEMS } from './nav';

/** Pages that have a tour entry (i18n `tour.pages.<slug>`). */
export const TOUR_PATHS = new Set([...TAB_ITEMS, ...MORE_ITEMS, ADMIN_ITEM].map((i) => i.to));
export const tourSlug = (path: string) => (path === '/' ? 'overview' : path.slice(1));

/** Opens the single-page tour for a path. Null outside the app layout. */
export const TourCtx = createContext<((path: string) => void) | null>(null);
