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
}
