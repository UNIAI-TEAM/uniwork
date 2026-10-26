-- A PIN routes to one room at a time: LiveKit matches an inbound PIN against
-- every direct rule on the trunk, so two meetings holding a rule may not share
-- one (uniqueness scope: the meetings of this deployment that hold a rule).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meetings_dial_in_pin_active
  ON meetings (dial_in_pin) WHERE sip_dispatch_rule_id IS NOT NULL;
