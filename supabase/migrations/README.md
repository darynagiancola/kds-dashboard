# Supabase migration sequence (KDS backend)

Apply these files in numeric order:

1. `001_extensions_and_enums.sql`
2. `002_core_tables.sql`
3. `003_updated_at_and_profile_bootstrap.sql`
4. `004_status_history_and_guards.sql`
5. `005_rls_and_policies.sql`
6. `006_realtime_publication.sql`
7. `007_audit_logs.sql`
8. `008_standardize_order_item_modifiers.sql`
9. `009_kds_anon_read_policies.sql`
10. `010_kds_anon_status_updates.sql`
11. `011_kds_delivered_visibility_for_updates.sql`
12. `012_order_events_auditability.sql`
13. `013_kds_transition_rpc_and_entity_event_triggers.sql`
14. `014_order_events_reliability_hardening.sql`
15. `015_audit_repair_event_seq_and_client_observations.sql`

Then run test script:

- `../tests/rls_verification_queries.sql`
- `../tests/order_events_debug_queries.sql`

## Notes

- `profiles.id` is linked 1:1 to `auth.users.id`.
- `orders.status` uses: `new`, `in_progress`, `ready`, `delivered`.
- Kitchen can only move status forward: `new -> in_progress -> ready -> delivered`.
- Waiters can only mutate their own orders while still `new`.
- Admin has full access.
