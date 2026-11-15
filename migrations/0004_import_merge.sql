-- Original fields of a manual transaction merged into an imported row (restored by "Undo import").
ALTER TABLE transactions ADD COLUMN pre_merge_json TEXT;
