# Receipt correction notes

- Receipt printing now reads the current site exchange rate from `app_settings` when available.
- Order creation forwards the configured exchange rate and keeps it in the offline fallback.
- Receipt text is normalized to conservative ASCII to prevent `?` characters on P5_30D8.
- The unsupported cutter command was removed; only a short controlled feed is sent.
- The Bluetooth GATT connection is disconnected after the payload is sent.

After deploying, run the included Supabase migrations if they are not already applied, then hard-refresh the application on the tablet (clear the old service-worker cache if necessary).
