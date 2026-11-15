import { todayInTz } from '../../shared/dates';
import type { HouseholdRow } from '../db/rows';

/** "Today" in the household timezone (PLAN §10.1). */
export const householdToday = (hh: HouseholdRow, now = new Date()) => todayInTz(hh.timezone, now);
