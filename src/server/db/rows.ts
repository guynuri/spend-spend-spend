export interface HouseholdRow {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  status: 'active' | 'disabled';
  has_sample_data: number;
  ai_enabled: number;
  ai_consent_at: string | null;
  ai_consent_by: string | null;
  ai_consent_provider: string | null;
  safety_buffer_minor: number;
  forecast_daily_variable_minor: number | null;
  locale: string;
  created_at: string;
  /** iCloud links of the shared purchase / file shortcuts (D-R21). */
  shortcut_purchase_link: string | null;
  shortcut_file_link: string | null;
  /** Budget periods start on this day, 1–28 (D-R23); 1 = calendar months. */
  period_start_day: number;
  /** 1: statistics follow the budget periods; 0: calendar months. */
  stats_by_period: number;
}
