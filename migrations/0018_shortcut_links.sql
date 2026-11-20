-- iCloud links of the household's shared Shortcuts (D-R21): the owner builds each shortcut once on an
-- iPhone and pastes its link; everyone else installs it with one tap (it asks for their own key).
ALTER TABLE households ADD COLUMN shortcut_purchase_link TEXT;
ALTER TABLE households ADD COLUMN shortcut_file_link TEXT;
