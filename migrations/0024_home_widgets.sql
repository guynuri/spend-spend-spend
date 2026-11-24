-- Customizable Home (D-R31): the widgets a user shows on Home, in order, as a JSON array of widget ids.
-- NULL = the default layout. Per user (not per household or device), so it follows them everywhere.
ALTER TABLE users ADD COLUMN home_widgets TEXT;
