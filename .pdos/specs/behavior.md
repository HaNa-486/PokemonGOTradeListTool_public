# Behavioral invariants
- Cross-circle shares use one listing ID, quantity and progress.
- UNKNOWN, NONE, false and ANY remain distinct; exact merge requires all meaningful conditions.
- Business writes pass the command gate: dataset binding, epoch/CHECK, version and payload-bound idempotency.
- Reservation, partial completion and correction preserve both-party consent and quantity conservation.
- Personal hiding affects only the actor; moderation clearly affects a whole circle and has scoped recovery.
- Local demo sessions never introduce a runtime authentication bypass.
- Source synchronization never writes to the private source or applies/pushes candidates automatically.
