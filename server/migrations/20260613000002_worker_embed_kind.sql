-- Allow an "embed" worker kind alongside the gsplat compute kinds.
--
-- The image-embedding worker (visual search, Phase 5) isn't a gsplat compute
-- node: it registers with kind='embed' and advertises the `embed` capability
-- (see workers.capabilities). The original CHECK only admitted the gsplat
-- platforms ('cuda','metal'), so widen it. Capability gating still happens via
-- workers.capabilities @> ARRAY['embed']; `kind` is just the worker's role tag.
ALTER TABLE workers DROP CONSTRAINT IF EXISTS workers_kind_check;
ALTER TABLE workers
    ADD CONSTRAINT workers_kind_check CHECK (kind IN ('cuda', 'metal', 'embed'));
