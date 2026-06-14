-- Initialize maintenance mode settings
INSERT INTO public.admin_settings (key, value)
VALUES 
    ('maintenance_mode', 'false'),
    ('maintenance_heading', 'Under Maintenance'),
    ('maintenance_description', 'We are currently performing scheduled maintenance. Please check back soon.')
ON CONFLICT (key) DO NOTHING;
