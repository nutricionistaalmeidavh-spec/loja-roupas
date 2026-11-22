-- Fix PostgreSQL regex escaping without editing an applied migration.
-- POSIX bracket class avoids backslash interpretation under standard_conforming_strings.
ALTER TABLE retail_customers
 DROP CONSTRAINT IF EXISTS retail_customers_phone_check;
ALTER TABLE retail_customers
 ADD CONSTRAINT retail_customers_phone_check
 CHECK(phone IS NULL OR phone ~ '^[+]?[0-9]{10,15}$');
